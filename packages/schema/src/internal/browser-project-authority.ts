import type { Animatable, JsonValue } from "@codemotion/core";
import { validateAiPlanCompletedResultV2Internal } from "../ai-plan-result.js";
import {
  classifyBrowserProjectAssetReferencesV1Internal,
  createBrowserProjectValidationOptionsV1Internal,
  sanitizeBrowserProjectV1Internal,
  validateBrowserProjectEnvelopeV1Internal,
  type BrowserProjectAuthorityV1
} from "../browser-project.js";
import {
  validateEditorPreviewRequestV1Internal,
  validateExportCreateRequestV1Internal,
  validateExportTaskViewV1Internal
} from "../editor-render-api.js";

const AUTHORITY_CONFIGURATION_MESSAGE = "Browser project authority configuration failed.";

export class BrowserProjectAuthorityConfigurationError extends Error {
  public constructor() {
    super(AUTHORITY_CONFIGURATION_MESSAGE);
    this.name = "BrowserProjectAuthorityConfigurationError";
  }
}

export type BrowserProjectAnimatableEvaluatorV1 = (
  value: Animatable,
  time: number
) => JsonValue;

function frozenMethod<TFunction extends (...args: never[]) => unknown>(method: TFunction): TFunction {
  return Object.freeze(method);
}

/**
 * Package-internal composition hook. G0-2 calls this once at module initialization
 * with its statically imported P0 registry and timeline evaluator. Request handlers
 * consume only the returned authority and never call this builder.
 */
export function createBrowserProjectAuthorityV1(
  registry: unknown,
  evaluateAnimatableAt: unknown
): BrowserProjectAuthorityV1 {
  let options;
  try {
    options = createBrowserProjectValidationOptionsV1Internal(registry, evaluateAnimatableAt);
  } catch {
    throw new BrowserProjectAuthorityConfigurationError();
  }
  if (options === undefined) throw new BrowserProjectAuthorityConfigurationError();

  try {
    const authority: BrowserProjectAuthorityV1 = {
      validateBrowserProjectEnvelope: frozenMethod((value: unknown) =>
        validateBrowserProjectEnvelopeV1Internal(value, options)),
      sanitizeBrowserProject: frozenMethod((project, constraints) =>
        sanitizeBrowserProjectV1Internal(project, constraints, options)),
      classifyBrowserProjectAssetReferences: frozenMethod((value: unknown) => {
        const validated = validateBrowserProjectEnvelopeV1Internal(value, options);
        if (!validated.valid) return validated;
        return {
          valid: true as const,
          value: classifyBrowserProjectAssetReferencesV1Internal(
            validated.value.project,
            validated.value.constraints
          )
        };
      }),
      validateAiPlanCompletedResult: frozenMethod((value: unknown) =>
        validateAiPlanCompletedResultV2Internal(value, options)),
      validateEditorPreviewRequest: frozenMethod((value: unknown) =>
        validateEditorPreviewRequestV1Internal(value, options)),
      validateExportCreateRequest: frozenMethod((value: unknown) =>
        validateExportCreateRequestV1Internal(value, options)),
      validateExportTaskView: frozenMethod((value: unknown) =>
        validateExportTaskViewV1Internal(value))
    };
    return Object.freeze(authority);
  } catch {
    throw new BrowserProjectAuthorityConfigurationError();
  }
}
