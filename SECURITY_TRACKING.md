# Security Tracking

Audit date: 2026-07-27

Values were never printed. The aggregate API package was read only and remains unmodified.

The entire `doubao_glm_api_package/` directory is ignored, untracked, and prohibited from force-add. It may not be used by the engine until all provider credentials are rotated and externalized. Rotation and externalization are the `6-S7` gate before real AI integration; they do not block `1-S1` while the package remains untracked and unused.

## Inventory

| Category | Finding | State |
| --- | --- | --- |
| `.env` files | None found | VERIFIED |
| credential-named files | None found | VERIFIED |
| hard-coded API keys | 12 source locations: six Doubao API clients and six GLM API clients (including `glm3-max.py`) | BLOCKED |
| hard-coded OSS credentials | Access Key ID/Secret repeated in three source files | BLOCKED |
| hard-coded database password | Repeated in three aggregate modules | BLOCKED |
| Python cache | Two `__pycache__` directories containing eight `.pyc` files | IGNORED; files preserved |
| build output | No build/dist directory found | VERIFIED |

## Credential inventory inside the ignored package

These files are evidence within the wholly ignored package. The paths are recorded for later remediation; no individual file is eligible for tracking.

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

Before any AI integration: provider-side rotation is confirmed for every credential; replacements come from an approved external secret source; missing configuration fails explicitly; the full package scan returns no credential-shaped literal; Group 7 verifies the sanitized package; and Group 8 decides whether a separately reviewed package may replace the ignored input. The current package remains preserved and ignored unless the user explicitly authorizes a later package transition.
