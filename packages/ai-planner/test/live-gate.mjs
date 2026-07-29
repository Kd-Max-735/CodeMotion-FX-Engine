import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importMedia } from "@codemotion/exporter";
import {
  ARK_V1_MODEL,
  VolcengineArkProvider,
  planAnimation
} from "../dist/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const root = resolve(repositoryRoot, "tmp/stage-7-live");
const storageDirectory = resolve(root, "storage");
const evidencePath = resolve(root, "evidence.json");
const fixtureRoot = resolve(repositoryRoot, "tmp/stage-6-test/input");
const fixtures = {
  image: {
    path: resolve(repositoryRoot, process.env.STAGE7_IMAGE_PATH ?? resolve(fixtureRoot, "sample.png")),
    mime: "image/png"
  },
  audio: {
    path: resolve(repositoryRoot, process.env.STAGE7_AUDIO_PATH ?? resolve(fixtureRoot, "sample.wav")),
    mime: "audio/wav"
  },
  video: {
    path: resolve(repositoryRoot, process.env.STAGE7_VIDEO_PATH ?? resolve(fixtureRoot, "sample.mp4")),
    mime: "video/mp4"
  }
};

const apiKey = process.env.ARK_API_KEY;
if (!apiKey) throw new Error("ARK_API_KEY is required for the Stage 7 live gate.");
await mkdir(storageDirectory, { recursive: true });

const imported = {};
for (const [modality, fixture] of Object.entries(fixtures)) {
  imported[modality] = await importMedia({
    sourcePath: fixture.path,
    claimedMime: fixture.mime,
    allowedRoots: [resolve(fixture.path, "..")],
    storageDirectory
  });
}

const audits = [];
const provider = new VolcengineArkProvider({
  apiKey,
  audit: (record) => audits.push(record),
  maxRetries: 2,
  processingPollMs: 2_000
});

const resource = (modality) => ({
  modality,
  localAssetId: imported[modality].asset.id,
  asset: imported[modality].asset,
  storageDirectory,
  ...(modality === "video" ? { videoFps: 0.3 } : {})
});

const cases = [
  {
    id: "text",
    prompt: "Create a restrained six-second title animation with clear hierarchy.",
    resources: []
  },
  {
    id: "image",
    prompt: "Analyze this reference image and plan a short composition that preserves its subject and colors.",
    resources: [resource("image")]
  },
  {
    id: "audio",
    prompt: "Analyze the audio, including transcript, speakers, emotion, rhythm, BGM, sound effects and timestamps.",
    resources: [resource("audio")]
  },
  {
    id: "video",
    prompt: "Analyze the video shots, actions, events, on-screen text and audio-visual relation with time ranges.",
    resources: [resource("video")]
  },
  {
    id: "audio-video-combination",
    prompt: "Jointly understand the audio and video, then plan synchronized effects without inventing unsupported events.",
    resources: [resource("audio"), resource("video")]
  }
];

const results = [];
let failure;
for (const testCase of cases) {
  const started = Date.now();
  try {
    const result = await provider.understand({
      prompt: testCase.prompt,
      resources: testCase.resources,
      timeoutMs: 180_000
    });
    const planned = planAnimation(result, { resources: testCase.resources, duration: 6 });
    if (planned.dsl.compositions[0]?.layers.length === 0 || planned.preview.frameHashes.length === 0) {
      throw new Error("Real response did not enter the DSL and preview pipeline.");
    }
    results.push({
      id: testCase.id,
      passed: true,
      modelId: result.trace.modelId,
      requestFingerprint: result.trace.requestFingerprint,
      inputHash: result.trace.inputHash,
      latencyMs: Date.now() - started,
      usage: result.trace.usage,
      structuredCounts: {
        images: result.understanding.images.length,
        audio: result.understanding.audio.length,
        video: result.understanding.video.length,
        risks: result.understanding.risks.length
      },
      dsl: {
        projectId: planned.dsl.id,
        shots: planned.storyboard.shots.length,
        layers: planned.dsl.compositions[0].layers.length,
        effectIds: planned.dsl.compositions[0].layers.flatMap((layer) => layer.effects.map((effect) => effect.effectId)),
        previewHashes: planned.preview.frameHashes
      }
    });
  } catch (error) {
    failure = error;
    results.push({
      id: testCase.id,
      passed: false,
      modelId: ARK_V1_MODEL,
      latencyMs: Date.now() - started,
      error: {
        code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown",
        message: error instanceof Error ? error.message : "Live gate failed."
      }
    });
    break;
  }
}

const evidence = {
  gate: "G6-S7",
  generatedAt: new Date().toISOString(),
  modelId: ARK_V1_MODEL,
  endpointCategories: [...new Set(audits.map((item) => item.endpoint))],
  audits,
  cases: results,
  passed: !failure && results.length === cases.length && results.every((item) => item.passed)
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence, null, 2));
if (failure) process.exitCode = 1;
