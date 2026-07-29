# Stage 7 server-side multimodal planning

Status: **GROUP 6 PASS** and **GROUP 8 REVERIFIED** on 2026-07-29.

## Boundary

`@codemotion/ai-planner` is server-only. V1 exposes a replaceable `ModelProvider`
contract but includes exactly one network provider: Volcengine Ark using
`doubao-seed-2-0-lite-260428`. It changes no frozen Core, Project Schema, Effect
Definition Schema, Renderer Adapter, or browser API.
This is the V1 integration decision: the original aggregate package was removed by
the user before Stage 6 and must remain absent, unrestored, and unreferenced.

Inputs refer to Stage 6 `asset_<24 hex>` IDs and frozen `AssetDefinition` values.
Before reading media, the provider calls `verifyStoredMediaAsset`, including its
root, symlink and streamed SHA-256 checks. Absolute paths remain inside the server
call. API keys, original bytes, Ark file IDs, and raw provider responses are not
returned or written into the editor.

## Official Files contract

The implementation is fixed to the following official Ark documentation:

- [Upload file](https://www.volcengine.com/docs/82379/1870405): `POST /api/v3/files`;
  multipart `purpose=user_data` and binary `file`; the returned file object has a
  top-level `id`. Default retention is 7 days and `expire_at` supports 1-30 days.
- [File input](https://www.volcengine.com/docs/82379/1885708): an uploaded file can
  be referenced only after retrieval reports `status=active`; the documented upload
  example returns `status=processing`.
- [Delete file](https://www.volcengine.com/docs/82379/1870408):
  `DELETE /api/v3/files/{file_id}` and success is `{object:"file",deleted:true}`.
- [Audio understanding](https://www.volcengine.com/docs/82379/2377589): ordinary
  Files API input is limited to 512 MB and Responses uses
  `{type:"input_audio",file_id:"..."}`.
- [Video understanding](https://www.volcengine.com/docs/82379/1895586): ordinary
  Files storage is limited to 512 MB; TOS video is limited to 2 GB. Responses uses
  `{type:"input_video",file_id:"..."}`. The official page currently shows
  `doubao-seed-2-1-pro-260628` in one video example; this project deliberately
  replaces it with the sole V1 model.

Local audio/video always uses multipart Files API. Video upload sends
`preprocess_configs[video][model]=doubao-seed-2-0-lite-260428` and an fps in
`[0.2,5]`. TOS is documented but not implemented in this stage, so no client can
select or upload to TOS. Image uses a server-built small data URL after Stage 6
verification and a conservative 10 MB / 8192-per-side limit.

## Controls

The provider enforces 512 MB ordinary media, six-hour media duration, MIME/type
agreement inherited from Stage 6, cancellation, request timeout, two bounded retries
for 408/429/5xx, concurrency and per-minute rate gates, upload byte progress, active
status polling, sanitized error mapping, and a path/body/key/file-ID-free audit
record. Media size gates consume `VerifiedStoredMedia.trustedBytes`, never project
metadata. Images are checked before read and again against the actual Buffer length
and SHA-256 before any data URL is constructed. Multipart content length and progress
derive from trusted bytes, with a fresh pre-upload stat and streamed byte-count check.

Every supplier request identifier is converted during response handling to
`request-sha256:<32 hex>`: the first 128 bits of SHA-256. No original prefix, suffix,
or reversible encoding crosses into traces, audits, task results, evidence, or docs.
For two fixed distinct IDs the random collision probability is approximately
`2^-128`; the birthday bound is approximately `2^64` distinct IDs. Every created
remote file is held only in an in-memory local-ID mapping and is individually deleted
in `finally` with a separate cleanup timeout. The mapping belongs to one
`understand` call, not the Provider instance, so concurrent requests using the same
local asset cannot overwrite, reference, or clean up each other's Ark file IDs.

The normalized result retains model ID, request fingerprint, input hash, usage tokens,
latency, confidence, and risks. Cost uses the official
[model price](https://www.volcengine.com/docs/82379/1544106) regular-online,
under-32k rates. Since usage does not split mixed audio/non-audio input tokens,
audio calls record an explicit lower/upper CNY estimate instead of false precision.
It covers text requirements/constraints; image
subject/composition/OCR/color/style; audio transcript/speakers/emotion/BGM/rhythm/
sound effects/timestamps; and video shots/actions/events/on-screen text/audio-visual
relations/time ranges.

The deterministic P0 path is:

`understanding -> storyboard -> layers -> real P0 effect retrieval -> defaults from
effect schema -> MotionProject DSL -> frozen schema -> static duration/reference/
cycle/parameter/performance rules -> 160x90 draft pixel preview hashes`.

## Verification

Offline tests cover ten prompt categories, prompt injection, local-path and
credential redaction, malformed resource IDs, authentication error mapping,
multipart field construction, parsed file-ID use, cleanup, audit isolation,
structured mapping, real P0 retrieval, frozen Schema validation, and draft preview.
They are regression evidence only.

`npm run qa:live -w @codemotion/ai-planner` runs text, image, audio, video, and an
audio-video combination against the real Responses API. It writes only sanitized
evidence to ignored `tmp/stage-7-live/evidence.json`; model output must enter
Storyboard, DSL, Schema and preview. Any failed case keeps the stage BLOCKED.

## Real connectivity evidence

Final gate run: 2026-07-29, all Responses calls returned HTTP 200 from
`doubao-seed-2-0-lite-260428`. Latency is end-to-end server latency. CNY is an
estimate under the documented regular-online, under-32k tier; actual billing prevails.

| Case | Request fingerprint | Input hash | Latency | Tokens | Estimated CNY | Structured result -> DSL |
| --- | --- | --- | ---: | ---: | ---: | --- |
| text | `request-sha256:2357d3863c2912d9e3b844ef5024b0e0` | `sha256:89e67124890d2072f336d3149f810fe518ddd38a5ebe3cd603de6b21a9ecd020` | 13142 ms | 1504 | 0.00301140 | text requirements/constraints -> `fx.text.textPathReveal` |
| image | `request-sha256:37ccb58e0044b77b7734cd9665e3830a` | `sha256:805d0a3c3626bd9b5674c39c27b40eb5c2588b3a43166b3b91de65b221112cea` | 16532 ms | 2866 | 0.00398160 | subject/composition/OCR/color/style -> `fx.vector.pathMorph` |
| audio | `request-sha256:6c49f5ece07b072bbf118a70be9d9333` | `sha256:d2ad7905094bd6815f83bef300a1d669a32ebf91d043572d5b62f67da6fc3b19` | 26603 ms | 1937 | 0.00443520-0.01154160 | transcript/speaker/emotion/BGM/rhythm/SFX -> `fx.text.textPathReveal` |
| video | `request-sha256:1472d2e34afb7faf71febad841e02062` | `sha256:34b65e28c1704c2693b12a9780188502cbb523f2d1253ffdc41e051a812f0296` | 27008 ms | 2460 | 0.00467100 | shot/action/event/text/AV relation -> `fx.text.wordExplode` |
| audio + video | `request-sha256:2e99f6a71849abf04b7e5be063157ecf` | `sha256:1a07d4430c82cd74af7286b7917121bdc47ec9a758df71754dedfb28837ab015` | 40940 ms | 2996 | 0.00651360-0.01847520 | one audio + one video structure -> `fx.motion.slide` |

Each row produced a frozen-Schema-valid `MotionProject` and two deterministic 160x90
draft preview hashes. The audio call created/retrieved/deleted one Files API object;
the video call did the same; the combination created/retrieved/deleted two. All four
delete calls returned HTTP 200. No remote file ID or provider raw body is present in
this evidence.

The browser gate then used one real text + image + audio + video request
(`request-sha256:e42b49d7fb8c6313b7c260ea65824df1`) to produce a frozen-Schema-valid
two-layer project. It was loaded into the editor, manually edited, autosaved and
recovered, previewed, and exported through the Stage 6 service as a playable
640x360, 24 FPS H.264/AAC MP4 with 12 distinct decoded frame hashes.

Final local verification: `npm run typecheck` passed; `npm test` passed 18 test files
and 411 tests. This includes Stage 6 image/audio/video format, damaged media, limit,
decode and stored-resource integrity coverage plus the Stage 7 mock, injection,
authorization, credential leakage, provider failure, retry, cancellation, rate,
mapping, Schema, static rule and preview coverage.
