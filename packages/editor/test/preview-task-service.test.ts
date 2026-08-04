import { describe, expect, it } from "vitest";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type { AuthenticatedSessionPrincipal } from "../src/auth-session-service.js";
import { createStarterProject } from "../src/model.js";
import { EditorPreviewService } from "../src/preview-task-service.js";

const principal: AuthenticatedSessionPrincipal = {
  tenantId: "tenant-preview",
  userId: "user-preview",
  scopes: ["project:preview"],
  issuer: "urn:test",
  audience: "test",
  issuedAt: 1,
  expiresAt: 2_000_000_000,
  sessionId: "preview-session-id-012345678901234567890123456789",
  authSource: "local-dev-session"
};

function textEnvelope() {
  const project = createStarterProject("Formal preview", 64, 36, 24);
  const text = project.compositions[0]!.layers.find((layer) => layer.type === "text")!;
  text.properties = {
    text: "CodeMotion",
    fontFamily: "Codemotion Planner Unicode Bitmap",
    fontSize: 12,
    color: "#20C997FF"
  };
  text.effects = [];
  text.masks = [];
  project.compositions[0]!.layers = [text];
  project.compositions[0]!.markers = [];
  project.fonts = [{
    id: "font.codemotion.unicode-bitmap-v1",
    family: "Codemotion Planner Unicode Bitmap"
  }];
  project.assets = [];
  project.audioTracks = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [],
    brand: { colors: [], tone: [], requiredText: ["CodeMotion"], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

describe("formal editor preview service", () => {
  it("accepts only preview-request/v1 and returns exact top-to-bottom RGBA8 dimensions", async () => {
    const resolver = { resolve: async (): Promise<never> => { throw new Error("No assets expected."); } };
    const service = new EditorPreviewService(resolver);
    const result = await service.render(principal, {
      contract: "preview-request/v1",
      editableProject: textEnvelope(),
      frame: { time: 0, width: 64, height: 36, quality: "preview" }
    });
    expect(result.pixels).toHaveLength(64 * 36 * 4);
    expect(result.pixels.some((byte) => byte !== 0)).toBe(true);
    await expect(service.render(principal, {
      project: textEnvelope().project,
      time: 0,
      width: 64,
      height: 36
    })).rejects.toMatchObject({ status: 400, code: "UNSUPPORTED_CONTRACT" });
  });

  it("fails closed after runtime close and never starts resolver work", async () => {
    let resolutions = 0;
    const service = new EditorPreviewService({ resolve: async (): Promise<never> => { resolutions += 1; throw new Error(); } });
    await service.close();
    await expect(service.render(principal, {
      contract: "preview-request/v1",
      editableProject: textEnvelope(),
      frame: { time: 0, width: 64, height: 36, quality: "preview" }
    })).rejects.toMatchObject({ status: 503, code: "SERVICE_CLOSING" });
    expect(resolutions).toBe(0);
  });
});
