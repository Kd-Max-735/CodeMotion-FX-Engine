import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runProcess, TenantMediaStore, type MediaLimits } from "@codemotion/exporter";
import { AuthHttpError, type AuthenticatedSessionPrincipal } from "../src/auth-session-service.js";
import {
  MAX_UPLOAD_BODY_BYTES,
  MediaAssetService,
  type MediaAssetAuthorization,
  type MultipartBufferSnapshot
} from "../src/media-asset-service.js";

let root: string;
let input: string;
let media: string;
let temp: string;
let png: Buffer;
let pngPath: string;
let secondPngPath: string;

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), "cmfx-media-api-"));
  input = resolve(root, "input");
  media = resolve(root, "media");
  temp = resolve(root, "temp");
  pngPath = resolve(input, "pixel.png");
  secondPngPath = resolve(input, "second.png");
  await mkdir(input, { recursive: true });
  await runProcess("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x12:d=0.1", "-frames:v", "1", "-y", pngPath
  ]);
  await runProcess("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=20x10:d=0.1", "-frames:v", "1", "-y", secondPngPath
  ]);
  png = await readFile(pngPath);
});

function principal(tenantId = "tenant-a", userId = "user-a", scopes = ["assets:read", "assets:write"]): AuthenticatedSessionPrincipal {
  return {
    tenantId, userId, scopes: scopes as AuthenticatedSessionPrincipal["scopes"],
    issuer: "urn:test", audience: "test", issuedAt: 1, expiresAt: 2_000_000_000,
    sessionId: randomBytes(32).toString("base64url"), authSource: "local-dev-session"
  };
}

class TestAuth implements MediaAssetAuthorization {
  readonly calls: string[] = [];
  constructor(public current = principal(), public failure?: AuthHttpError) {}
  async authorize(_request: unknown, _response: unknown, scope: string, stateChanging = false): Promise<AuthenticatedSessionPrincipal> {
    this.calls.push(`${scope}:${stateChanging}`);
    if (this.failure) throw this.failure;
    if (!this.current.scopes.includes(scope as never)) throw new AuthHttpError(403, "FORBIDDEN");
    return this.current;
  }
}

