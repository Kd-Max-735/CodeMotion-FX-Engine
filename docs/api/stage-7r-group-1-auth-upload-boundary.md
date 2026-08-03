# Stage 7R authentication and browser media boundary

Status: **GROUP 1 FROZEN** on 2026-07-31. This record is the authoritative
`1-S7R-F0` contract, as closed by `1-S7R-F0-CORRECTION`, for authentication,
browser media ingress, and server wiring. It defines implementation work for Groups
5 and 4; it does not claim that work is already implemented.

The later `1-S7R-G0` record in
`docs/api/stage-7r-project-materialization-boundary.md` extends the exact scope
union and owns authenticated Project preview/export materialization. It does not
relax any authentication, CSRF, upload, or owner-isolation rule in this record.

## Public contract decision

**No Core, Project Schema, Effect Definition Schema, Renderer Adapter API, time
contract, or P0 catalog change is required.** Authentication and browser media
transport are server/BFF contracts. They must not be added to `MotionProject`,
`AssetDefinition`, provider payloads, or the browser-visible `ai-task/v1` body.

V1 freezes one browser authentication scheme: an opaque server-side session cookie
created by a Backend for Frontend (BFF). Bearer, ID, and access tokens never enter
browser JavaScript, localStorage, sessionStorage, IndexedDB, URLs, project JSON, AI
inputs, or logs.

## Production trust root

Production authentication uses **OpenID Connect Authorization Code flow with PKCE
S256**. The configured OIDC authorization server is the identity trust root:

- it authenticates the user and signs ID and JWT access tokens;
- the CodeMotion BFF exchanges the authorization code and verifies both tokens;
- JWT verification must use `jose`, the issuer's HTTPS discovery document and
  JWKS, and algorithm `RS256`; hand-written JWT parsing or signature code is
  forbidden;
- `state`, `nonce`, and the PKCE verifier are random, single-use, server-held values;
- the ID-token `sub` and access-token `sub` must match; and
- failure to load discovery/JWKS, exchange the code, or verify any required claim
  fails closed and creates no session.

Production startup requires all of these non-empty settings with no defaults:

| Setting | Meaning |
| --- | --- |
| `CODEMOTION_OIDC_ISSUER` | Exact HTTPS `iss`; no query or fragment |
| `CODEMOTION_OIDC_CLIENT_ID` | Confidential BFF client and ID-token audience |
| `CODEMOTION_OIDC_CLIENT_SECRET` | Server secret used only for code exchange |
| `CODEMOTION_API_AUDIENCE` | Exact required JWT access-token audience |
| `CODEMOTION_PUBLIC_ORIGIN` | Exact HTTPS browser origin, with no path |
| `CODEMOTION_SESSION_SECRET` | At least 32 random bytes for server session/CSRF protection |

The access token must be a signed JWT containing `iss`, `aud`, `sub`,
`tenant_id`, `scope`, `iat`, `nbf` when issued, and `exp`. Verification requires:

- exact issuer and audience matches;
- `typ=at+jwt` and `alg=RS256`;
- non-empty `sub` and `tenant_id`, each at most 256 characters;
- `iat`, optional `nbf`, and `exp` as integer epoch seconds;
- at most 60 seconds of clock skew; and
- at least one recognized application scope.

An unrecognized scope is discarded. It never grants a permission through prefix,
substring, group-name, role-name, or case-insensitive matching.

## Principal and scope contract

Only the authenticated BFF session resolver constructs this server-only principal:

```ts
type ApplicationScope =
  | "ai:plan"
  | "assets:read"
  | "assets:write"
  | "project:preview"
  | "export:create"
  | "export:read";

interface AuthenticatedSessionPrincipal {
  readonly tenantId: string;       // verified access-token tenant_id
  readonly userId: string;         // verified matching token sub
  readonly scopes: readonly ApplicationScope[];
  readonly issuer: string;         // verified iss, or the dev issuer below
  readonly audience: string;       // verified API aud, or codemotion-api-local
  readonly issuedAt: number;       // verified token iat, or dev session creation
  readonly expiresAt: number;      // absolute session expiry, epoch seconds
  readonly sessionId: string;      // server-only opaque ID
  readonly authSource: "oidc" | "local-dev-session";
}
```

