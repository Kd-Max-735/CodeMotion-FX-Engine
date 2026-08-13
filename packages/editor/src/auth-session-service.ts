import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  APPLICATION_SCOPES,
  isApplicationScope,
  type ApplicationScope
} from "@codemotion/schema";
export type { ApplicationScope } from "@codemotion/schema";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

export interface AuthenticatedSessionPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly scopes: readonly ApplicationScope[];
  readonly issuer: string;
  readonly audience: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly sessionId: string;
  readonly authSource: "oidc" | "local-dev-session";
}

export interface AuthAuditEvent {
  readonly event: "auth-failure" | "login-rejected" | "session-expired" | "logout";
  readonly code: string;
}

interface OidcConfiguration {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiAudience: string;
}

interface DiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

interface OidcTransaction {
  readonly nonce: string;
  readonly verifier: string;
  readonly bindingDigest: Buffer;
  readonly expiresAt: number;
}

interface SessionRecord {
  readonly principal: AuthenticatedSessionPrincipal;
  readonly csrfDigest: Buffer;
}

export interface AuthSessionServiceOptions {
  readonly mode: "production" | "development";
  readonly publicOrigin: string;
  readonly sessionSecret: Uint8Array;
  readonly oidc?: OidcConfiguration;
  readonly dev?: {
    readonly configureServer: true;
    readonly listenHost: "127.0.0.1";
    readonly tenantId: string;
    readonly userId: string;
    readonly scopes: readonly ApplicationScope[];
  };
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly audit?: (event: AuthAuditEvent) => void;
}

export interface ProductionAuthEnvironment {
  readonly [name: string]: string | undefined;
}

export class AuthHttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 500 | 503,
    readonly code: string,
    message = "Authentication request was rejected."
  ) {
    super(message);
  }
}

const SCOPES: ReadonlySet<ApplicationScope> = new Set(APPLICATION_SCOPES);
const DEV_ENVIRONMENT_NAMES = [
  "CODEMOTION_DEV_AUTH", "CODEMOTION_DEV_TENANT_ID", "CODEMOTION_DEV_USER_ID", "CODEMOTION_DEV_SCOPES"
] as const;
const DEFAULT_DEV_TENANT_ID = "local-tenant";
const DEFAULT_DEV_USER_ID = "local-user";
const DEFAULT_DEV_SCOPES = Object.freeze([
  "ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"
] satisfies readonly ApplicationScope[]);
const LOGIN_TTL_SECONDS = 5 * 60;
const PRODUCTION_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEV_SESSION_TTL_SECONDS = 60 * 60;
const CLOCK_TOLERANCE_SECONDS = 60;

function epochNow(): number { return Math.floor(Date.now() / 1_000); }

function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }

function digest(domain: string, value: string): Buffer {
  return createHash("sha256").update(domain).update("\0").update(value).digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function exactOrigin(raw: string, protocol: "https:" | "http:" | undefined): URL {
  const url = new URL(raw);
  if ((protocol !== undefined && url.protocol !== protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Public origin configuration is invalid.");
  }
  return url;
}

function exactHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("OIDC URL configuration is invalid.");
  }
  return url;
}

function nonEmpty(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function parseScopes(value: unknown): ApplicationScope[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/\s+/).filter(isApplicationScope))];
}

function parseCookies(request: IncomingMessage): Map<string, string> {
  const result = new Map<string, string>();
  const raw = request.headers.cookie;
  if (raw === undefined) return result;
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) throw new AuthHttpError(401, "UNAUTHENTICATED");
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || result.has(name)) {
      throw new AuthHttpError(401, "UNAUTHENTICATED");
    }
    result.set(name, value);
  }
  return result;
}

function setCookies(response: ServerResponse, cookies: readonly string[]): void {
  response.setHeader("set-cookie", cookies);
}

function safeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

async function readSmallJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > 4_096) throw new AuthHttpError(400, "MALFORMED_REQUEST");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AuthHttpError(400, "MALFORMED_REQUEST"); }
}