function multipart(
  file: Buffer,
  options: { boundary?: string; mime?: string; filename?: string; purpose?: string; extra?: string; header?: string } = {}
): { body: Buffer; contentType: string } {
  const boundary = options.boundary ?? `cmfx-${randomUUID()}`;
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? "pixel.png"}"\r\nContent-Type: ${options.mime ?? "image/png"}${options.header ?? ""}\r\n\r\n`),
    file,
    Buffer.from("\r\n")
  ];
  if (options.purpose !== undefined) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${options.purpose}\r\n`));
  }
  if (options.extra !== undefined) chunks.push(Buffer.from(options.extra));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function harness(options: {
  auth?: TestAuth;
  limits?: Partial<MediaLimits>;
  store?: TenantMediaStore;
  tempRoot?: string;
  bodyBytes?: number;
  observeMultipartBufferBytes?: (bytes: number) => void;
  observeMultipartBufferSnapshot?: (snapshot: MultipartBufferSnapshot) => void;
  observeMultipartPumpSliceBytes?: (bytes: number) => void;
  observeMultipartRequestReadBytes?: (bytes: number) => void;
  createUploadWriteStream?: (path: string) => Writable;
  wrapRequestRead?: (request: IncomingMessage) => void;
} = {}) {
  const auth = options.auth ?? new TestAuth();
  const store = options.store ?? await new TenantMediaStore({
    storageRoot: media,
    allowedRoots: [temp, input],
    ...(options.limits ? { limits: options.limits } : {})
  }).initialize();
  const service = new MediaAssetService({
    store, auth, uploadTempRoot: options.tempRoot ?? temp, cursorSecret: Buffer.alloc(32, 7),
    ...(options.bodyBytes === undefined ? {} : { bodyBytes: options.bodyBytes }),
    ...(options.observeMultipartBufferBytes === undefined ? {} : {
      observeMultipartBufferBytes: options.observeMultipartBufferBytes
    }),
    ...(options.observeMultipartBufferSnapshot === undefined ? {} : {
      observeMultipartBufferSnapshot: options.observeMultipartBufferSnapshot
    }),
    ...(options.observeMultipartPumpSliceBytes === undefined ? {} : {
      observeMultipartPumpSliceBytes: options.observeMultipartPumpSliceBytes
    }),
    ...(options.observeMultipartRequestReadBytes === undefined ? {} : {
      observeMultipartRequestReadBytes: options.observeMultipartRequestReadBytes
    }),
    ...(options.createUploadWriteStream === undefined ? {} : {
      createUploadWriteStream: options.createUploadWriteStream
    })
  });
  const handler = service.handle();
  const server = createServer((request, response) => {
    options.wrapRequestRead?.(request);
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    auth, store, base,
    close: () => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
  };
}

async function upload(base: string, value: ReturnType<typeof multipart>): Promise<Response> {
  return fetch(`${base}/api/media-assets`, {
    method: "POST",
    headers: { "content-type": value.contentType, origin: "http://local.test", "x-cmfx-csrf": "test" },
    body: new Uint8Array(value.body)
  });
}

async function uploadChunks(
  base: string,
  value: ReturnType<typeof multipart>,
  chunks: readonly Buffer[]
): Promise<{ status: number; body: string }> {
  return new Promise((done, reject) => {
    const request = httpRequest(`${base}/api/media-assets`, {
      method: "POST",
      headers: { "content-type": value.contentType, origin: "http://local.test", "x-cmfx-csrf": "test" }
    }, (incoming) => {
      const responseChunks: Buffer[] = [];
      incoming.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
      incoming.on("end", () => done({
        status: incoming.statusCode!,
        body: Buffer.concat(responseChunks).toString("utf8")
      }));
    });
    request.on("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

function expectUnifiedBudget(snapshots: readonly MultipartBufferSnapshot[]): void {
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    expect(snapshot.middlewareReservedBytes).toBe(
      snapshot.reservedParserBytes + snapshot.parserReservedBytes
      + snapshot.fileReservedBytes + snapshot.outputReservedBytes
    );
    expect(snapshot.P).toBe(snapshot.middlewareActualBackingBytes + snapshot.middlewareReservedBytes);
    expect(snapshot.R).toBe(snapshot.sourceBackingBytes + snapshot.P);
    expect(snapshot.total).toBe(snapshot.P);
    expect(snapshot.sourceBackingBytes).toBeLessThanOrEqual(64 * 1024);
    expect(snapshot.sourceBackingCount).toBeLessThanOrEqual(1);
    expect(snapshot.P).toBeLessThanOrEqual(64 * 1024);
    expect(snapshot.R).toBeLessThanOrEqual(128 * 1024);
    expect(snapshot.guardPending).toBeLessThanOrEqual(8 * 1024);
    expect(snapshot.guardPending).toBe(snapshot.guardPendingBacking);
    expect(snapshot.guardPendingView).toBe(snapshot.guardPendingBacking);
    expect(snapshot.guardReadable).toBe(0);
    expect(snapshot.pumpSlice).toBe(snapshot.pumpSliceBacking);
    expect(snapshot.pumpSliceView).toBe(snapshot.pumpSliceBacking);
    expect(snapshot.inFlight).toBe(snapshot.inFlightBacking);
    expect(snapshot.inFlightView).toBeLessThanOrEqual(snapshot.inFlightBacking);
    expect(snapshot.reservedParserBytes).toBeGreaterThanOrEqual(8 * 1024 + 70);
    expect(snapshot.parserReservedBytes).toBeGreaterThanOrEqual(4 * 1024);
    expect(snapshot.fileReservedBytes).toBeGreaterThanOrEqual(8 * 1024);
    expect(snapshot.parserWritable).toBeLessThanOrEqual(snapshot.parserReservedBytes);
    expect(snapshot.fileReadable).toBeLessThanOrEqual(snapshot.fileReservedBytes);
    expect(snapshot.outputWritable).toBeLessThanOrEqual(snapshot.outputReservedBytes);
    if (snapshot.outputWritable > 0) expect(snapshot.outputReservedBytes).toBeGreaterThanOrEqual(4 * 1024);
  }
}

class BlockingFileWritable extends Writable {
  private readonly descriptor: number;
  private pending: ((error?: Error | null) => void) | undefined;

  constructor(path: string) {
    super({ highWaterMark: 1 });
    this.descriptor = openSync(path, "wx");
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    writeSync(this.descriptor, chunk);
    this.pending = callback;
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.(error ?? new Error("Upload writer was stopped."));
    closeSync(this.descriptor);
    callback(error);
  }
}

async function waitUntil(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for upload cleanup.");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe("browser media upload and persistent tenant store", () => {
  it("streams a safe summary, cleans its temp file, and rehydrates for list and resolve", async () => {
    const localMedia = resolve(root, `media-${randomUUID()}`);
    const localTemp = resolve(root, `temp-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: localMedia, allowedRoots: [localTemp, input] }).initialize();
    const auth = new TestAuth();
    const app = await harness({ auth, store, tempRoot: localTemp });
    try {
      const response = await upload(app.base, multipart(png, { filename: "safe-name.png", purpose: "reference-image" }));
      const responseText = await response.text();
      expect(response.status, responseText).toBe(201);
      const body = JSON.parse(responseText) as { asset: Record<string, unknown> };
      expect(body.asset).toMatchObject({
        displayName: "safe-name.png", kind: "image", mime: "image/png", codec: "png", width: 16, height: 12,
        allowedPurposes: ["reference-image", "logo"]
      });
      expect(JSON.stringify(body)).not.toMatch(/storedPath|storage|hash|descriptor|ark|media:\/\//i);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
      const restarted = await new TenantMediaStore({ storageRoot: localMedia, allowedRoots: [localTemp, input] }).initialize();
      const listed = restarted.listRecords({ tenantId: "tenant-a", userId: "user-a" });
      expect(listed.map((item) => item.imported.asset.id)).toEqual([body.asset.assetId]);
      await expect(restarted.resolve({ tenantId: "tenant-a", userId: "user-a" }, String(body.asset.assetId)))
        .resolves.toMatchObject({ asset: { id: body.asset.assetId } });
    } finally { await app.close(); }
  }, 30_000);

  it("isolates identical asset IDs by tenant before disk verification", async () => {
    const localMedia = resolve(root, `isolation-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: localMedia, allowedRoots: [input] }).initialize();
    const ownerA = { tenantId: "tenant-a", userId: "shared" };
    const ownerB = { tenantId: "tenant-b", userId: "shared" };
    const a = await store.import(ownerA, { sourcePath: pngPath, claimedMime: "image/png", displayName: "a.png" });
    const b = await store.import(ownerB, { sourcePath: pngPath, claimedMime: "image/png", displayName: "b.png" });
    expect(a.asset.id).toBe(b.asset.id);
    expect(store.listRecords(ownerA).map((item) => item.displayName)).toEqual(["a.png"]);
    expect(store.listRecords(ownerB).map((item) => item.displayName)).toEqual(["b.png"]);
    await expect(store.resolve({ tenantId: "tenant-c", userId: "shared" }, a.asset.id)).rejects.toThrow("access denied");
  }, 30_000);

  it("lists in stable pages and binds opaque cursors to owner and filter", async () => {
    const localMedia = resolve(root, `list-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: localMedia, allowedRoots: [input] }).initialize();
    const owner = { tenantId: "tenant-list", userId: "user-list" };
    await store.import(owner, { sourcePath: pngPath, claimedMime: "image/png", displayName: "first.png" });
    await new Promise((done) => setTimeout(done, 2));
    await store.import(owner, { sourcePath: secondPngPath, claimedMime: "image/png", displayName: "second.png" });
    const auth = new TestAuth(principal(owner.tenantId, owner.userId));
    const app = await harness({ auth, store });
    try {
      const first = await fetch(`${app.base}/api/media-assets?limit=1&kind=image`);
      expect(first.status).toBe(200);
      const page = await first.json() as { items: Array<{ displayName: string }>; nextCursor: string };
      expect(page.items.map((item) => item.displayName)).toEqual(["second.png"]);
      expect(page.nextCursor).not.toContain(owner.tenantId);
      const second = await fetch(`${app.base}/api/media-assets?limit=1&kind=image&cursor=${encodeURIComponent(page.nextCursor)}`);
      expect((await second.json() as { items: Array<{ displayName: string }> }).items.map((item) => item.displayName))
        .toEqual(["first.png"]);
      expect((await fetch(`${app.base}/api/media-assets?limit=1&kind=image&cursor=${encodeURIComponent(`${page.nextCursor}x`)}`)).status)
        .toBe(400);
      auth.current = principal("tenant-other", "user-list");
      expect((await fetch(`${app.base}/api/media-assets?limit=1&kind=image&cursor=${encodeURIComponent(page.nextCursor)}`)).status)
        .toBe(400);
    } finally { await app.close(); }
  }, 30_000);

  it("quarantines a corrupt persisted record with only sanitized audit evidence", async () => {
    const localMedia = resolve(root, `corrupt-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: localMedia, allowedRoots: [input] }).initialize();
    await store.import({ tenantId: "tenant-a", userId: "user-a" }, {
      sourcePath: pngPath, claimedMime: "image/png", displayName: "valid.png"
    });
    const indexPath = resolve(localMedia, ".codemotion-owner-media-index-v1.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { records: Array<Record<string, unknown>> };
    const forged = structuredClone(index.records[0]!) as any;
    forged.owner = { tenantId: "tenant-a", userId: "attacker" };
    forged.imported.storedPath = resolve(root, "outside-secret.png");
    index.records.push(forged);
    await writeFile(indexPath, JSON.stringify(index));
    const audit: unknown[] = [];
    const restarted = await new TenantMediaStore({
      storageRoot: localMedia, allowedRoots: [input], audit: (event) => audit.push(event)
    }).initialize();
    expect(restarted.listRecords({ tenantId: "tenant-a", userId: "user-a" })).toHaveLength(1);
    expect(restarted.listRecords({ tenantId: "tenant-a", userId: "attacker" })).toEqual([]);
    expect(audit).toEqual([{ event: "media-index-record-rejected" }]);
    expect(JSON.stringify(audit)).not.toContain("outside-secret");
  }, 30_000);

  it("rejects unauthenticated and missing-scope requests before parser or temp creation", async () => {
    for (const failure of [new AuthHttpError(401, "UNAUTHENTICATED"), new AuthHttpError(403, "FORBIDDEN")]) {
      const localTemp = resolve(root, `early-${randomUUID()}`);
      const auth = new TestAuth(principal(), failure);
      const store = await new TenantMediaStore({ storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp] }).initialize();
      const app = await harness({ auth, store, tempRoot: localTemp });
      try {
        const response = await upload(app.base, { body: Buffer.from("not multipart"), contentType: "invalid" });
        expect(response.status).toBe(failure.status);
        await expect(stat(localTemp)).rejects.toMatchObject({ code: "ENOENT" });
        expect(store.listRecords({ tenantId: "tenant-a", userId: "user-a" })).toEqual([]);
      } finally { await app.close(); }
    }
  });

  it.each([
    ["MIME alias", () => multipart(png, { mime: "image/jpg" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["MIME parameter", () => multipart(png, { mime: "image/png; charset=utf-8" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["path traversal", () => multipart(png, { filename: "../secret.png" }), 400, "MALFORMED_MULTIPART"],
    ["long filename", () => multipart(png, { filename: `${"a".repeat(256)}.png` }), 413, "PAYLOAD_TOO_LARGE"],
    ["long purpose", () => multipart(png, { purpose: "reference-image".repeat(3) }), 413, "PAYLOAD_TOO_LARGE"],
    ["malicious SVG", () => multipart(Buffer.from('<svg width="1" height="1"><script/></svg>'), { mime: "image/svg+xml", filename: "bad.svg" }), 422, "MEDIA_VALIDATION_FAILED"],
    ["forged content", () => multipart(Buffer.from("not a png")), 422, "MEDIA_VALIDATION_FAILED"],
    ["oversize header", () => multipart(png, { header: `\r\nX-Fill: ${"a".repeat(8_192)}` }), 413, "PAYLOAD_TOO_LARGE"],
    ["long boundary", () => multipart(png, { boundary: "b".repeat(71) }), 413, "PAYLOAD_TOO_LARGE"]
  ])("rejects %s and removes request temp files", async (_name, create, status, code) => {
    const localTemp = resolve(root, `negative-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp] }).initialize();
    const app = await harness({ store, tempRoot: localTemp });
    try {
      const response = await upload(app.base, create());
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  }, 30_000);

  it("enforces a tighter streaming file limit and cleans the partial file", async () => {
    const localTemp = resolve(root, `limit-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 64 }
    }).initialize();
    const app = await harness({ store, tempRoot: localTemp });
    try {
      const response = await upload(app.base, multipart(png));
      expect(response.status).toBe(413);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("allows cap-1 and cap bytes but rejects cap+1 on the explicit file counter", async () => {
    const localTemp = resolve(root, `exact-file-limit-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 4 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const written: number[] = [];
    const app = await harness({
      store,
      tempRoot: localTemp,
      createUploadWriteStream: () => new (class extends Writable {
        override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
          written.push(chunk.byteLength);
          callback();
        }
      })()
    });
    try {
      expect((await upload(app.base, multipart(Buffer.alloc(3, 1)))).status).toBe(422);
      expect((await upload(app.base, multipart(Buffer.alloc(4, 2)))).status).toBe(422);
      expect((await upload(app.base, multipart(Buffer.alloc(5, 3)))).status).toBe(413);
      expect(importer).toHaveBeenCalledTimes(2);
      expect(written.reduce((total, bytes) => total + bytes, 0)).toBeLessThanOrEqual(7);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("selects independent image, audio, and video byte caps", async () => {
    const localTemp = resolve(root, `kind-limits-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()),
      allowedRoots: [localTemp],
      limits: { imageBytes: 6, audioBytes: 4, videoBytes: 3 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const app = await harness({ store, tempRoot: localTemp });
    try {
      expect((await upload(app.base, multipart(Buffer.alloc(5), { mime: "image/png" }))).status).toBe(422);
      expect((await upload(app.base, multipart(Buffer.alloc(5), { mime: "audio/aac", filename: "clip.aac" }))).status).toBe(413);
      expect((await upload(app.base, multipart(Buffer.alloc(4), { mime: "video/mp4", filename: "clip.mp4" }))).status).toBe(413);
      expect(importer).toHaveBeenCalledTimes(1);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("allows an exact file cap across chunked input", async () => {
    const localTemp = resolve(root, `chunked-file-cap-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 4 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const value = multipart(Buffer.from([1, 2, 3, 4]));
    const fileOffset = value.body.indexOf(Buffer.from([1, 2, 3, 4]));
    const app = await harness({ store, tempRoot: localTemp });
    try {
      const response = await uploadChunks(app.base, value, [
        value.body.subarray(0, fileOffset + 1),
        value.body.subarray(fileOffset + 1, fileOffset + 3),
        value.body.subarray(fileOffset + 3)
      ]);
      expect(response.status).toBe(422);
      expect(importer).toHaveBeenCalledOnce();
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("allows an exact total body cap and rejects only the next byte", async () => {
    const value = multipart(Buffer.alloc(4));
    const exactStore = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [temp]
    }).initialize();
    const exactImporter = vi.spyOn(exactStore, "import");
    const exact = await harness({ store: exactStore, bodyBytes: value.body.byteLength });
    try {
      expect((await uploadChunks(exact.base, value, [value.body.subarray(0, 3), value.body.subarray(3)])).status).toBe(422);
      expect(exactImporter).toHaveBeenCalledOnce();
    } finally { await exact.close(); }

    const over = await harness({ bodyBytes: value.body.byteLength - 1 });
    try {
      expect((await upload(over.base, value)).status).toBe(413);
    } finally { await over.close(); }
  });

  it("bounds explicit parser slices and streams a body larger than 64 KiB", async () => {
    const localTemp = resolve(root, `large-stream-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 256 * 1024 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const totals: number[] = [];
    const snapshots: MultipartBufferSnapshot[] = [];
    const slices: number[] = [];
    const reads: number[] = [];
    const app = await harness({
      store,
      tempRoot: localTemp,
      observeMultipartBufferBytes: (bytes) => totals.push(bytes),
      observeMultipartBufferSnapshot: (snapshot) => snapshots.push(snapshot),
      observeMultipartPumpSliceBytes: (bytes) => slices.push(bytes),
      observeMultipartRequestReadBytes: (bytes) => reads.push(bytes),
      wrapRequestRead: (request) => {
        const originalRead = request.read.bind(request);
        let wrapped = false;
        request.read = ((size?: number) => {
          const value = originalRead(size) as Buffer | null;
          if (value === null || wrapped) return value;
          wrapped = true;
          const clientWriteBacking = Buffer.allocUnsafeSlow(65_344);
          value.copy(clientWriteBacking, 0, 0, value.byteLength);
          return clientWriteBacking.subarray(0, value.byteLength);
        }) as typeof request.read;
      }
    });
    try {
      const value = multipart(Buffer.alloc(192 * 1024, 7));
      const clientWriteBytes = 65_344;
      const response = await uploadChunks(app.base, value, [
        value.body.subarray(0, clientWriteBytes),
        value.body.subarray(clientWriteBytes)
      ]);
      expect(response.status).toBe(422);
      expect(importer).toHaveBeenCalledOnce();
      expect(clientWriteBytes).toBe(65_344);
      expect(Math.max(...reads)).toBeLessThanOrEqual(4 * 1024);
      expect(reads).not.toContain(clientWriteBytes);
      expect(Math.max(...slices)).toBeLessThanOrEqual(4 * 1024);
      expect(slices).not.toContain(clientWriteBytes);
      expect(slices.length).toBeGreaterThan(24);
      expectUnifiedBudget(snapshots);
      expect(snapshots.some((snapshot) => snapshot.sourceViewBytes === 4 * 1024
        && snapshot.sourceBackingBytes === clientWriteBytes)).toBe(true);
      expect(snapshots.some((snapshot) => snapshot.sourceBackingBytes === clientWriteBytes
        && snapshot.pumpSliceBacking === 4 * 1024
        && snapshot.R === snapshot.sourceBackingBytes + snapshot.P)).toBe(true);
      expect(Math.max(...snapshots.map((snapshot) => snapshot.sourceBackingCount))).toBe(1);
      expect(snapshots.some((snapshot) => snapshot.guardReplacementBackingBytes > 0
        && snapshot.guardRetiredBackingBytes > 0
        && snapshot.middlewareActualBackingBytes >= snapshot.guardReplacementBackingBytes
          + snapshot.guardRetiredBackingBytes)).toBe(true);
      expect(Math.max(...snapshots.map((snapshot) => snapshot.pumpSliceBacking))).toBeLessThanOrEqual(4 * 1024);
      expect(totals).toEqual(snapshots.map((snapshot) => snapshot.total));
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("rejects a source backing above 64 KiB before compacting, parsing, or writing a temp file", async () => {
    const localTemp = resolve(root, `source-backing-limit-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 256 * 1024 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const snapshots: MultipartBufferSnapshot[] = [];
    const slices: number[] = [];
    const app = await harness({
      store,
      tempRoot: localTemp,
      observeMultipartBufferSnapshot: (snapshot) => snapshots.push(snapshot),
      observeMultipartPumpSliceBytes: (bytes) => slices.push(bytes),
      wrapRequestRead: (request) => {
        const originalRead = request.read.bind(request);
        let wrapped = false;
        request.read = ((size?: number) => {
          const value = originalRead(size) as Buffer | null;
          if (value === null || wrapped) return value;
          wrapped = true;
          const oversized = Buffer.allocUnsafeSlow(64 * 1024 + 1);
          value.copy(oversized, 0, 0, value.byteLength);
          return oversized.subarray(0, value.byteLength);
        }) as typeof request.read;
      }
    });
    try {
      const value = multipart(Buffer.alloc(96 * 1024, 3));
      const response = await uploadChunks(app.base, value, [value.body]);
      expect(response.status).toBe(413);
      expect(snapshots.some((snapshot) => snapshot.sourceViewBytes <= 4 * 1024
        && snapshot.sourceBackingBytes === 64 * 1024 + 1)).toBe(true);
      expect(snapshots.every((snapshot) => snapshot.pumpSliceBacking === 0
        && snapshot.guardPendingBacking === 0
        && snapshot.guardReplacementBackingBytes === 0)).toBe(true);
      expect(slices).toEqual([]);
      expect(importer).not.toHaveBeenCalled();
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("returns 413 at the explicit parser queue boundary when the file consumer stalls", async () => {
    const localTemp = resolve(root, `blocked-parser-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 512 * 1024 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const totals: number[] = [];
    const snapshots: MultipartBufferSnapshot[] = [];
    let blockedOutput: Writable | undefined;
    const app = await harness({
      store,
      tempRoot: localTemp,
      observeMultipartBufferBytes: (bytes) => totals.push(bytes),
      observeMultipartBufferSnapshot: (snapshot) => snapshots.push(snapshot),
      createUploadWriteStream: (path) => {
        blockedOutput = new BlockingFileWritable(path);
        return blockedOutput;
      }
    });
    try {
      const response = await upload(app.base, multipart(Buffer.alloc(256 * 1024, 9)));
      expect(response.status).toBe(413);
      expect(importer).not.toHaveBeenCalled();
      expectUnifiedBudget(snapshots);
      expect(totals).toEqual(snapshots.map((snapshot) => snapshot.total));
      expect(snapshots.some((snapshot) => snapshot.outputWritable > 0)).toBe(true);
      expect(snapshots.some((snapshot) => snapshot.inFlight > 0)).toBe(true);
      expect(snapshots.some((snapshot) => snapshot.fileReadable > 0)).toBe(true);
      expect(snapshots.some((snapshot) => snapshot.parserWritable > 0)).toBe(true);
      expect(snapshots.some((snapshot) => snapshot.parserWritable === 64 * 1024
        && snapshot.fileReadable >= 16 * 1024)).toBe(false);
      expect(Math.max(...snapshots.map((snapshot) => snapshot.parserWritable))).toBeLessThan(64 * 1024);
      expect(blockedOutput?.destroyed).toBe(true);
      expect(blockedOutput?.closed).toBe(true);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("aborts a blocked transfer, terminates its output, and cleans its explicit temp file", async () => {
    const localTemp = resolve(root, `aborted-buffer-${randomUUID()}`);
    const store = await new TenantMediaStore({
      storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp], limits: { imageBytes: 512 * 1024 }
    }).initialize();
    const importer = vi.spyOn(store, "import");
    const snapshots: MultipartBufferSnapshot[] = [];
    let blockedOutput: BlockingFileWritable | undefined;
    let outputCreated: (() => void) | undefined;
    const outputReady = new Promise<void>((resolve) => { outputCreated = resolve; });
    const app = await harness({
      store,
      tempRoot: localTemp,
      observeMultipartBufferSnapshot: (snapshot) => snapshots.push(snapshot),
      createUploadWriteStream: (path) => {
        blockedOutput = new BlockingFileWritable(path);
        outputCreated?.();
        return blockedOutput;
      }
    });
    try {
      const value = multipart(Buffer.alloc(256 * 1024, 5));
      const request = httpRequest(`${app.base}/api/media-assets`, {
        method: "POST",
        headers: { "content-type": value.contentType, origin: "http://local.test", "x-cmfx-csrf": "test" }
      });
      const stopped = new Promise<void>((resolve) => {
        request.once("error", () => resolve());
        request.once("close", () => resolve());
      });
      request.write(value.body.subarray(0, 128 * 1024));
      await outputReady;
      request.destroy();
      await stopped;
      await waitUntil(async () => (await readdir(localTemp).catch(() => [])).length === 0);
      expectUnifiedBudget(snapshots);
      expect(importer).not.toHaveBeenCalled();
      expect(blockedOutput?.destroyed).toBe(true);
      expect(blockedOutput?.closed).toBe(true);
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("rejects an incomplete part header beyond 8 KiB before import", async () => {
    const localTemp = resolve(root, `incomplete-header-${randomUUID()}`);
    const boundary = `cmfx-${randomUUID()}`;
    const value = {
      body: Buffer.concat([Buffer.from(`--${boundary}\r\n`), Buffer.alloc(8 * 1024 + 1, 65)]),
      contentType: `multipart/form-data; boundary=${boundary}`
    };
    const store = await new TenantMediaStore({ storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp] }).initialize();
    const importer = vi.spyOn(store, "import");
    const app = await harness({ store, tempRoot: localTemp });
    try {
      expect((await upload(app.base, value)).status).toBe(413);
      expect(importer).not.toHaveBeenCalled();
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it.each([
    ["duplicate file", "file"],
    ["unknown part", "tenantId"]
  ])("rejects %s without retaining a temp file", async (_name, fieldName) => {
    const localTemp = resolve(root, `parts-${randomUUID()}`);
    const boundary = `cmfx-${randomUUID()}`;
    const extra = fieldName === "file"
      ? `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.png"\r\nContent-Type: image/png\r\n\r\nx\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="tenantId"\r\n\r\nattacker\r\n`;
    const store = await new TenantMediaStore({ storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp] }).initialize();
    const app = await harness({ store, tempRoot: localTemp });
    try {
      const response = await upload(app.base, multipart(png, { boundary, extra }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "MALFORMED_MULTIPART" } });
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("stops a chunked body at a tighter total cap and removes the partial file", async () => {
    const localTemp = resolve(root, `chunked-${randomUUID()}`);
    const store = await new TenantMediaStore({ storageRoot: resolve(root, randomUUID()), allowedRoots: [localTemp] }).initialize();
    const app = await harness({ store, tempRoot: localTemp, bodyBytes: 128 });
    const value = multipart(png);
    try {
      const response = await new Promise<{ status: number; body: string }>((done, reject) => {
        const request = httpRequest(`${app.base}/api/media-assets`, {
          method: "POST",
          headers: { "content-type": value.contentType, origin: "http://local.test", "x-cmfx-csrf": "test" }
        }, (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          incoming.on("end", () => done({ status: incoming.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
        });
        request.on("error", reject);
        request.write(value.body.subarray(0, 96));
        request.end(value.body.subarray(96));
      });
      expect(response.status).toBe(413);
      expect(response.body).toContain("PAYLOAD_TOO_LARGE");
      expect(await readdir(localTemp).catch(() => [])).toEqual([]);
    } finally { await app.close(); }
  });

  it("rejects oversized Content-Length only after authorization and before temp creation", async () => {
    const auth = new TestAuth();
    const app = await harness({ auth });
    try {
      const response = await new Promise<{ status: number; body: string }>((done, reject) => {
        const url = new URL(`${app.base}/api/media-assets`);
        const request = httpRequest(url, {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": String(MAX_UPLOAD_BODY_BYTES + 1),
            origin: "http://local.test", "x-cmfx-csrf": "test"
          }
        }, (incoming: import("node:http").IncomingMessage) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          incoming.on("end", () => done({ status: incoming.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
        });
        request.on("error", reject);
        request.end();
      });
      expect(response.status).toBe(413);
      expect(auth.calls).toEqual(["assets:write:true"]);
      expect(response.body).toContain("PAYLOAD_TOO_LARGE");
    } finally { await app.close(); }
  });
});