The production session ID is 256 random bits. Only its SHA-256 digest is stored as
the session lookup key. The session record contains the validated principal, not
raw ID/access tokens. Its absolute expiry is the earlier of access-token `exp` and
eight hours after creation. It is not extended beyond that instant. Logout,
expiration, verification failure, or a missing record destroys/clears the cookie
and returns `401`.

Scope semantics are exact:

| Scope | Permission |
| --- | --- |
| `ai:plan` | Create, list, read, and cancel the current user's AI tasks and resolve selected assets for planning |
| `assets:read` | List current-user media and select opaque IDs in the browser |
| `assets:write` | Upload media through the browser ingress API |
| `project:preview` | Materialize the current browser project and render a request-scoped preview under the current owner |
| `export:create` | Create, cancel, or retry current-owner export tasks and resolve their project assets |
| `export:read` | List/read current-owner export tasks and download their completed output |

As corrected by `1-S7R-G0-CORRECTION`, this union is not locally redeclared:
`ApplicationScope`, the ordered `APPLICATION_SCOPES` constant containing exactly
these six strings, and its runtime validator are exported by
`@codemotion/schema`. Authentication services and browser clients import that one
public contract. In particular, no browser file may retain the historical local
three-scope union.

`AiTaskPrincipal` remains the smaller trusted Group 6 invocation type
`{tenantId,userId,taskId,scopes:["ai:plan"]}`. It is derived only after session and
route authorization. Cookies, token claims, issuer, audience, and session ID must
not be forwarded to Ark or written into a generated project.

Failures are fixed:

- missing, malformed, expired, or unverifiable session: `401 UNAUTHENTICATED`;
- valid session without the exact route scope: `403 FORBIDDEN`;
- failed Origin or CSRF check: `403 REQUEST_ORIGIN_REJECTED`; and
- an authenticated lookup outside the principal's owner key: indistinguishable
  `404 NOT_FOUND`.

There is no default principal, default tenant, default user, anonymous planning,
anonymous asset access, or fallback identity in production.

## Cookie and request-forgery controls

Production cookies are:

| Cookie | Attributes |
| --- | --- |
| `__Host-cmfx_session` | opaque session ID; `HttpOnly; Secure; SameSite=Lax; Path=/`; no `Domain`; `Max-Age` no later than `expiresAt` |
| `__Host-cmfx_csrf` | 256 random bits; readable by same-origin JS; `Secure; SameSite=Strict; Path=/`; no `Domain` |
| `__Host-cmfx_login` | 256-bit random pre-login binding only; `HttpOnly; Secure; SameSite=Lax; Path=/`; no `Domain`; maximum five-minute lifetime |

The CSRF-token digest is also stored in the server session. Every state-changing
request must supply the exact token in `X-CMFX-CSRF` and the CSRF cookie. The server
compares both to the session record in constant time. It also requires `Origin` to
exactly equal `CODEMOTION_PUBLIC_ORIGIN`; missing, `null`, multiple, or mismatched
Origins fail. `Sec-Fetch-Site`, when present, must be `same-origin`. CORS is not
enabled and API responses use `Cache-Control: no-store`.

The three request-forgery rules are distinct and exhaustive:

1. authenticated state changes require the server session, exact Origin, and
   session-bound CSRF cookie/header checks above;
2. pre-login `GET /auth/login` does not use an authenticated-session CSRF token. It
   requires all of: Host matching `CODEMOTION_PUBLIC_ORIGIN`; Referer whose origin
   exactly matches `CODEMOTION_PUBLIC_ORIGIN`; `Sec-Fetch-Site: same-origin`;
   `Sec-Fetch-Mode: navigate`; `Sec-Fetch-Dest: document`; and, when Origin is
   present, an exact Origin match. Missing or mismatched required navigation
   evidence returns `403 LOGIN_ORIGIN_REJECTED` before creating a transaction or
   redirecting; and
3. `GET /auth/callback` does not use session CSRF. It requires the single-use
   server-held `state`, `nonce`, and PKCE transaction plus the pre-login binding
   cookie described below.