async function readDevAutoSessionBody(request: IncomingMessage): Promise<void> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > 256) throw new AuthHttpError(400, "MALFORMED_REQUEST");
    chunks.push(bytes);
  }
  if (length === 0) return;
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) {
    throw new AuthHttpError(400, "MALFORMED_REQUEST");
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AuthHttpError(400, "MALFORMED_REQUEST"); }
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new AuthHttpError(400, "MALFORMED_REQUEST");
  }
}

export function productionAuthOptionsFromEnvironment(
  env: ProductionAuthEnvironment,
  overrides: Omit<AuthSessionServiceOptions, "mode" | "publicOrigin" | "sessionSecret" | "oidc"> = {}
): AuthSessionServiceOptions {
  if (DEV_ENVIRONMENT_NAMES.some((name) => Object.prototype.hasOwnProperty.call(env, name))) {
    throw new Error("Development authentication settings are forbidden in production.");
  }
  const issuer = nonEmpty(env.CODEMOTION_OIDC_ISSUER, "CODEMOTION_OIDC_ISSUER");
  const clientId = nonEmpty(env.CODEMOTION_OIDC_CLIENT_ID, "CODEMOTION_OIDC_CLIENT_ID");
  const clientSecret = nonEmpty(env.CODEMOTION_OIDC_CLIENT_SECRET, "CODEMOTION_OIDC_CLIENT_SECRET");
  const apiAudience = nonEmpty(env.CODEMOTION_API_AUDIENCE, "CODEMOTION_API_AUDIENCE");
  const publicOrigin = nonEmpty(env.CODEMOTION_PUBLIC_ORIGIN, "CODEMOTION_PUBLIC_ORIGIN");
  const sessionSecret = Buffer.from(nonEmpty(env.CODEMOTION_SESSION_SECRET, "CODEMOTION_SESSION_SECRET"), "utf8");
  exactHttpsUrl(issuer);
  exactOrigin(publicOrigin, "https:");
  if (sessionSecret.byteLength < 32) throw new Error("CODEMOTION_SESSION_SECRET must contain at least 32 bytes.");
  return {
    ...overrides,
    mode: "production",
    publicOrigin,
    sessionSecret,
    oidc: { issuer, clientId, clientSecret, apiAudience }
  };
}

export function developmentAuthOptionsFromEnvironment(
  env: ProductionAuthEnvironment,
  input: {
    readonly configureServer: boolean;
    readonly listenHost: string;
    readonly publicOrigin: string;
  },
  overrides: Omit<AuthSessionServiceOptions, "mode" | "publicOrigin" | "sessionSecret" | "dev"> = {}
): AuthSessionServiceOptions {
  if (!input.configureServer) {
    throw new Error("Development authentication is not enabled for configureServer.");
  }
  if (env.CODEMOTION_DEV_AUTH !== undefined && env.CODEMOTION_DEV_AUTH !== "1") {
    throw new Error("CODEMOTION_DEV_AUTH override must be 1 when present.");
  }
  if (input.listenHost !== "127.0.0.1") throw new Error("Dev auth requires literal 127.0.0.1 loopback.");
  const origin = exactOrigin(input.publicOrigin, undefined);
  if (origin.protocol !== "http:" || origin.hostname !== input.listenHost) {
    throw new Error("Dev auth origin must use the configured literal loopback host.");
  }
  const tenantId = env.CODEMOTION_DEV_TENANT_ID === undefined
    ? DEFAULT_DEV_TENANT_ID : nonEmpty(env.CODEMOTION_DEV_TENANT_ID, "CODEMOTION_DEV_TENANT_ID");
  const userId = env.CODEMOTION_DEV_USER_ID === undefined
    ? DEFAULT_DEV_USER_ID : nonEmpty(env.CODEMOTION_DEV_USER_ID, "CODEMOTION_DEV_USER_ID");
  if (!validIdentifier(tenantId) || !validIdentifier(userId)) throw new Error("Dev identity is invalid.");
  const configuredScopes = env.CODEMOTION_DEV_SCOPES === undefined
    ? [...DEFAULT_DEV_SCOPES]
    : nonEmpty(env.CODEMOTION_DEV_SCOPES, "CODEMOTION_DEV_SCOPES").split(/\s+/);
  if (configuredScopes.some((scope) => !SCOPES.has(scope as ApplicationScope))) throw new Error("Dev scopes are invalid.");
  const scopes = [...new Set(configuredScopes)] as ApplicationScope[];
  if (scopes.length === 0) throw new Error("Dev scopes are required.");
  return {
    ...overrides,
    mode: "development",
    publicOrigin: input.publicOrigin,
    sessionSecret: nodeRandomBytes(32),
    dev: {
      configureServer: true,
      listenHost: input.listenHost,
      tenantId,
      userId,
      scopes
    }
  };
}

