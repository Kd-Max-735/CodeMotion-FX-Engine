import type { MotionProject } from "@codemotion/core";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type {
  OwnerContext,
  VerifiedStoredMedia
} from "@codemotion/exporter";
import { OwnerMediaResolverError } from "@codemotion/exporter";
import {
  validateContract,
  type BrowserProjectConstraintsV1,
  type BrowserProjectEnvelopeV1
} from "@codemotion/schema";

export interface SessionProjectPrincipalV1 {
  readonly tenantId: string;
  readonly userId: string;
}

export interface OwnerMediaResolverV1 {
  resolve(owner: OwnerContext, assetId: string, signal?: AbortSignal): Promise<VerifiedStoredMedia>;
}

export interface TrustedProjectMaterializationV1 {
  readonly project: MotionProject;
  readonly media: ReadonlyMap<string, VerifiedStoredMedia>;
  readonly constraints: BrowserProjectConstraintsV1;
}

export type ProjectServiceErrorCodeV1 =
  | "MALFORMED_REQUEST"
  | "UNSUPPORTED_CONTRACT"
  | "NOT_FOUND"
  | "MEDIA_STORAGE_UNAVAILABLE"
  | "MEDIA_VALIDATION_FAILED"
  | "ASSET_CHANGED_DURING_MATERIALIZATION"
  | "PROJECT_TOO_LARGE"
  | "PROJECT_VALIDATION_FAILED"
  | "BROWSER_PROJECT_UNSAFE"
  | "ASSET_REFERENCE_INVALID"
  | "SERVICE_CLOSING";

const STATUS_BY_CODE: Readonly<Record<ProjectServiceErrorCodeV1, number>> = Object.freeze({
  MALFORMED_REQUEST: 400,
  UNSUPPORTED_CONTRACT: 400,
  NOT_FOUND: 404,
  MEDIA_STORAGE_UNAVAILABLE: 503,
  MEDIA_VALIDATION_FAILED: 422,
  ASSET_CHANGED_DURING_MATERIALIZATION: 409,
  PROJECT_TOO_LARGE: 413,
  PROJECT_VALIDATION_FAILED: 422,
  BROWSER_PROJECT_UNSAFE: 422,
  ASSET_REFERENCE_INVALID: 422,
  SERVICE_CLOSING: 503
});

const MESSAGE_BY_CODE: Readonly<Record<ProjectServiceErrorCodeV1, string>> = Object.freeze({
  MALFORMED_REQUEST: "The request is malformed.",
  UNSUPPORTED_CONTRACT: "Unsupported contract.",
  NOT_FOUND: "The requested object was not found.",
  MEDIA_STORAGE_UNAVAILABLE: "Media storage is temporarily unavailable.",
  MEDIA_VALIDATION_FAILED: "Media validation failed.",
  ASSET_CHANGED_DURING_MATERIALIZATION: "The project asset changed during validation.",
  PROJECT_TOO_LARGE: "The project exceeds the allowed size.",
  PROJECT_VALIDATION_FAILED: "Project validation failed.",
  BROWSER_PROJECT_UNSAFE: "The browser project is unsafe.",
  ASSET_REFERENCE_INVALID: "A project asset reference is invalid.",
  SERVICE_CLOSING: "The service is closing."
});

export class ProjectServiceError extends Error {
  readonly status: number;

  constructor(readonly code: ProjectServiceErrorCodeV1) {
    super(MESSAGE_BY_CODE[code]);
    this.status = STATUS_BY_CODE[code];
  }
}

function ownerFrom(principal: SessionProjectPrincipalV1): OwnerContext {
  if (typeof principal?.tenantId !== "string" || principal.tenantId.length < 1 || principal.tenantId.length > 256
    || typeof principal?.userId !== "string" || principal.userId.length < 1 || principal.userId.length > 256) {
    throw new ProjectServiceError("MALFORMED_REQUEST");
  }
  return { tenantId: principal.tenantId, userId: principal.userId };
}

