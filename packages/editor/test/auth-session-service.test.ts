import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AuthSessionService,
  developmentAuthOptionsFromEnvironment,
  productionAuthOptionsFromEnvironment,
  type AuthSessionServiceOptions
} from "../src/auth-session-service.js";

const ISSUER = "https://issuer.example.test";
const NOW = 1_785_456_000;
let privateKey: CryptoKey;
let forgedKey: CryptoKey;
let jwks: { keys: Record<string, unknown>[] };

beforeAll(async () => {
  const valid = await generateKeyPair("RS256", { extractable: true });
  const forged = await generateKeyPair("RS256", { extractable: true });
  privateKey = valid.privateKey;
  forgedKey = forged.privateKey;
  jwks = { keys: [{ ...await exportJWK(valid.publicKey), kid: "valid", alg: "RS256", use: "sig" }] };
});

interface TokenMutation {
  readonly key?: CryptoKey;
  readonly issuer?: string;
  readonly idAudience?: string;
  readonly accessAudience?: string;
  readonly idSub?: string;
  readonly accessSub?: string;
  readonly tenant?: string | null;
  readonly scope?: string | null;
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly nbf?: number;
}

async function tokens(nonce: string, mutation: TokenMutation = {}): Promise<{ id_token: string; access_token: string }> {
  const key = mutation.key ?? privateKey;
  const issuer = mutation.issuer ?? ISSUER;
  const issuedAt = mutation.issuedAt ?? NOW;
  const expiresAt = mutation.expiresAt ?? NOW + 3_600;
  const id = new SignJWT({ nonce })
    .setProtectedHeader({ alg: "RS256", kid: mutation.key ? "forged" : "valid" })
    .setIssuer(issuer).setAudience(mutation.idAudience ?? "client-id")
    .setSubject(mutation.idSub ?? "user-a").setIssuedAt(issuedAt).setExpirationTime(expiresAt);
  const accessPayload: Record<string, unknown> = {};
  if (mutation.tenant !== null) accessPayload.tenant_id = mutation.tenant ?? "tenant-a";
  if (mutation.scope !== null) accessPayload.scope = mutation.scope ?? "ai:plan assets:read assets:write unknown:scope";
  const access = new SignJWT(accessPayload)
    .setProtectedHeader({ alg: "RS256", kid: mutation.key ? "forged" : "valid", typ: "at+jwt" })
    .setIssuer(issuer).setAudience(mutation.accessAudience ?? "codemotion-api")
    .setSubject(mutation.accessSub ?? "user-a").setIssuedAt(issuedAt).setExpirationTime(expiresAt);
  if (mutation.nbf !== undefined) access.setNotBefore(mutation.nbf);
  return { id_token: await id.sign(key), access_token: await access.sign(key) };
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(cookies: readonly string[], name: string): string {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) throw new Error(`Missing ${name} cookie.`);
  return match.slice(name.length + 1).split(";", 1)[0]!;
}

async function serve(service: AuthSessionService): Promise<{ base: string; close: () => Promise<void> }> {
  const handler = service.handle();
  const server = createServer((request, response) => {
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function rawRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(url, { method: init.method ?? "GET", headers: init.headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
        }
        resolve(new Response(incoming.statusCode === 204 ? null : Buffer.concat(chunks), { status: incoming.statusCode!, headers }));
      });
    });
    outgoing.on("error", reject);
    if (init.body !== undefined) outgoing.end(init.body);
    else outgoing.end();
  });
}

