# Stage 6 offline export and media input

Status: **FROZEN** on 2026-07-28 after Group 8 re-verification.

## Contract boundary

No public Core, Project Schema, Effect Definition Schema, or Renderer Adapter API was
changed. Imported media uses the frozen `AssetDefinition` (`id`, `type`, `uri`, `hash`,
`metadata`), layer `source.assetId`, `audioTracks.assetId`, and
`RenderPreset.settings`. `@codemotion/exporter` is Group 5 infrastructure.

## Deterministic export

`exportFixedFrames` requests exactly `ceil(duration * fps)` RGBA frames. Frame `n`
always uses `time = n / fps` and `deltaTime = 1 / fps`; wall-clock time is never read.
Every frame is byte-count checked and SHA-256 inspected before it reaches FFmpeg.
Failures identify the stage, frame, fixed time, and minimum recovery frame. An optional
checkpoint records the next frame. PNG sequences resume at that frame without rewriting
earlier frames; inter-frame compressed outputs honestly recover from frame 0. PNG sequence, GIF, VP9 WebM, and H.264 MP4 are
server-side FFmpeg outputs; optional Opus/AAC muxing is performed by the same process.
Browser encoding is not the sole or authoritative output path.

The server-side project frame producer renders the frozen `MotionProject` main
composition rather than transcoding an independently selected file. It resolves visible,
solo and active layer state at fixed project time, follows nested compositions, decodes
image/video layers through `source.assetId`, evaluates P0 effect parameters and CPU
fallbacks, then applies layer opacity and blend composition. Unknown effects, cyclic
compositions, missing verified references, and masks without a deterministic raster
source fail explicitly instead of being silently omitted.

MP4 deliberately rejects alpha. GIF has palette transparency rather than full RGBA.
WebM requests `yuva420p` through `libvpx-vp9`; an Alpha preset rejects other VP9
encoders instead of degrading. This FFmpeg build's default native `vp9` decoder returns
opaque RGBA even when `alpha_mode=1`. Independent Alpha verification must explicitly
select `-c:v libvpx-vp9`, which returns the encoded Alpha plane.

## Media input

`importMedia` accepts image, audio, and video only from configured real-path roots. It
checks traversal/symlinks, extension/MIME agreement, selected magic bytes, regular-file
status, byte/duration/dimension limits, FFprobe structure, and an actual FFmpeg decode.
It streams SHA-256, derives `asset_<24 hex>` stable IDs, stores content-addressed files,
returns a Resource Manager descriptor, and records only sanitized technical metadata.
Cancellation is propagated through reads, copies, FFprobe, and FFmpeg. Partial temp
files are removed one explicit path at a time. Project insertion deduplicates by stable
ID. Stored media removal accepts only an `AssetDefinition` plus the configured storage
root, re-runs root/symlink/hash verification, and then removes that one
content-addressed file. Caller-supplied paths are never accepted as cleanup authority.

Preview eligibility is established by successful decode plus the returned sanitized
`ResourceDescriptor`. `decodeMediaFrame`/`decodeAudioPreview` feed previews, and the
same visual frame producer and stored audio path feed formal export. Neither
API keys, model calls, browser-to-model connections, nor uploads exist in this package.

`verifyStoredMediaAsset` is the sole reusable server-side integrity boundary. It checks
the frozen asset URI and hash forms, root containment, symlink rejection, regular-file
status, URI/hash agreement, the declared `asset.metadata.bytes`, and a streamed disk
SHA-256 before returning `VerifiedStoredMedia`. Project metadata is an untrusted
declaration: `metadata.bytes` must be a finite, non-negative safe integer exactly equal
to the same verification pass's `stat.size`. The returned read-only `trustedBytes`,
derived only from that `stat`, is the sole byte value server-side consumers may use for
security limits; the verifier does not rewrite project metadata. Cancellation and every
failure use path-free messages. The render task
service calls it before queue insertion and immediately before FFmpeg input; it never
updates the project hash or renames tampered content.

## Future Ark eligibility, no Stage 6 upload

- ordinary Files API audio/video: at most 512 MB;
- video TOS: at most 2 GB;
- Base64/URL audio: at most 25 MB and 120 minutes;
- Base64/URL video: at most 50 MB;
- Base64 video estimated request body: at most 64 MB.

Eligibility is metadata only and explicitly says that Stage 6 performs no upload.

## Local encoder facts

Observed on Windows on 2026-07-28 with
`ffmpeg 2026-07-23-git-80eb9e99b9-full_build-www.gyan.dev`, GCC 16.1.0:

| Format | Matrix case | Probed output |
| --- | --- | --- |
| PNG | 24 fps, 64x36, alpha | PNG, `rgba` |
| GIF | 30 fps, 80x48 | GIF, `bgra` decode |
| WebM | 60 fps, 64x36, alpha | VP9, `alpha_mode=1` |
| WebM | 24 fps, 80x48, audio | VP9 + Opus |
| MP4 | 30 fps, 64x36 | H.264, `yuv420p` |
| MP4 | 60 fps, 80x48, audio | H.264 + AAC |
| Imported media | 24 fps, 32x24, PNG + WAV | H.264 + AAC |

The corrected Alpha fixture contains three spatial regions with input Alpha 0, 128,
and 255. Explicit libvpx decode of the final multi-frame WebM preserved all three.
Headless Edge 150 composited that file over green and blue backgrounds: transparent
samples were `[0,255,0]` and `[0,0,255]`; semi-transparent samples differed with the
background; opaque samples were identical. The same QA closes the browser and HTTP
server in `finally`.

GIF timestamps are quantized to its 1/100-second time base. The requested 30 fps case
is therefore probed as `100/3` fps (3 centiseconds per frame); this limitation is
recorded rather than reported as exact 30 fps.

The build is configured with `--enable-gpl`, `--enable-version3`,
`--enable-libx264`, `--enable-libvpx`, and `--enable-libopus`. GPL-enabled
`libx264` is not a neutral redistribution choice; AAC is the native FFmpeg encoder
in this build; VP9 and Opus use external libvpx/libopus. Product distribution must
perform its own FFmpeg build, source-offer/compliance, and patent/license review.

Verification: `npm run typecheck` passed. The full repository suite passed 18 test
files and 405 tests. The suite includes actual FFprobe inspection rather than
extension-only assertions.

## Group 4 editor integration

The editor render center uses a same-origin, server-side task adapter. A task is shown
only after the adapter validates the frozen `MotionProject`, verifies every
content-addressed media file referenced by the main composition and requested project
audio track, and accepts the real exporter request. Progress advances
from actual `renderFrame` calls. Logs, failed frame/time/stage, recovery frame, codec,
output bytes, local machine facts, download, retry, and process-lifetime history are
derived from the exporter task rather than synthesized in the browser.

Image/video input comes only from layer `source.assetId`; audio comes only from
`audioTracks.assetId`. The Stage 6 adapter supports one project audio track per export.
The UI media index displays MIME, codec, dimensions, duration, byte size, and a short
hash, never the source or stored filesystem path; it does not claim current disk
integrity until task validation runs. PNG sequence downloads are real ZIP archives.
GIF/PNG reject audio, MP4 rejects alpha, dimensions are capped at 8192 per side and
33,554,432 total pixels, and missing, tampered, or too-short media is reported before
queue insertion or during the second execution-time verification. Stage 6 adds no
model, provider, key, upload, or external network call.
