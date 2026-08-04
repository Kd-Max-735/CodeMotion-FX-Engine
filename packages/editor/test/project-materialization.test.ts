import { describe, expect, it, vi } from "vitest";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import { OwnerMediaResolverError, type VerifiedStoredMedia } from "@codemotion/exporter";
import type { AssetDefinition, LayerDefinition } from "@codemotion/core";
import { createStarterProject } from "../src/model.js";
import {
  materializeBrowserProjectV1,
  ProjectServiceError,
  type OwnerMediaResolverV1
} from "../src/project-materialization.js";

const owner = { tenantId: "tenant-materialize", userId: "user-materialize" };

function verified(asset: AssetDefinition): VerifiedStoredMedia {
  return {
    asset,
    descriptor: { id: asset.id, type: asset.type, cacheKey: `trusted:${asset.id}`, metadata: {} },
    storedPath: "D:/server-only/owner/media.bin",
    arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" },
    trustedBytes: 4
  };
}

function fixture() {
  const asset: AssetDefinition = {
    id: "asset_owner_opaque",
    type: "image",
    uri: `media://${"a".repeat(64)}.png`,
    hash: `sha256:${"a".repeat(64)}`,
    metadata: { mime: "image/png", codec: "png", bytes: 4, width: 1, height: 1, decodeVerified: true }
  };
  const project = createStarterProject("Materialization", 64, 36, 24);
  const template = project.compositions[0]!.layers[0]!;
  const layer: LayerDefinition = {
    ...template,
    id: "layer.image",
    name: "Owner image",
    type: "image",
    source: { assetId: asset.id },
    properties: { fit: "contain" },
    effects: [],
    masks: []
  };
  project.compositions[0]!.layers = [layer];
  project.assets = [asset];
  project.audioTracks = [];
  const result = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: ["clean"],
    brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!result.valid) throw new Error(result.error.code);
  return { asset, envelope: result.value };
}

describe("trusted browser project materialization", () => {
  it("resolves each opaque ID under the session owner and replaces the complete asset row", async () => {
    const { asset, envelope } = fixture();
    const resolve = vi.fn<OwnerMediaResolverV1["resolve"]>().mockResolvedValue(verified(asset));
    const materialized = await materializeBrowserProjectV1(owner, envelope, { resolve });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(owner, asset.id, undefined);
    expect(materialized.project.assets).toEqual([asset]);
    expect(materialized.media.get(asset.id)?.storedPath).toContain("server-only");
    expect(JSON.stringify(envelope)).not.toContain("server-only");
  });

  it("rejects forged browser asset authority before resolver access", async () => {
    const { envelope } = fixture();
    const forged = structuredClone(envelope);
    forged.project.assets[0]!.uri = "file:///forged";
    forged.project.assets[0]!.metadata = { path: "D:/forged" };
    const resolver = { resolve: vi.fn<OwnerMediaResolverV1["resolve"]>() };
    await expect(materializeBrowserProjectV1(owner, forged, resolver)).rejects.toBeInstanceOf(ProjectServiceError);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("fails closed for duplicate rows and wrong authoritative type", async () => {
    const { asset, envelope } = fixture();
    const duplicate = structuredClone(envelope);
    duplicate.project.assets.push(structuredClone(duplicate.project.assets[0]!));
    await expect(materializeBrowserProjectV1(owner, duplicate, { resolve: async () => verified(asset) }))
      .rejects.toMatchObject({ code: "BROWSER_PROJECT_UNSAFE" });

    const audio = verified({ ...asset, type: "audio", metadata: { ...asset.metadata, mime: "audio/wav", codec: "pcm_s16le" } });
    await expect(materializeBrowserProjectV1(owner, envelope, { resolve: async () => audio }))
      .rejects.toMatchObject({ code: "ASSET_REFERENCE_INVALID" });
  });

  it.each([
    ["OWNER_NOT_FOUND", 404, "NOT_FOUND"],
    ["STORAGE_UNAVAILABLE", 503, "MEDIA_STORAGE_UNAVAILABLE"],
    ["INTEGRITY_FAILED", 422, "MEDIA_VALIDATION_FAILED"],
    ["ASSET_CHANGED", 409, "ASSET_CHANGED_DURING_MATERIALIZATION"]
  ] as const)("safely maps resolver %s", async (resolverCode, status, code) => {
    const { envelope } = fixture();
    await expect(materializeBrowserProjectV1(owner, envelope, {
      resolve: async () => { throw new OwnerMediaResolverError(resolverCode); }
    })).rejects.toMatchObject({ status, code });
  });

  it("preserves resolver abort semantics", async () => {
    const { envelope } = fixture();
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    await expect(materializeBrowserProjectV1(owner, envelope, {
      resolve: async (_owner, _assetId, signal) => {
        controller.abort(reason);
        signal?.throwIfAborted();
        throw new Error("unreachable");
      }
    }, controller.signal)).rejects.toBe(reason);
  });
});