async function productionHarness(mutation: TokenMutation = {}) {
  const port = await freePort();
  const origin = `https://127.0.0.1:${port}`;
  let nonce = "";
  let exchanges = 0;
  let exchangeBody = "";
  let currentTime = NOW;
  const audit: unknown[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`
    });
    if (url.endsWith("/jwks")) return Response.json(jwks);
    if (url.endsWith("/token")) {
      exchanges += 1;
      exchangeBody = String(init?.body ?? "");
      return Response.json(await tokens(nonce, mutation));
    }
    throw new Error("Unexpected transport URL.");
  };
  const options: AuthSessionServiceOptions = productionAuthOptionsFromEnvironment({
    CODEMOTION_OIDC_ISSUER: ISSUER,
    CODEMOTION_OIDC_CLIENT_ID: "client-id",
    CODEMOTION_OIDC_CLIENT_SECRET: "client-secret",
    CODEMOTION_API_AUDIENCE: "codemotion-api",
    CODEMOTION_PUBLIC_ORIGIN: origin,
    CODEMOTION_SESSION_SECRET: "s".repeat(32)
  }, { fetch: transport, now: () => currentTime, audit: (event) => audit.push(event) });
  const service = await new AuthSessionService(options).initialize();
  const handler = service.handle();
  const httpServer = createServer((request, response) => {
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
  const server = {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  };
  const navigationHeaders = {
    referer: `${origin}/`, "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document"
  };
  const login = async (headers: Record<string, string> = navigationHeaders) => {
    const response = await rawRequest(`${server.base}/auth/login`, { headers });
    const location = new URL(response.headers.get("location") ?? origin);
    nonce = location.searchParams.get("nonce") ?? "";
    return { response, location, binding: cookieValue(setCookies(response), "__Host-cmfx_login") };
  };
  const callback = (state: string, binding?: string, code = "authorization-code") => fetch(
    `${server.base}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { headers: binding === undefined ? {} : { cookie: `__Host-cmfx_login=${binding}` }, redirect: "manual" }
  );
  return {
    service, server, origin, navigationHeaders, login, callback, audit,
    advance(seconds: number) { currentTime += seconds; },
    get exchanges() { return exchanges; }, get exchangeBody() { return exchangeBody; }
  };
}