export class AuthSessionService {
  private readonly now: () => number;
  private readonly random: (size: number) => Uint8Array;
  private readonly transport: typeof fetch;
  private readonly origin: URL;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly transactions = new Map<string, OidcTransaction>();
  private readonly transactionStateByBinding = new Map<string, string>();
  private readonly instanceId: string;
  private readonly initialized: Promise<void>;
  private discovery?: DiscoveryDocument;
  private jwks?: ReturnType<typeof createLocalJWKSet>;

  constructor(private readonly options: AuthSessionServiceOptions) {
    if (options.sessionSecret.byteLength < 32) throw new Error("Session secret must contain at least 32 bytes.");
    this.now = options.now ?? epochNow;
    this.random = options.randomBytes ?? nodeRandomBytes;
    this.transport = options.fetch ?? fetch;
    this.origin = exactOrigin(options.publicOrigin, options.mode === "production" ? "https:" : "http:");
    this.instanceId = base64url(this.random(16));
    if (options.mode === "production" && options.oidc === undefined) throw new Error("OIDC configuration is required.");
    if (options.mode === "development" && options.dev === undefined) throw new Error("Development configuration is required.");
    this.initialized = options.mode === "production" ? this.loadOidc() : Promise.resolve();
  }

  async initialize(): Promise<this> { await this.initialized; return this; }