For each accepted `/auth/login`, the server generates a 256-bit random pre-login
binding, places only that random value in `__Host-cmfx_login`, and stores a
domain-separated digest such as
`SHA-256("codemotion-oidc-login-binding-v1\0" || binding)` in the transaction with
the single-use `state`, `nonce`, and PKCE verifier. The cookie cannot contain a
principal, state, nonce, code, or token. At callback, the server obtains the cookie
and compares its domain-separated digest to the transaction record in constant
time. A missing or mismatched cookie fails before token exchange and session
creation, so it cannot establish or replace a user session.

The transaction and binding cookie are consumed and cleared once on success,
failure, expiry, or replay. A callback cannot accept tenant, user, or scope input,
reuse another transaction's binding, or use a binding issued to another browser.
Transaction lookup must not make a failed state reusable.

`Cookie`, `Set-Cookie`, authorization codes, tokens, client secret, session IDs,
CSRF values, and OIDC raw responses are redacted before all logs, errors, traces,
and audit sinks.

## Authentication routes

The BFF routes are fixed:

| Method and route | Contract |
| --- | --- |
| `GET /auth/login` | Validate same-origin navigation evidence; issue `__Host-cmfx_login`; store one binding-bound, single-use OIDC code+PKCE transaction; redirect to the configured issuer |
| `GET /auth/callback` | Validate state, login binding, nonce, PKCE, and tokens; consume transaction/binding; create the opaque session and CSRF cookies; redirect to `/` |
| `POST /auth/logout` | Require current session, Origin and CSRF; delete the session and expire both cookies; return `204` |
| `GET /api/session` | Return the safe session view below or `401`; never return tokens/session ID |

`GET /api/session` returns only:

```json
{
  "authenticated": true,
  "principal": {
    "tenantId": "tenant-visible-id",
    "userId": "user-visible-id",
    "scopes": ["ai:plan", "assets:read", "assets:write"],
    "expiresAt": 1785456000
  }
}
```

## Local development authentication

Local development uses the same server-side session and CSRF model, not a fixed
principal callback. It is enabled only when all of these conditions are true:

1. the Vite `configureServer` development hook is running;
2. `NODE_ENV` is exactly `development`;
3. `CODEMOTION_DEV_AUTH` is exactly `1`;
4. the listen address and request peer are literal loopback (`127.0.0.1` or `::1`);
5. Host and Origin are an explicit loopback origin allowlisted at startup; and
6. explicit `CODEMOTION_DEV_TENANT_ID`, `CODEMOTION_DEV_USER_ID`, and
   `CODEMOTION_DEV_SCOPES` are present and valid. None has a default.

At startup the dev server creates a 256-bit random, five-minute, single-use login
code, retains only its domain-separated SHA-256 digest in memory, and writes the
code once to the interactive controlling terminal. `GET /auth/dev/login` requires
literal-loopback peer/Host plus the same Referer and Fetch Metadata navigation
evidence as production login, using the explicitly allowlisted loopback origin.
The first valid navigation atomically binds the outstanding code record to a new
256-bit browser binding and sets `cmfx_dev_login` (`HttpOnly; SameSite=Strict;
Path=/`; no `Domain`; maximum five minutes; `Secure` omitted only for literal HTTP
loopback). The server stores only a domain-separated binding digest; another
browser cannot claim that outstanding code.

The user enters the code into that browser's local form. `POST /auth/dev/session`
accepts exactly `{ "code": "..." }` after the loopback peer/Host, exact Origin,
and matching `cmfx_dev_login` checks. The code and binding are compared in constant
time and consumed together before a random server session with a maximum one-hour
absolute lifetime is created. The binding cookie is cleared on success, failure,
timeout, restart, or replay. A code submitted from another browser, even when
correct, cannot establish or replace a session.

The dev principal has issuer
`urn:codemotion:dev-loopback:<random-server-instance-id>`, audience
`codemotion-api-local`, the explicitly configured identity/scopes, and
`authSource="local-dev-session"`. The request cannot supply identity or scopes.

Development cookies are `cmfx_dev_session` (`HttpOnly; SameSite=Strict; Path=/`)
and `cmfx_dev_csrf` (`SameSite=Strict; Path=/`). `Secure` is omitted only for
literal HTTP loopback. No `Domain` is set.