async function devHarness() {
  const port = await freePort();
  let currentTime = NOW;
  const options = developmentAuthOptionsFromEnvironment({
    CODEMOTION_DEV_TENANT_ID: "tenant-dev",
    CODEMOTION_DEV_USER_ID: "user-dev",
    CODEMOTION_DEV_SCOPES: "ai:plan assets:read assets:write project:preview export:create export:read"
  }, {
    configureServer: true, listenHost: "127.0.0.1", publicOrigin: `http://127.0.0.1:${port}`
  }, { now: () => currentTime });
  const service = new AuthSessionService(options);
  const handler = service.handle();
  const httpServer = createServer((request, response) => {
    if (request.headers["x-test-peer"] === "non-loopback") {
      Object.defineProperty(request.socket, "remoteAddress", { value: "10.0.0.8" });
    }
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
  return {
    service,
    base: `http://127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    autoHeaders: {
      origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin",
      "content-type": "application/json"
    },
    options,
    advance(seconds: number) { currentTime += seconds; },
    close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  };
}

describe("production OIDC session boundary", () => {
  it("does not register the development auto-session endpoint", async () => {
    const harness = await productionHarness();
    try {
      expect((await rawRequest(`${harness.server.base}/auth/dev/auto-session`, {
        method: "POST",
        headers: { origin: harness.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: "{}"
      })).status).toBe(404);
    } finally { await harness.server.close(); }
  });

  it("creates a PKCE-bound session with frozen cookies and safe session view", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      expect(login.response.status).toBe(302);
      expect(login.location.searchParams.get("code_challenge_method")).toBe("S256");
      expect(login.location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const callback = await harness.callback(login.location.searchParams.get("state")!, login.binding);
      expect(callback.status).toBe(302);
      expect(harness.exchanges).toBe(1);
      expect(harness.exchangeBody).toContain("code_verifier=");
      const cookies = setCookies(callback);
      expect(cookies.find((cookie) => cookie.startsWith("__Host-cmfx_session="))).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
      expect(cookies.find((cookie) => cookie.startsWith("__Host-cmfx_csrf="))).toContain("Secure; SameSite=Strict; Path=/");
      expect(cookies.join(";")).not.toContain("Domain=");
      const session = cookieValue(cookies, "__Host-cmfx_session");
      const view = await fetch(`${harness.server.base}/api/session`, {
        headers: { cookie: `__Host-cmfx_session=${session}` }
      });
      expect(await view.json()).toEqual({ authenticated: true, principal: {
        tenantId: "tenant-a", userId: "user-a", scopes: ["ai:plan", "assets:read", "assets:write"], expiresAt: NOW + 3_600
      } });
    } finally { await harness.server.close(); }
  });

  it.each([
    ["forged signature", { key: null }],
    ["issuer", { issuer: "https://wrong.example.test" }],
    ["ID audience", { idAudience: "wrong" }],
    ["API audience", { accessAudience: "wrong" }],
    ["subject mismatch", { accessSub: "user-b" }],
    ["future iat", { issuedAt: NOW + 61 }],
    ["expired", { expiresAt: NOW - 61 }],
    ["future nbf", { nbf: NOW + 61 }],
    ["tenant", { tenant: null }],
    ["scope", { scope: null }]
  ])("rejects invalid %s tokens", async (_name, rawMutation) => {
    const mutation = "key" in rawMutation && rawMutation.key === null ? { key: forgedKey } : rawMutation as TokenMutation;
    const harness = await productionHarness(mutation);
    try {
      const login = await harness.login();
      const response = await harness.callback(login.location.searchParams.get("state")!, login.binding);
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toMatch(/authorization-code|client-secret|eyJ/);
    } finally { await harness.server.close(); }
  });

  it("rejects cross-site or incomplete login evidence before creating a redirect", async () => {
    const harness = await productionHarness();
    try {
      for (const headers of [
        { ...harness.navigationHeaders, referer: "https://evil.example/" },
        { ...harness.navigationHeaders, referer: "" },
        { ...harness.navigationHeaders, "sec-fetch-site": "cross-site" },
        { referer: `${harness.origin}/` }
      ]) {
        const response = await rawRequest(`${harness.server.base}/auth/login`, { headers });
        expect(response.status).toBe(403);
        expect(response.headers.get("location")).toBeNull();
      }
    } finally { await harness.server.close(); }
  });

  it("consumes an unknown state transaction selected by its valid browser binding", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      const state = login.location.searchParams.get("state")!;
      expect((await harness.callback("unknown-state", login.binding)).status).toBe(400);
      expect((await harness.callback(state, login.binding)).status).toBe(400);
      expect(harness.exchanges).toBe(0);
    } finally { await harness.server.close(); }
  });

  it("atomically consumes both transactions when state and binding belong to different browsers", async () => {
    const harness = await productionHarness();
    try {
      const first = await harness.login();
      const second = await harness.login();
      const firstState = first.location.searchParams.get("state")!;
      const secondState = second.location.searchParams.get("state")!;
      expect((await harness.callback(firstState, second.binding)).status).toBe(400);
      expect((await harness.callback(firstState, first.binding)).status).toBe(400);
      expect((await harness.callback(secondState, second.binding)).status).toBe(400);
      expect(harness.exchanges).toBe(0);
    } finally { await harness.server.close(); }
  });

  it("consumes a known state even when the browser binding is missing", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      const state = login.location.searchParams.get("state")!;
      expect((await harness.callback(state)).status).toBe(400);
      expect((await harness.callback(state, login.binding)).status).toBe(400);
      expect(harness.exchanges).toBe(0);
    } finally { await harness.server.close(); }
  });

  it("does not consume an unrelated transaction for unknown state and binding", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      expect((await harness.callback("unknown-state", "unknown-binding")).status).toBe(400);
      expect((await harness.callback(login.location.searchParams.get("state")!, login.binding)).status).toBe(302);
      expect(harness.exchanges).toBe(1);
    } finally { await harness.server.close(); }
  });

  it("requires exact Origin and CSRF for logout, then expires the session", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      const callback = await harness.callback(login.location.searchParams.get("state")!, login.binding);
      const cookies = setCookies(callback);
      const session = cookieValue(cookies, "__Host-cmfx_session");
      const csrf = cookieValue(cookies, "__Host-cmfx_csrf");
      const cookie = `__Host-cmfx_session=${session}; __Host-cmfx_csrf=${csrf}`;
      expect((await fetch(`${harness.server.base}/auth/logout`, { method: "POST", headers: { cookie } })).status).toBe(403);
      expect((await fetch(`${harness.server.base}/auth/logout`, {
        method: "POST", headers: { cookie, origin: "https://evil.example", "x-cmfx-csrf": csrf }
      })).status).toBe(403);
      const logout = await fetch(`${harness.server.base}/auth/logout`, {
        method: "POST", headers: { cookie, origin: harness.origin, "x-cmfx-csrf": csrf, "sec-fetch-site": "same-origin" }
      });
      expect(logout.status).toBe(204);
      expect(setCookies(logout).every((value) => value.includes("Max-Age=0"))).toBe(true);
      expect((await fetch(`${harness.server.base}/api/session`, { headers: { cookie } })).status).toBe(401);
    } finally { await harness.server.close(); }
  });

  it("clears an absolutely expired session cookie", async () => {
    const harness = await productionHarness();
    try {
      const login = await harness.login();
      const callback = await harness.callback(login.location.searchParams.get("state")!, login.binding);
      const session = cookieValue(setCookies(callback), "__Host-cmfx_session");
      harness.advance(3_601);
      const response = await fetch(`${harness.server.base}/api/session`, {
        headers: { cookie: `__Host-cmfx_session=${session}` }
      });
      expect(response.status).toBe(401);
      expect(setCookies(response).every((value) => value.includes("Max-Age=0"))).toBe(true);
    } finally { await harness.server.close(); }
  });
});

describe("authentication startup and local development", () => {
  it("fails closed for missing production values and every present dev setting", () => {
    expect(() => productionAuthOptionsFromEnvironment({})).toThrow("required");
    for (const name of ["CODEMOTION_DEV_AUTH", "CODEMOTION_DEV_TENANT_ID", "CODEMOTION_DEV_USER_ID", "CODEMOTION_DEV_SCOPES"]) {
      expect(() => productionAuthOptionsFromEnvironment({
        CODEMOTION_OIDC_ISSUER: ISSUER,
        CODEMOTION_OIDC_CLIENT_ID: "client-id",
        CODEMOTION_OIDC_CLIENT_SECRET: "secret",
        CODEMOTION_API_AUDIENCE: "api",
        CODEMOTION_PUBLIC_ORIGIN: "https://app.example.test",
        CODEMOTION_SESSION_SECRET: "s".repeat(32),
        [name]: ""
      })).toThrow("forbidden");
    }
  });

  it("uses fixed safe defaults without environment setup and accepts validated overrides", () => {
    const defaults = developmentAuthOptionsFromEnvironment({}, {
      configureServer: true, listenHost: "127.0.0.1", publicOrigin: "http://127.0.0.1:4174"
    });
    expect(defaults.dev).toEqual({
      configureServer: true,
      listenHost: "127.0.0.1",
      tenantId: "local-tenant",
      userId: "local-user",
      scopes: ["ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"]
    });
    const overrides = developmentAuthOptionsFromEnvironment({
      CODEMOTION_DEV_AUTH: "1", CODEMOTION_DEV_TENANT_ID: "tenant-dev",
      CODEMOTION_DEV_USER_ID: "user-dev", CODEMOTION_DEV_SCOPES: "assets:read ai:plan"
    }, { configureServer: true, listenHost: "127.0.0.1", publicOrigin: "http://127.0.0.1:4174" });
    expect(overrides.dev).toMatchObject({ tenantId: "tenant-dev", userId: "user-dev", scopes: ["assets:read", "ai:plan"] });
  });

  it("rejects preview-style, production, and non-loopback development registration", () => {
    expect(() => developmentAuthOptionsFromEnvironment({}, {
      configureServer: false, listenHost: "127.0.0.1", publicOrigin: "http://127.0.0.1:1"
    })).toThrow("configureServer");
    expect(() => developmentAuthOptionsFromEnvironment({}, {
      configureServer: true, listenHost: "0.0.0.0", publicOrigin: "http://127.0.0.1:1"
    })).toThrow("loopback");
    expect(() => developmentAuthOptionsFromEnvironment({ CODEMOTION_DEV_AUTH: "0" }, {
      configureServer: true, listenHost: "127.0.0.1", publicOrigin: "http://127.0.0.1:1"
    })).toThrow("must be 1");
  });

  it("creates an opaque local session, preserves it across refresh, and restores it after restart", async () => {
    const valid = await devHarness();
    let oldCookie = "";
    try {
      const anonymous = await fetch(`${valid.base}/api/session`);
      expect(anonymous.status).toBe(401);
      expect(setCookies(anonymous)).toEqual([]);
      const created = await fetch(`${valid.base}/auth/dev/auto-session`, {
        method: "POST", headers: valid.autoHeaders, body: "{}"
      });
      expect(created.status).toBe(201);
      const cookies = setCookies(created);
      expect(cookies).toHaveLength(2);
      expect(cookies.find((value) => value.startsWith("cmfx_dev_session="))).toContain("HttpOnly; SameSite=Strict; Path=/");
      expect(cookies.join(";")).not.toMatch(/Domain=|cmfx_dev_login/);
      const session = cookieValue(cookies, "cmfx_dev_session");
      const csrf = cookieValue(cookies, "cmfx_dev_csrf");
      oldCookie = `cmfx_dev_session=${session}; cmfx_dev_csrf=${csrf}`;
      const authorizedRequest = { headers: {
        cookie: oldCookie,
        origin: valid.origin,
        "sec-fetch-site": "same-origin",
        "x-cmfx-csrf": csrf
      } } as unknown as IncomingMessage;
      for (const scope of ["ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"] as const) {
        await expect(valid.service.authorize(authorizedRequest, {} as ServerResponse, scope, true))
          .resolves.toMatchObject({ tenantId: "tenant-dev", userId: "user-dev" });
      }
      const first = await fetch(`${valid.base}/api/session`, { headers: { cookie: oldCookie } });
      const refreshed = await fetch(`${valid.base}/api/session`, { headers: { cookie: oldCookie } });
      expect(first.status).toBe(200);
      expect(await refreshed.json()).toEqual({ authenticated: true, principal: {
        tenantId: "tenant-dev", userId: "user-dev",
        scopes: ["ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"],
        expiresAt: NOW + 3_600
      } });
    } finally { await valid.close(); }

    const restarted = await devHarness();
    try {
      expect((await fetch(`${restarted.base}/api/session`, { headers: { cookie: oldCookie } })).status).toBe(401);
      expect((await fetch(`${restarted.base}/auth/dev/auto-session`, {
        method: "POST", headers: restarted.autoHeaders, body: "{}"
      })).status).toBe(201);
    } finally { await restarted.close(); }
  });

  it("rejects forged auto-session requests and removes the former code routes", async () => {
    const valid = await devHarness();
    try {
      const rejectedHeaders = [
        { ...valid.autoHeaders, origin: "http://evil.example" },
        { ...valid.autoHeaders, host: "evil.example" },
        { ...valid.autoHeaders, "sec-fetch-site": "cross-site" }
      ];
      for (const headers of rejectedHeaders) {
        const response = await rawRequest(`${valid.base}/auth/dev/auto-session`, { method: "POST", headers, body: "{}" });
        expect(response.status).toBe(403);
        expect(setCookies(response)).toEqual([]);
      }
      const injected = await rawRequest(`${valid.base}/auth/dev/auto-session`, {
        method: "POST", headers: valid.autoHeaders, body: JSON.stringify({ tenantId: "attacker" })
      });
      expect(injected.status).toBe(400);
      expect((await rawRequest(`${valid.base}/auth/dev/login`)).status).toBe(404);
      expect((await rawRequest(`${valid.base}/auth/dev/session`, { method: "POST" })).status).toBe(404);
      const nonLoopback = await rawRequest(`${valid.base}/auth/dev/auto-session`, {
        method: "POST", headers: { ...valid.autoHeaders, "x-test-peer": "non-loopback" }, body: "{}"
      });
      expect(nonLoopback.status).toBe(403);
    } finally { await valid.close(); }
  });
});