  async resolveSession(request: IncomingMessage, response?: ServerResponse): Promise<AuthenticatedSessionPrincipal> {
    await this.initialized;
    const cookieName = this.options.mode === "production" ? "__Host-cmfx_session" : "cmfx_dev_session";
    let raw: string | undefined;
    try { raw = parseCookies(request).get(cookieName); }
    catch (cause) {
      if (response) this.clearSessionCookies(response);
      throw cause;
    }
    if (!raw) throw new AuthHttpError(401, "UNAUTHENTICATED");
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(raw)) {
      if (response) this.clearSessionCookies(response);
      throw new AuthHttpError(401, "UNAUTHENTICATED");
    }
    const key = digest("codemotion-session-id-v1", raw).toString("hex");
    const record = this.sessions.get(key);
    if (record === undefined || record.principal.expiresAt <= this.now()) {
      this.sessions.delete(key);
      if (response) this.clearSessionCookies(response);
      if (record !== undefined) this.options.audit?.({ event: "session-expired", code: "UNAUTHENTICATED" });
      throw new AuthHttpError(401, "UNAUTHENTICATED");
    }
    return record.principal;
  }

  async authorize(
    request: IncomingMessage,
    response: ServerResponse,
    scope: ApplicationScope,
    stateChanging = false
  ): Promise<AuthenticatedSessionPrincipal> {
    const principal = await this.resolveSession(request, response);
    if (!principal.scopes.includes(scope)) throw new AuthHttpError(403, "FORBIDDEN");
    if (stateChanging) this.verifyRequestForgery(request, principal);
    return principal;
  }

  verifyRequestForgery(request: IncomingMessage, principal: AuthenticatedSessionPrincipal): void {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || origin !== this.origin.origin || origin.includes(",")
      || (request.headers["sec-fetch-site"] !== undefined && request.headers["sec-fetch-site"] !== "same-origin")) {
      throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
    }
    const csrfName = this.options.mode === "production" ? "__Host-cmfx_csrf" : "cmfx_dev_csrf";
    const csrfCookie = parseCookies(request).get(csrfName);
    const csrfHeader = request.headers["x-cmfx-csrf"];
    const session = this.sessions.get(digest("codemotion-session-id-v1", principal.sessionId).toString("hex"));
    if (session === undefined || typeof csrfCookie !== "string" || typeof csrfHeader !== "string") {
      throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
    }
    const cookieDigest = digest("codemotion-csrf-v1", csrfCookie);
    const headerDigest = digest("codemotion-csrf-v1", csrfHeader);
    if (!sameDigest(session.csrfDigest, cookieDigest) || !sameDigest(session.csrfDigest, headerDigest)) {
      throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
    }
  }

  verifySameOriginDownload(request: IncomingMessage): void {
    const referer = request.headers.referer;
    if (request.headers["sec-fetch-site"] !== "same-origin" || typeof referer !== "string") {
      throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
    }
    let refererOrigin: string;
    try { refererOrigin = new URL(referer).origin; }
    catch { throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED"); }
    if (refererOrigin !== this.origin.origin) throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
  }

  handle() {
    return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
      const url = new URL(request.url ?? "/", this.origin);
      const route = `${request.method ?? "GET"} ${url.pathname}`;
      const known = new Set(["GET /auth/login", "GET /auth/callback", "POST /auth/logout", "GET /api/session"]);
      if (this.options.mode === "development") {
        known.add("POST /auth/dev/auto-session");
      }
      if (!known.has(route)) return next();
      try {
        if (route === "GET /auth/login" && this.options.mode === "production") return await this.productionLogin(request, response);
        if (route === "GET /auth/callback" && this.options.mode === "production") return await this.productionCallback(request, response, url);
        if (route === "POST /auth/dev/auto-session" && this.options.mode === "development") {
          return await this.devAutoSession(request, response);
        }
        if (route === "POST /auth/logout") return await this.logout(request, response);
        if (route === "GET /api/session") return await this.sessionView(request, response);
        throw new AuthHttpError(404 as never, "NOT_FOUND");
      } catch (cause) {
        const error = cause instanceof AuthHttpError ? cause : new AuthHttpError(503, "AUTH_SERVICE_UNAVAILABLE");
        this.options.audit?.({ event: "auth-failure", code: error.code });
        safeJson(response, error.status, { error: { code: error.code, message: error.message, retryable: false, requestId: this.requestId() } });
      }
    };
  }

  private async loadOidc(): Promise<void> {
    const oidc = this.options.oidc!;
    const issuer = exactHttpsUrl(oidc.issuer);
    const discoveryUrl = new URL(`${issuer.href.replace(/\/$/, "")}/.well-known/openid-configuration`);
    const response = await this.transport(discoveryUrl, { headers: { accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error("OIDC discovery failed.");
    const value = await response.json() as Partial<DiscoveryDocument>;
    if (value.issuer !== oidc.issuer || typeof value.authorization_endpoint !== "string"
      || typeof value.token_endpoint !== "string" || typeof value.jwks_uri !== "string") {
      throw new Error("OIDC discovery is invalid.");
    }
    exactHttpsUrl(value.authorization_endpoint);
    exactHttpsUrl(value.token_endpoint);
    exactHttpsUrl(value.jwks_uri);
    const jwksResponse = await this.transport(value.jwks_uri, { headers: { accept: "application/json" }, redirect: "error" });
    if (!jwksResponse.ok) throw new Error("OIDC JWKS failed.");
    const keys = await jwksResponse.json() as JSONWebKeySet;
    if (!Array.isArray(keys.keys) || keys.keys.length === 0) throw new Error("OIDC JWKS is invalid.");
    this.discovery = value as DiscoveryDocument;
    this.jwks = createLocalJWKSet(keys);
  }

  private validateLoginNavigation(request: IncomingMessage): void {
    let refererOrigin: string | undefined;
    try { refererOrigin = typeof request.headers.referer === "string" ? new URL(request.headers.referer).origin : undefined; }
    catch { refererOrigin = undefined; }
    if (request.headers.host !== this.origin.host
      || refererOrigin !== this.origin.origin
      || request.headers["sec-fetch-site"] !== "same-origin"
      || request.headers["sec-fetch-mode"] !== "navigate"
      || request.headers["sec-fetch-dest"] !== "document"
      || (request.headers.origin !== undefined && request.headers.origin !== this.origin.origin)) {
      this.options.audit?.({ event: "login-rejected", code: "LOGIN_ORIGIN_REJECTED" });
      throw new AuthHttpError(403, "LOGIN_ORIGIN_REJECTED");
    }
  }

  private async productionLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await this.initialized;
    this.validateLoginNavigation(request);
    this.pruneExpiredTransactions();
    const state = base64url(this.random(32));
    const nonce = base64url(this.random(32));
    const verifier = base64url(this.random(32));
    const binding = base64url(this.random(32));
    const stateDigest = digest("codemotion-oidc-state-v1", state).toString("hex");
    const bindingDigest = digest("codemotion-oidc-login-binding-v1", binding);
    if (this.transactions.has(stateDigest) || this.transactionStateByBinding.has(bindingDigest.toString("hex"))) {
      throw new AuthHttpError(503, "AUTH_SERVICE_UNAVAILABLE");
    }
    this.transactions.set(stateDigest, {
      nonce,
      verifier,
      bindingDigest,
      expiresAt: this.now() + LOGIN_TTL_SECONDS
    });
    this.transactionStateByBinding.set(bindingDigest.toString("hex"), stateDigest);
    const authorization = new URL(this.discovery!.authorization_endpoint);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", this.options.oidc!.clientId);
    authorization.searchParams.set("redirect_uri", new URL("/auth/callback", this.origin).href);
    authorization.searchParams.set("scope", "openid ai:plan assets:read assets:write");
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("nonce", nonce);
    authorization.searchParams.set("code_challenge_method", "S256");
    authorization.searchParams.set("code_challenge", base64url(createHash("sha256").update(verifier).digest()));
    response.statusCode = 302;
    response.setHeader("cache-control", "no-store");
    response.setHeader("location", authorization.href);
    setCookies(response, [`__Host-cmfx_login=${binding}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${LOGIN_TTL_SECONDS}`]);
    response.end();
  }

  private async productionCallback(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    await this.initialized;
    this.pruneExpiredTransactions();
    const states = url.searchParams.getAll("state");
    const codes = url.searchParams.getAll("code");
    const state = states.length === 1 ? states[0]! : null;
    const code = codes.length === 1 ? codes[0]! : null;
    let binding: string | undefined;
    try { binding = parseCookies(request).get("__Host-cmfx_login"); }
    catch { binding = undefined; }
    const stateDigest = state === null ? undefined : digest("codemotion-oidc-state-v1", state).toString("hex");
    const bindingDigest = binding === undefined ? undefined : digest("codemotion-oidc-login-binding-v1", binding);
    const transaction = this.consumeCallbackTransactions(stateDigest, bindingDigest);
    setCookies(response, ["__Host-cmfx_login=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"]);
    if (transaction === undefined || transaction.expiresAt <= this.now() || !code || code.length > 4_096) {
      throw new AuthHttpError(400, "OIDC_CALLBACK_REJECTED");
    }
    const tokenResponse = await this.transport(this.discovery!.token_endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: new URL("/auth/callback", this.origin).href,
        client_id: this.options.oidc!.clientId,
        client_secret: this.options.oidc!.clientSecret,
        code_verifier: transaction.verifier
      })
    });
    if (!tokenResponse.ok) throw new AuthHttpError(503, "OIDC_TOKEN_EXCHANGE_FAILED");
    const tokens = await tokenResponse.json() as { id_token?: unknown; access_token?: unknown };
    if (typeof tokens.id_token !== "string" || typeof tokens.access_token !== "string") {
      throw new AuthHttpError(503, "OIDC_TOKEN_EXCHANGE_FAILED");
    }
    const principal = await this.verifyTokens(tokens.id_token, tokens.access_token, transaction.nonce);
    this.createSession(response, principal);
    response.statusCode = 302;
    response.setHeader("cache-control", "no-store");
    response.setHeader("location", "/");
    response.end();
  }

  private consumeCallbackTransactions(
    submittedStateDigest: string | undefined,
    submittedBindingDigest: Buffer | undefined
  ): OidcTransaction | undefined {
    const stateTransaction = submittedStateDigest === undefined
      ? undefined
      : this.transactions.get(submittedStateDigest);
    const bindingStateDigest = submittedBindingDigest === undefined
      ? undefined
      : this.transactionStateByBinding.get(submittedBindingDigest.toString("hex"));
    const matched = stateTransaction !== undefined
      && submittedStateDigest !== undefined
      && bindingStateDigest === submittedStateDigest
      && submittedBindingDigest !== undefined
      && sameDigest(stateTransaction.bindingDigest, submittedBindingDigest)
      ? stateTransaction
      : undefined;
    const statesToConsume = new Set<string>();
    if (stateTransaction !== undefined && submittedStateDigest !== undefined) statesToConsume.add(submittedStateDigest);
    if (bindingStateDigest !== undefined && this.transactions.has(bindingStateDigest)) statesToConsume.add(bindingStateDigest);
    for (const stateDigest of statesToConsume) this.consumeTransaction(stateDigest);
    return matched;
  }

  private consumeTransaction(stateDigest: string): void {
    const transaction = this.transactions.get(stateDigest);
    if (transaction === undefined) return;
    this.transactions.delete(stateDigest);
    const bindingDigest = transaction.bindingDigest.toString("hex");
    if (this.transactionStateByBinding.get(bindingDigest) === stateDigest) {
      this.transactionStateByBinding.delete(bindingDigest);
    }
  }

  private pruneExpiredTransactions(): void {
    const now = this.now();
    for (const [stateDigest, transaction] of this.transactions) {
      if (transaction.expiresAt <= now) this.consumeTransaction(stateDigest);
    }
  }

  private async verifyTokens(idToken: string, accessToken: string, nonce: string): Promise<Omit<AuthenticatedSessionPrincipal, "sessionId">> {
    const oidc = this.options.oidc!;
    try {
      const id = await jwtVerify(idToken, this.jwks!, {
        algorithms: ["RS256"], issuer: oidc.issuer, audience: oidc.clientId,
        clockTolerance: CLOCK_TOLERANCE_SECONDS, requiredClaims: ["sub", "iat", "exp", "nonce"],
        currentDate: new Date(this.now() * 1_000)
      });
      const access = await jwtVerify(accessToken, this.jwks!, {
        algorithms: ["RS256"], issuer: oidc.issuer, audience: oidc.apiAudience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS, requiredClaims: ["sub", "tenant_id", "scope", "iat", "exp"],
        currentDate: new Date(this.now() * 1_000)
      });
      if (access.protectedHeader.typ !== "at+jwt" || id.payload.nonce !== nonce
        || !validIdentifier(id.payload.sub) || id.payload.sub !== access.payload.sub
        || !validIdentifier(access.payload.tenant_id)
        || !Number.isInteger(id.payload.iat) || !Number.isInteger(id.payload.exp)
        || !Number.isInteger(access.payload.iat) || !Number.isInteger(access.payload.exp)
        || (access.payload.nbf !== undefined && !Number.isInteger(access.payload.nbf))
        || access.payload.iat! > this.now() + CLOCK_TOLERANCE_SECONDS) {
        throw new Error("Required OIDC claims are invalid.");
      }
      const scopes = parseScopes(access.payload.scope);
      if (scopes.length === 0) throw new Error("No application scope was granted.");
      return {
        tenantId: access.payload.tenant_id,
        userId: access.payload.sub!,
        scopes,
        issuer: oidc.issuer,
        audience: oidc.apiAudience,
        issuedAt: access.payload.iat!,
        expiresAt: Math.min(access.payload.exp!, this.now() + PRODUCTION_SESSION_TTL_SECONDS),
        authSource: "oidc"
      };
    } catch {
      throw new AuthHttpError(401, "UNAUTHENTICATED");
    }
  }

  private async devAutoSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const dev = this.options.dev;
    if (this.options.mode !== "development" || dev?.configureServer !== true || dev.listenHost !== "127.0.0.1"
      || request.socket.remoteAddress !== "127.0.0.1"
      || request.headers.host !== this.origin.host
      || request.headers.origin !== this.origin.origin
      || request.headers["sec-fetch-site"] !== "same-origin") {
      throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
    }
    await readDevAutoSessionBody(request);
    const issuedAt = this.now();
    this.createSession(response, {
      tenantId: dev.tenantId,
      userId: dev.userId,
      scopes: dev.scopes,
      issuer: `urn:codemotion:dev-loopback:${this.instanceId}`,
      audience: "codemotion-api-local",
      issuedAt,
      expiresAt: issuedAt + DEV_SESSION_TTL_SECONDS,
      authSource: "local-dev-session"
    });
    safeJson(response, 201, { authenticated: true });
  }

  private createSession(response: ServerResponse, principalWithoutSession: Omit<AuthenticatedSessionPrincipal, "sessionId">): void {
    const sessionId = base64url(this.random(32));
    const csrf = base64url(this.random(32));
    const principal = { ...principalWithoutSession, sessionId };
    this.sessions.set(digest("codemotion-session-id-v1", sessionId).toString("hex"), {
      principal,
      csrfDigest: digest("codemotion-csrf-v1", csrf)
    });
    const maxAge = Math.max(0, principal.expiresAt - this.now());
    if (this.options.mode === "production") {
      setCookies(response, [
        `__Host-cmfx_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
        `__Host-cmfx_csrf=${csrf}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
        "__Host-cmfx_login=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      ]);
    } else {
      setCookies(response, [
        `cmfx_dev_session=${sessionId}; HttpOnly${this.devSecure()}; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
        `cmfx_dev_csrf=${csrf}${this.devSecure()}; SameSite=Strict; Path=/; Max-Age=${maxAge}`
      ]);
    }
  }

  private async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const principal = await this.authorize(request, response, "ai:plan", true).catch(async (cause) => {
      if (cause instanceof AuthHttpError && cause.code === "FORBIDDEN") {
        const authenticated = await this.resolveSession(request, response);
        this.verifyRequestForgery(request, authenticated);
        return authenticated;
      }
      throw cause;
    });
    this.sessions.delete(digest("codemotion-session-id-v1", principal.sessionId).toString("hex"));
    this.clearSessionCookies(response);
    this.options.audit?.({ event: "logout", code: "OK" });
    response.statusCode = 204;
    response.setHeader("cache-control", "no-store");
    response.end();
  }

  private async sessionView(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const principal = await this.resolveSession(request, response);
    safeJson(response, 200, {
      authenticated: true,
      principal: {
        tenantId: principal.tenantId,
        userId: principal.userId,
        scopes: principal.scopes,
        expiresAt: principal.expiresAt
      }
    });
  }

  private clearSessionCookies(response: ServerResponse): void {
    if (this.options.mode === "production") {
      setCookies(response, [
        "__Host-cmfx_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        "__Host-cmfx_csrf=; Secure; SameSite=Strict; Path=/; Max-Age=0"
      ]);
    } else {
      setCookies(response, [
        `cmfx_dev_session=; HttpOnly${this.devSecure()}; SameSite=Strict; Path=/; Max-Age=0`,
        `cmfx_dev_csrf=${this.devSecure()}; SameSite=Strict; Path=/; Max-Age=0`
      ]);
    }
  }

  private devSecure(): string { return this.origin.protocol === "https:" ? "; Secure" : ""; }

  private requestId(): string { return `req_${base64url(this.random(12))}`; }
}