The dev-auth module is never registered by `configurePreviewServer` or a production
server entry. Production startup must fail if any of `CODEMOTION_DEV_AUTH`,
`CODEMOTION_DEV_TENANT_ID`, `CODEMOTION_DEV_USER_ID`, or
`CODEMOTION_DEV_SCOPES` is present. A production bundle/server must not expose
`/auth/dev/session`. Setting `NODE_ENV` or an identity header in an HTTP request
cannot enable it.

## Authorization-before-input order

For every `/api/ai-plans` route, the server order is mandatory:

1. match method/path without consuming the body;
2. resolve and validate the server session;
3. check exact `ai:plan` scope;
4. for state changes, check Origin and CSRF;
5. apply the authorized principal's rate/body limits;
6. only then read and parse the body;
7. validate the closed `ai-task/v1` input;
8. resolve tenant/user-owned asset IDs;
9. create/queue the task; and
10. permit media disk reads or Ark network calls.

Thus `ai:plan` is checked before request-body reads, queue mutation, asset lookup,
filesystem access, and provider/fetch access. A resolver may use only the session
cookie and server session store. It must reject principal data from JSON, query,
`X-User`, `X-Tenant`, forwarded identity headers, unverified JWT claims, environment
identity constants, or hard-coded callbacks.

`POST /api/ai-plans` accepts `application/json` and its only body is the existing
closed `AiPlanningInputV1`:

```ts
{
  contract: "ai-task/v1";
  prompt: string;
  assets: readonly { assetId: string; purpose: AiAssetPurpose }[];
  canvas: { width: number; height: number; fps: number };
  durationSeconds: number;
  style: readonly string[];
  brand: BrandConstraint;
}
```

`MotionProject`, `settings`, principal, token, path, `AssetDefinition`, hash,
storage root, provider ID, and client task ID are forbidden additional properties.
The server returns `202 {"task": AiPlanTaskView}` only after closed-contract and
authorized asset resolution succeeds.

## Browser media API

The exact routes are:

| Method and route | Scope | Success |
| --- | --- | --- |
| `POST /api/media-assets` | `assets:write` | `201 {"asset": BrowserAssetSummaryV1}` |
| `GET /api/media-assets?limit=&cursor=&kind=` | `assets:read` | `200 {"items": BrowserAssetSummaryV1[],"nextCursor":string|null}` |

Selection is a browser-local action over a listed `assetId`; there is no mutable
selection endpoint. Planning sends the selected opaque IDs in `ai-task/v1.assets`,
and the server resolves them again under the current principal.

The upload is streaming `multipart/form-data` with exactly:

- one `file` part; its filename and part Content-Type are untrusted; and
- zero or one `purpose` text part from `reference-image`, `reference-video`,
  `reference-audio`, or `logo`. Purpose is a UI hint and never authorization.

Any other field is `400 MALFORMED_MULTIPART`. In particular, an upload request
cannot contain a path, URI, `AssetDefinition`, hash, metadata, `tenantId`, `userId`,
principal, storage root, destination filename, provider ID, or Ark option.

The response/list item is exactly:

```ts
interface BrowserAssetSummaryV1 {
  readonly assetId: string;
  readonly displayName: string; // sanitized basename, no path/control characters
  readonly kind: "image" | "svg" | "audio" | "video";
  readonly mime: string;
  readonly codec: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly uploadedAt: string;
  readonly allowedPurposes: readonly AiAssetPurpose[];
}
```

The API never returns server paths, storage segments, URI, content/source/proxy
hashes, `AssetDefinition`, Resource Descriptor, provider IDs, Ark eligibility,
tenant storage keys, raw probe output, or internal metadata. `assetId` is opaque
even though the current implementation derives it from content.

`limit` defaults to 50 and is an integer in `[1,100]`. `kind` is an optional exact
enum filter. `cursor` is an opaque, integrity-protected cursor bound to tenant,
user, filter, and ordering; it is not an owner credential. Items are ordered by
`uploadedAt` descending and then `assetId` ascending.

## Upload processing and cancellation

Upload processing order is mandatory:

1. authenticate session;
2. require exact `assets:write` scope;
3. validate Origin and CSRF;
4. apply per-user and per-tenant rate/concurrency limits;
5. reject an excessive Content-Length and enforce the total streaming byte cap;
6. parse bounded multipart headers and resolve the canonical MIME-to-suffix mapping;
7. create one random file beneath the
   configured upload-temp root; never use the client filename as a path;
8. stream the file while propagating request abort and enforcing all caps;
9. call the one shared `TenantMediaStore.import(owner,{sourcePath,claimedMime,signal})`;
10. atomically register the safe browser summary; and
11. remove the one explicit upload-temp file in `finally` on success, rejection,
   disconnect, cancellation, or unexpected failure.

V1 rate limits are: two concurrent uploads per user, eight per tenant, ten starts
per user per minute, and sixty per tenant per minute. Imported dimensions remain at
most 8192 by 8192 and duration at most six hours.

### Canonical upload MIME mapping

The file-part Content-Type is parsed as an ASCII media type, its type and subtype
are normalized to ASCII lowercase, and the result must exactly match this table:

| Canonical MIME | Temporary suffix |
| --- | --- |
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |
| `image/avif` | `.avif` |
| `image/svg+xml` | `.svg` |
| `audio/wav` | `.wav` |
| `audio/mpeg` | `.mp3` |
| `audio/flac` | `.flac` |
| `audio/ogg` | `.ogg` |
| `audio/aac` | `.aac` |
| `video/mp4` | `.mp4` |
| `video/quicktime` | `.mov` |
| `video/webm` | `.webm` |
| `video/x-matroska` | `.mkv` |

V1 permits no Content-Type parameters and no aliases, including `image/jpg`,
`audio/x-wav`, and `audio/x-flac`. Missing, repeated, syntactically invalid,
parameterized, or unlisted file Content-Type returns
`415 UNSUPPORTED_MEDIA_TYPE` before any temporary file is created. The filename
suffix cannot select a format or override the table. A listed MIME with failed
magic/container/codec/decode or SVG active-content validation returns
`422 MEDIA_VALIDATION_FAILED`. The canonical claimed MIME is passed to the shared
importer, where signature/container, codec, dimensions, duration, SVG safety,
decode, and hash validation remain mandatory.

### Multipart protocol hard limits

These limits are protocol constants and configuration may only make them tighter:

- total HTTP request body: at most 512 MiB plus 64 KiB multipart overhead, exactly
  536,936,448 bytes. Content-Length is rejected before multipart parsing when it
  exceeds this value; absent Content-Length and chunked requests use a streaming
  total-byte counter and stop immediately at the same limit;
- file part: at most 10 MiB for canonical image/SVG MIME and 512 MiB for canonical
  audio/video MIME. The canonical MIME selects the cap, and any tighter
  `TenantMediaStore` limit wins;
- at most two parts: exactly one `file` and at most one `purpose`. Duplicate or
  unknown parts return `400 MALFORMED_MULTIPART`;
- boundary: at most 70 ASCII bytes; a longer boundary returns
  `413 PAYLOAD_TOO_LARGE`, while a non-ASCII or syntactically invalid boundary
  returns `400 MALFORMED_MULTIPART`;
- each part header block: at most 8 KiB; all part headers combined: at most 16 KiB;
  either size overrun returns `413 PAYLOAD_TOO_LARGE`;
- parser internal unconsumed buffer: at most 64 KiB. The parser cannot buffer the
  full body or a full part in memory; reaching the cap without parser progress
  returns `413 PAYLOAD_TOO_LARGE`;
- raw filename: valid UTF-8 of at most 255 bytes, with no NUL, CR, LF, `/`, or `\\`.
  It is never a path. The sanitized `displayName` is at most 128 Unicode scalar
  values. A byte/scalar limit overrun returns `413 PAYLOAD_TOO_LARGE`; invalid UTF-8
  or a forbidden character returns `400 MALFORMED_MULTIPART`;
- purpose body: valid UTF-8 of at most 32 bytes and exactly one of
  `reference-image`, `reference-video`, `reference-audio`, or `logo`. A size
  overrun returns `413 PAYLOAD_TOO_LARGE`; invalid UTF-8 or another value returns
  `400 MALFORMED_MULTIPART`; and