function validateConstraints(project: MotionProject, constraints: BrowserProjectConstraintsV1): void {
  const visibleText = project.compositions.flatMap((composition) => composition.layers)
    .filter((layer) => layer.visible && layer.type === "text")
    .map((layer) => String(layer.properties.text ?? ""));
  if (constraints.brand.requiredText.some((required) => !visibleText.some((text) => text.includes(required)))) {
    throw new ProjectServiceError("PROJECT_VALIDATION_FAILED");
  }
  const searchable = [
    project.name,
    ...project.compositions.map((composition) => composition.name),
    ...project.compositions.flatMap((composition) => composition.layers.map((layer) => layer.name)),
    ...visibleText
  ].join("\n").toLocaleLowerCase("und");
  if (constraints.brand.forbiddenContent.some((value) => searchable.includes(value.toLocaleLowerCase("und")))) {
    throw new ProjectServiceError("PROJECT_VALIDATION_FAILED");
  }
}

function validationError(code: string): ProjectServiceError {
  if (code === "PROJECT_TOO_LARGE") return new ProjectServiceError("PROJECT_TOO_LARGE");
  if (code === "UNSUPPORTED_CONTRACT") return new ProjectServiceError("UNSUPPORTED_CONTRACT");
  if (code === "BROWSER_PROJECT_UNSAFE") return new ProjectServiceError("BROWSER_PROJECT_UNSAFE");
  return new ProjectServiceError("MALFORMED_REQUEST");
}

export async function materializeBrowserProjectV1(
  principal: SessionProjectPrincipalV1,
  envelope: unknown,
  resolver: OwnerMediaResolverV1,
  signal?: AbortSignal
): Promise<TrustedProjectMaterializationV1> {
  signal?.throwIfAborted();
  const owner = ownerFrom(principal);
  const validated = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(envelope);
  if (!validated.valid) throw validationError(validated.error.code);
  const browserProject: BrowserProjectEnvelopeV1 = validated.value;
  validateConstraints(browserProject.project, browserProject.constraints);
  const classified = P0_BROWSER_PROJECT_AUTHORITY_V1.classifyBrowserProjectAssetReferences(browserProject);
  if (!classified.valid) throw validationError(classified.error.code);

  const media = new Map<string, VerifiedStoredMedia>();
  for (const assetId of new Set(classified.value.map((reference) => reference.assetId))) {
    signal?.throwIfAborted();
    let resolved: VerifiedStoredMedia;
    try {
      resolved = await resolver.resolve(owner, assetId, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof OwnerMediaResolverError) {
        if (error.code === "OWNER_NOT_FOUND") throw new ProjectServiceError("NOT_FOUND");
        if (error.code === "STORAGE_UNAVAILABLE") throw new ProjectServiceError("MEDIA_STORAGE_UNAVAILABLE");
        if (error.code === "INTEGRITY_FAILED") throw new ProjectServiceError("MEDIA_VALIDATION_FAILED");
        if (error.code === "ASSET_CHANGED") throw new ProjectServiceError("ASSET_CHANGED_DURING_MATERIALIZATION");
      }
      throw new ProjectServiceError("MEDIA_STORAGE_UNAVAILABLE");
    }
    signal?.throwIfAborted();
    if (resolved.asset.id !== assetId) {
      throw new ProjectServiceError("ASSET_CHANGED_DURING_MATERIALIZATION");
    }
    media.set(assetId, resolved);
  }
  for (const reference of classified.value) {
    const resolved = media.get(reference.assetId);
    if (resolved === undefined || !reference.allowedMediaTypes.some((type) => type === resolved.asset.type)) {
      throw new ProjectServiceError("ASSET_REFERENCE_INVALID");
    }
  }

  const project = structuredClone(browserProject.project);
  project.assets = browserProject.project.assets.map((asset) => {
    const resolved = media.get(asset.id);
    if (resolved === undefined) throw new ProjectServiceError("ASSET_REFERENCE_INVALID");
    return structuredClone(resolved.asset);
  });
  const reconstructed = validateContract("MotionProject", project);
  if (!reconstructed.valid) throw new ProjectServiceError("PROJECT_VALIDATION_FAILED");
  signal?.throwIfAborted();
  return Object.freeze({
    project: reconstructed.value,
    media,
    constraints: structuredClone(browserProject.constraints)
  });
}
