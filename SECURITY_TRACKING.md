# Security Tracking

Audit date: 2026-07-27
Disposition update: 2026-07-28

Values were never printed. The aggregate API package was read only during the audit and was never used by the engine.

Before Stage 6, the user manually removed the ignored and untracked `doubao_glm_api_package/` directory. It is absent and has zero tracked files. It must not be restored, rebuilt, copied, or referenced from an old directory, old commit, or backup. The ignore rule remains only as a guard against accidental recreation and tracking.

V1 has one model Provider: server-side Volcengine Ark using `doubao-seed-2-0-lite-260428`. Provider credentials must be externally supplied to the server and must never enter client code or tracked configuration.

## Historical inventory

This table records the 2026-07-27 audit state of the now-removed input. It does not describe files currently present in the workspace.

| Category | Finding | State |
| --- | --- | --- |
| `.env` files | None found | VERIFIED |
| credential-named files | None found | VERIFIED |
| hard-coded API keys | 12 source locations: six Doubao API clients and six GLM API clients (including `glm3-max.py`) | HISTORICAL; SOURCE REMOVED |
| hard-coded OSS credentials | Access Key ID/Secret repeated in three source files | HISTORICAL; SOURCE REMOVED |
| hard-coded database password | Repeated in three aggregate modules | HISTORICAL; SOURCE REMOVED |
| Python cache | Two `__pycache__` directories containing eight `.pyc` files | HISTORICAL; SOURCE REMOVED |
| build output | No build/dist directory found | VERIFIED |

## Historical credential inventory

These paths are retained only as audit evidence for the removed package. They are not current workspace paths, must not be resolved through another source, and must never be used to restore or reconstruct the package. Any still-active historical credentials must not be reused and must be revoked or rotated outside this repository.

| File | Evidence | Required action |
| --- | --- | --- |
| `doubao_glm_api_package/PyLaTex/API/Doubao-Seedream-4.0.py` | `api_key` literal at line 11 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Doubao-Seedream-4.5.py` | `api_key` literal at line 11 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Doubao_seed_1.6.py` | `api_key` literal at line 5 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Doubao_seed_1.6_flash.py` | `api_key` literal at line 5 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Doubao_seed_1.8.py` | `api_key` literal at line 5 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Doubao_seed_2.0_pro.py` | `api_key` literal at line 4 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm-4.7.py` | client `api_key` literal at line 3 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm3-max.py` | `api_key` literal at line 807 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm5.py` | `API_KEY` literal at line 4 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm5_hyml.py` | `API_KEY` literal at line 5 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm5_vision.py` | `API_KEY` literal at line 4 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/glm_ocr.py` | `API_KEY` literal at line 7 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Aggregate_LLM/Glm_LLM.py` | default database password at line 57 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Aggregate_LLM/token_cost.py` | default database password at line 22 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Aggregate_LLM/Volcano_LLM.py` | default database password at line 57 | Rotate; externalize; verify |
| `doubao_glm_api_package/PyLaTex/API/Aggregate_LLM/image/oss_uploader.py` | OSS ID/Secret at lines 18-19 | Rotate; externalize; verify |
| `doubao_glm_api_package/root_scripts/Doubao-Seedream-4.0.py` | OSS ID/Secret at lines 30-31 | Rotate; externalize; verify |
| `doubao_glm_api_package/root_scripts/Doubao_WSSP_1.0_1.py` | OSS ID/Secret at lines 20-21 | Rotate; externalize; verify |

## `6-S7` AI integration release criteria

Before any V1 AI integration: the only model Provider is server-side Volcengine Ark using `doubao-seed-2-0-lite-260428`; credentials come from an approved external server-side secret source; missing configuration fails explicitly; no provider secret or direct provider call is present in client code; the removed aggregate package remains absent with no runtime reference; Group 7 verifies these controls; and Group 8 re-verifies before integration. Restoring, rebuilding, or substituting the removed package is outside the V1 plan and prohibited.