- non-empty preamble, malformed/non-empty epilogue, nested multipart,
  `Content-Transfer-Encoding`, and an invalid Content-Disposition return `400
  MALFORMED_MULTIPART`. The purpose part permits only `name="purpose"`; the file
  part permits exactly `name="file"` and one `filename`. Any additional, unknown,
  or repeated Content-Disposition parameter is invalid.

Malformed multipart, duplicate parts, or invalid purpose return
`400 MALFORMED_MULTIPART`. Any request, file, boundary, header, parser-buffer,
filename, purpose, dimension, or duration hard-limit overrun returns `413
PAYLOAD_TOO_LARGE`. Limit detection stops reading, buffer growth, and disk writes
before accepting more data. If the one random temporary file was already created,
it is individually removed in `finally`. Authentication, exact scope, and
authenticated-state Origin/CSRF validation always precede Content-Length handling
and multipart parser construction.

The browser cancels an in-flight upload with `AbortController`. Request abort must
abort file streaming and `TenantMediaStore.import`; if the socket remains writable,
the server may return `499 UPLOAD_CANCELLED`, otherwise it sends no response. No
asset is listed unless durable registration completed. If commit completed before a
late disconnect, the asset is valid and the client reconciles by listing. In every
case the request-owned temporary file is individually removed.

All JSON errors use:

```json
{
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Safe localized message",
    "retryable": false,
    "requestId": "req_opaque"
  }
}
```

Status mapping is fixed: `400 MALFORMED_MULTIPART`; `401 UNAUTHENTICATED`; `403
FORBIDDEN`, `403 REQUEST_ORIGIN_REJECTED`, or pre-login `403
LOGIN_ORIGIN_REJECTED`; `404 NOT_FOUND`; `413 PAYLOAD_TOO_LARGE`; `415
UNSUPPORTED_MEDIA_TYPE`; `422 MEDIA_VALIDATION_FAILED`; `429` rate/concurrency;
and sanitized `500/503` internal/storage failure. Error responses contain no paths,
hashes, tokens, cookie values, probe output, or provider detail.

## Shared store and persistence

One server-runtime composition root constructs exactly one `TenantMediaStore` and
passes that same object to the browser media API and `AiPlanService` asset resolver.
Handlers and Vite middleware factories must not create their own stores. Preview
and export consumers that resolve these browser assets must receive the same
resolver or an adapter over that same instance.

The authority key remains `(tenantId,userId,assetId)`. Identical content may produce
the same opaque `assetId` in two tenants, but each tenant/user has an independent
record and storage authorization. A current principal can list or resolve only its
own record; cross-owner absence is `404` before file verification/read.

The existing in-memory `TenantMediaStore.records` may be a cache only. Group 5 must
persist an atomically written, server-controlled owner/index record under the media
storage root and rehydrate it on startup after validating every record and contained
path. Client data cannot choose index paths. A partial/corrupt record is quarantined
from listing/resolution and reported through sanitized audit evidence; it is never
silently trusted. This requirement ensures upload and planning remain interoperable
after restart and do not rely on separate in-memory Maps.

## File ownership for follow-up groups

Group 5 may create or modify only these server/auth/upload/storage files:

- `packages/editor/src/auth-session-service.ts` (new);
- `packages/editor/src/media-asset-service.ts` (new);
- `packages/editor/src/server-runtime.ts` (new single composition root);
- `packages/editor/src/ai-plan-service.ts` only for verified resolver typing,
  authorization ordering, CSRF/Origin middleware, and shared-store injection;
- `packages/exporter/src/media.ts` and `packages/exporter/src/index.ts` only for the
  persistent owner index and shared `TenantMediaStore` contract;
- `packages/editor/package.json` and root `package-lock.json` only to add `jose` and
  a bounded multipart parser if required; and
- `packages/editor/test/auth-session-service.test.ts`,
  `packages/editor/test/media-asset-service.test.ts`,
  `packages/editor/test/ai-plan-service.test.ts`, and the relevant exporter
  infrastructure test.

Group 5 must not implement UI, alter `ai-task/v1`, call Ark from upload code, or add
another model Provider.

Group 4 may create or modify only these browser/wiring files:

- `packages/editor/src/ai-plan-client.ts` to send only `AiPlanningInputV1`, include
  same-origin credentials/CSRF, and remove `MotionProject` from create requests;
- `packages/editor/src/media-asset-client.ts` (new) for upload/list/AbortController;
- `packages/editor/src/AiPlanner.tsx`, `packages/editor/src/App.tsx`, and
  `packages/editor/src/styles.css` for login state, upload/list/select/cancel UI;
- `packages/editor/vite.config.ts` only to mount the Group 5 runtime once per server,
  pass its verified principal resolver and shared `TenantMediaStore`, and keep dev
  auth out of preview/production; and
- browser/client/visual tests owned by Group 4.

For the later serial G0 implementation, the authoritative file split is Section 11
of `stage-7r-project-materialization-boundary.md`: `media-asset-client.ts` belongs
solely to G0-5, not G0-4. It must recognize all six scopes through the shared
public import. The G0-4 list has no claim on that browser file, so G0-4/G0-5 do not
overlap.

Group 4 must not parse/verify tokens, construct principals, instantiate a separate
media store, expose internal metadata, add a browser-to-Ark path, forge a scope, or
change server-side authorization semantics.

Group 6 continues to accept only trusted `AiTaskPrincipal` plus authorized
`LocalResourceInput`. It does not own OIDC, cookies, CSRF, upload, browser storage,
or session resolution, and it must not accept `MotionProject` as an AI input.

Group 7 independently verifies all contracts and failure ordering. Group 8 may
integrate only after Group 5, Group 4, Group 6 regression, and Group 7 evidence pass
serially.

## Required verification and success criteria

Group 5 succeeds only when tests prove:

- valid OIDC code+PKCE/JWKS creates a bounded session; forged signature, wrong
   issuer/audience/subject relation, future token, expired token, replayed state,
   missing tenant, and missing scope fail;
- cross-site login navigation, missing Referer or Fetch Metadata, swapped state,
  swapped login-binding cookie, callback replay, and two-browser session swapping
  all fail before token exchange or session creation;
- session cookie flags, CSRF token binding, exact Origin, logout, expiry, and log
   redaction match this record;
- production refuses missing OIDC configuration, refuses every dev-auth setting,
  and has no `/auth/dev/session` route;
- dev auth requires explicit enablement, literal loopback, explicit identity/scopes,
  a valid one-time code bound to the initiating browser, and rejects another
  browser, replay, non-loopback, or preview use;
- authentication and `ai:plan` happen before body reads, queue mutation, asset
  lookup, disk access, or fetch/provider calls;
- upload authentication/scope/Origin/CSRF precede limits and any temp-file write;
- excessive total body, file, header, boundary, filename, purpose, or chunked body;
  duplicate file/purpose; unknown part; parser failure; request abort; importer
  failure; and successful import each stop at the prescribed boundary and remove
  the one request temp file when it exists;
- MIME aliases fail with `415`; listed MIME with forged content, malicious SVG, or
  invalid codec fails with `422`; path traversal and malformed multipart fail with
  `400`; byte/metadata overrun fails with `413`;
- one shared, restart-rehydrated store serves upload/list/planning; and
- the same `assetId` in two tenants remains isolated for list and plan resolution.

Group 4 succeeds only when browser tests prove:

- no `MotionProject`, principal, token, path, hash, or internal asset object appears
  in `POST /api/ai-plans`;
- the body is exactly `ai-task/v1` and selected assets came from the authenticated
  media list;
- uploads use only file+purpose, show safe summaries, cancel with AbortController,
  reconcile after ambiguous disconnect, and surface safe failures;
- every state change supplies CSRF and uses same-origin cookies; and
- Vite has no fixed principal and shares the one Group 5 runtime/store.

Group 6 succeeds when its existing principal/isolation/closed-body/provider tests
remain green and no auth or upload concern enters its package. Group 7 must add
adversarial coverage for forged/expired token, missing scope, cross-tenant same ID,
cross-site login, missing navigation evidence, state/binding swaps, callback replay,
two-browser session swapping, total/file/header/boundary/filename/purpose/chunked
overflow, duplicate/unknown parts, interrupted cleanup, path traversal, MIME alias
and forged content, Origin/CSRF, authorization-before-body/disk/fetch, and
production dev-auth rejection.
