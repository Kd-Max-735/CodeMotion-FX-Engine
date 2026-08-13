import type { EffectDefinition, EffectInstance, JsonObject, JsonValue } from "@codemotion/core";
import { evaluateAnimatable } from "@codemotion/timeline";
import {
  GROUP_2_P0_EFFECTS,
  P0_EFFECTS,
  makeTextExtrudeCatalogFixture,
  P0_EFFECTS_BY_ID
} from "./catalog.js";
import type { P0CatalogEffectDefinition } from "./catalog.js";
import {
  makeEffectTimeSample,
  makeBrushCoverage,
  makeMaskSurface,
  makeRealInputFixture,
  type RealInputKind
} from "./inputs.js";
import type { P0EffectDefinition, PixelSurface } from "./types.js";

export type EffectCardImplementation =
  | "prerendered"
  | "template"
  | "library-wrapper"
  | "procedural";

export type EffectCardTarget = "video" | "image" | "text" | "logo" | "audio" | "composition";
export type EffectCardStatus = "draft" | "verified" | "published";

export interface EffectCardMediaDescriptor {
  readonly kind: "runtime-frame" | "runtime-loop";
  readonly effectId: string;
  readonly representativeProgress: number;
  readonly width: 160;
  readonly height: 90;
  readonly alt: string;
}

export interface EffectCardFixture {
  readonly fixtureId: string;
  readonly inputKind: RealInputKind;
  readonly secondaryInput: boolean;
  readonly demoText?: string;
}

export interface EffectCardSearchMetadata {
  readonly aliases: readonly string[];
  readonly useCases: readonly string[];
  readonly styles: readonly string[];
  readonly materials: readonly string[];
  readonly explanation: string;
}

export interface EffectCard {
  readonly id: string;
  readonly effectId: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly category: P0EffectDefinition["category"];
  readonly categoryLabel: string;
  readonly tags: readonly string[];
  readonly preview: EffectCardMediaDescriptor;
  readonly thumbnail: EffectCardMediaDescriptor;
  readonly defaultDuration: number;
  readonly supportedTargets: readonly EffectCardTarget[];
  readonly parameterSchema: EffectDefinition["parameterSchema"];
  readonly defaultParams: JsonObject;
  readonly editableParameterNames: readonly string[];
  readonly performanceClass: EffectDefinition["performanceClass"];
  readonly implementationType: EffectCardImplementation;
  readonly status: EffectCardStatus;
  readonly acceptanceState: "pending-human" | "accepted";
  readonly ai: EffectCardSearchMetadata;
  readonly fixture: EffectCardFixture;
}

type CardSeed = Omit<EffectCard, "version" | "parameterSchema" | "defaultParams" | "performanceClass" | "preview" | "thumbnail"> & {
  readonly displayName: string;
  readonly effectId: string;
  readonly categoryLabel: string;
  readonly fixture: EffectCardFixture;
  readonly defaultDuration: number;
  readonly supportedTargets: readonly EffectCardTarget[];
  readonly tags: readonly string[];
  readonly ai: EffectCardSearchMetadata;
  readonly implementationType: EffectCardImplementation;
};

const categoryLabels: Record<P0EffectDefinition["category"], string> = {
  motion: "基础运动", text: "文字标题", vector: "矢量图形", draw: "手写绘制",
  light: "光效", post: "后期处理", transition: "转场", composite: "合成遮罩"
};

const seed = (
  effectId: string,
  id: string,
  displayName: string,
  description: string,
  tags: readonly string[],
  fixture: EffectCardFixture,
  supportedTargets: readonly EffectCardTarget[],
  ai: EffectCardSearchMetadata,
  defaultDuration: number,
  implementationType: EffectCardImplementation
): CardSeed => {
  const definition = P0_EFFECTS_BY_ID.get(effectId);
  if (!definition) throw new Error(`Sample card source is unavailable: ${effectId}`);
  return {
    id,
    effectId,
    name: displayName,
    displayName,
    description,
    category: definition.category,
    categoryLabel: categoryLabels[definition.category],
    tags,
    defaultDuration,
    supportedTargets,
    implementationType,
    status: "verified",
    acceptanceState: "pending-human",
    ai,
    fixture
  } as CardSeed;
};

type CardCopy = readonly [name: string, description: string, tags: readonly string[]];
const CARD_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "fx.motion.fade": ["渐显", "fade in"],
  "fx.motion.slide": ["划入", "滑动", "slide in"],
  "fx.text.typewriter": ["打印机", "逐字出现", "打字"],
  "fx.draw.handwriting": ["笔迹", "书写"],
  "fx.light.neonGlow": ["霓虹", "发光", "光晕"],
  "fx.post.gaussianBlur": ["柔和", "朦胧", "背景柔化"],
  "fx.transition.wipe": ["页面切换", "场景切换", "擦除转场"],
  "fx.composite.maskReveal": ["蒙版", "遮罩显现"]
});
const CARD_COPY: Readonly<Record<string, CardCopy>> = Object.freeze({
  "fx.motion.fade": ["淡入", "让完整画面在开场平滑显现。", ["入场", "透明度", "柔和"]],
  "fx.motion.slide": ["滑入", "让画面从指定方向滑入并带有回弹。", ["入场", "位移", "回弹"]],
  "fx.motion.scalePop": ["缩放弹出", "通过弹簧缩放让主体快速弹出。", ["缩放", "弹簧", "入场"]],
  "fx.motion.rotateIn": ["旋转入场", "围绕可调中心旋转进入画面。", ["旋转", "中心点", "入场"]],
  "fx.motion.bounce": ["重力弹跳", "以重力、次数和阻尼控制连续弹跳。", ["弹跳", "重力", "阻尼"]],
  "fx.motion.elastic": ["弹性摆动", "沿指定轴产生衰减弹性位移。", ["弹性", "衰减", "位移"]],
  "fx.motion.float": ["循环漂浮", "按频率和幅度持续漂浮。", ["漂浮", "循环", "轻盈"]],
  "fx.motion.shake": ["冲击抖动", "使用确定性随机种子产生冲击抖动。", ["抖动", "冲击", "确定性"]],
  "fx.text.typewriter": ["打字机", "按字符节奏从时间零开始揭示文字。", ["文字", "逐字", "光标"]],
  "fx.text.characterCascade": ["字符级联", "逐字符、单词或行错时落入画面。", ["文字", "级联", "错时"]],
  "fx.text.kineticTypography": ["动态排版", "根据节拍映射缩放和重排文字单元。", ["文字", "节拍", "排版"]],
  "fx.text.textPathReveal": ["路径文字显现", "让文字沿真实矢量路径逐步显现。", ["文字", "路径", "显现"]],
  "fx.text.textMorph": ["文字变形", "在源文字与目标文字轮廓之间插值。", ["文字", "变形", "轮廓"]],
  "fx.text.scrambleDecode": ["乱码解码", "从确定性乱码逐字锁定为目标文字。", ["文字", "解码", "科技"]],
  "fx.text.wordExplode": ["单词爆炸", "按单词或字符将文字向空间抛散。", ["文字", "爆炸", "空间"]],
  "fx.text.textExtrude3D": ["3D 立体文字", "由真实字形覆盖生成可降级的立体挤出。", ["文字", "3D", "挤出"]],
  "fx.vector.pathTrim": ["路径修剪", "按照真实路径弧长控制描边起止位置。", ["矢量", "路径", "描边"]],
  "fx.vector.pathMorph": ["路径变形", "在两条标准化矢量路径之间插值。", ["矢量", "变形", "路径"]],
  "fx.vector.shapeRepeater": ["图形重复器", "重复并逐级变换真实矢量图形。", ["矢量", "重复", "阵列"]],
  "fx.vector.radialBurst": ["径向爆发", "程序化生成可控数量的径向线束。", ["矢量", "放射", "爆发"]],
  "fx.draw.handwriting": ["手写", "用真实文字轮廓和笔刷遮罩逐步书写。", ["手写", "文字", "笔迹"]],
  "fx.draw.brushReveal": ["笔刷显现", "使用真实笔刷覆盖缓冲显现内容。", ["绘制", "笔刷", "显现"]],
  "fx.draw.inkSpread": ["墨水扩散", "通过扩散、吸收与边缘噪声模拟墨迹。", ["绘制", "墨水", "扩散"]],
  "fx.draw.chalkStroke": ["粉笔笔触", "以颗粒和散射生成确定性粉笔质感。", ["绘制", "粉笔", "颗粒"]],
  "fx.light.neonGlow": ["霓虹发光", "为真实画面边缘增加可控霓虹光晕。", ["光效", "霓虹", "边缘"]],
  "fx.light.scanBeam": ["扫描光束", "让柔和光束按角度和速度扫过画面。", ["光效", "扫描", "科技"]],
  "fx.light.lensFlare": ["镜头光晕", "生成光源鬼影、条纹和色散。", ["光效", "镜头", "色散"]],
  "fx.light.energyPulse": ["能量脉冲", "从指定中心发射多层能量环。", ["光效", "脉冲", "能量"]],
  "fx.post.gaussianBlur": ["高斯模糊", "以参数化高斯核柔化真实画面。", ["后期", "模糊", "柔和"]],
  "fx.post.directionalBlur": ["方向模糊", "沿可调角度和距离进行多采样模糊。", ["后期", "方向", "速度"]],
  "fx.post.radialBlur": ["径向模糊", "围绕指定中心产生缩放或旋转模糊。", ["后期", "径向", "旋转"]],
  "fx.post.motionBlur": ["运动模糊", "依据速度向量和快门角模拟拖影。", ["后期", "运动", "拖影"]],
  "fx.transition.wipe": ["线性擦除", "使用两个不同输入完成线性擦除转场。", ["转场", "擦除", "双素材"]],
  "fx.transition.radialWipe": ["径向擦除", "以扇形角度在两个输入之间切换。", ["转场", "径向", "双素材"]],
  "fx.transition.liquidWipe": ["液态擦除", "使用确定性噪声边界完成液态转场。", ["转场", "液态", "双素材"]],
  "fx.transition.pixelDissolve": ["像素溶解", "按像素块和种子阈值切换两个输入。", ["转场", "像素", "双素材"]],
  "fx.composite.maskReveal": ["遮罩显现", "用真实遮罩覆盖控制画面显现。", ["合成", "遮罩", "双素材"]],
  "fx.composite.trackMatte": ["轨道遮罩", "使用独立 matte 输入控制透明度或亮度。", ["合成", "Matte", "双素材"]],
  "fx.composite.blend": ["混合模式", "用真实双输入执行可调混合与不透明度。", ["合成", "混合", "双素材"]],
  "fx.composite.displacementMap": ["置换贴图", "使用独立位移输入扭曲主画面采样坐标。", ["合成", "置换", "双素材"]]
});

function fixtureFor(effectId: string, category: P0EffectDefinition["category"]): EffectCardFixture {
  const secondaryInput = category === "transition" || category === "composite";
  const inputKind: RealInputKind = category === "text" || effectId === "fx.draw.handwriting" ? "text"
    : category === "vector" || category === "draw" ? "vector" : "media";
  return {
    fixtureId: `fixture.card.${effectId.replace(/^fx\./u, "").replaceAll(".", "-")}`,
    inputKind,
    secondaryInput,
    ...(inputKind === "text" ? { demoText: effectId === "fx.text.textExtrude3D" ? "3D FX" : effectId === "fx.draw.handwriting" ? "biweisi" : "笔唯思" } : {})
  };
}

function targetsFor(effectId: string, category: P0EffectDefinition["category"]): readonly EffectCardTarget[] {
  if (category === "text" || effectId === "fx.draw.handwriting") return ["text"];
  if (category === "vector" || category === "draw") return ["logo", "composition"];
  if (category === "transition" || category === "composite") return ["image", "video", "composition"];
  if (category === "post") return ["image", "video"];
  if (category === "light") return ["text", "image", "video", "logo"];
  return ["text", "image", "video", "logo", "composition"];
}

const seeds: readonly CardSeed[] = Object.freeze(P0_EFFECTS.map((definition) => {
  const copy = CARD_COPY[definition.effectId];
  if (!copy) throw new Error(`Missing Chinese card copy for ${definition.effectId}`);
  const [name, description, tags] = copy;
  return seed(
    definition.effectId,
    `card.p0.${definition.sourceId.toLowerCase()}`,
    name,
    description,
    tags,
    fixtureFor(definition.effectId, definition.category),
    targetsFor(definition.effectId, definition.category),
    {
      aliases: [name, definition.displayName, definition.effectId, ...(CARD_ALIASES[definition.effectId] ?? [])],
      useCases: [...tags, categoryLabels[definition.category]!],
      styles: tags,
      materials: definition.category === "text" ? ["文字"] : definition.category === "vector" || definition.category === "draw" ? ["矢量路径"] : definition.category === "transition" || definition.category === "composite" ? ["两个不同视觉素材"] : ["图片", "视频"],
      explanation: description
    },
    definition.category === "transition" || definition.category === "composite" ? 1.8 : definition.category === "text" || definition.category === "draw" ? 3.2 : 2.6,
    definition.category === "light" || definition.category === "post" ? "library-wrapper" : "procedural"
  );
}));

function cardFromSeed(item: CardSeed): EffectCard {
  const definition = P0_EFFECTS_BY_ID.get(item.effectId);
  if (!definition) throw new Error(`Sample card effect disappeared: ${item.effectId}`);
  const media = (kind: EffectCardMediaDescriptor["kind"], progress: number): EffectCardMediaDescriptor => ({
    kind, effectId: item.effectId, representativeProgress: progress, width: 160, height: 90,
    alt: `${item.name} ${item.effectId} 真实运行时预览`
  });
  const defaultParams = structuredClone(definition.defaultPreset);
  const parameterSchema = typeof definition.parameterSchema === "object" && definition.parameterSchema !== null
    ? definition.parameterSchema as Record<string, unknown>
    : {};
  const schemaProperties = typeof parameterSchema.properties === "object" && parameterSchema.properties !== null
    ? parameterSchema.properties as Record<string, unknown>
    : {};
  const declaredOrder = Array.isArray(definition.uiSchema.order)
    ? definition.uiSchema.order
    : Object.keys(schemaProperties);
  const editableParameterNames = declaredOrder
    .filter((name): name is string => typeof name === "string" && name in schemaProperties);
  return Object.freeze({
    id: item.id, effectId: item.effectId, version: definition.version, name: item.name,
    description: item.description, category: item.category, categoryLabel: item.categoryLabel,
    tags: Object.freeze([...item.tags]), preview: media("runtime-loop", 0.5), thumbnail: media("runtime-frame", 0.5),
    defaultDuration: item.defaultDuration, supportedTargets: Object.freeze([...item.supportedTargets]),
    parameterSchema: definition.parameterSchema, defaultParams,
    editableParameterNames: Object.freeze(editableParameterNames),
    performanceClass: definition.performanceClass, implementationType: item.implementationType,
    status: item.status, acceptanceState: item.acceptanceState, ai: Object.freeze({ ...item.ai, aliases: Object.freeze([...item.ai.aliases]), useCases: Object.freeze([...item.ai.useCases]), styles: Object.freeze([...item.ai.styles]), materials: Object.freeze([...item.ai.materials]) }),
    fixture: Object.freeze({ ...item.fixture })
  });
}

export const P0_EFFECT_CARDS: readonly EffectCard[] = Object.freeze(seeds.map(cardFromSeed));
export const P0_EFFECT_CARD_BY_ID: ReadonlyMap<string, EffectCard> = new Map(P0_EFFECT_CARDS.map((card) => [card.effectId, card]));
/** @deprecated Use P0_EFFECT_CARDS. Retained as an additive source-compatible alias. */
export const V22_SAMPLE_EFFECT_CARDS = P0_EFFECT_CARDS;
/** @deprecated Use P0_EFFECT_CARD_BY_ID. */
export const V22_SAMPLE_EFFECT_CARD_BY_ID = P0_EFFECT_CARD_BY_ID;

export function effectCardForEffectId(effectId: string): EffectCard | undefined {
  return P0_EFFECT_CARD_BY_ID.get(effectId);
}

export function explicitEffectCardRequest(text: string): EffectCard | undefined {
  return explicitEffectCardRequests(text)[0];
}

export function explicitEffectCardRequests(text: string): readonly EffectCard[] {
  const normalized = text.toLocaleLowerCase();
  return P0_EFFECT_CARDS.filter((card) => {
    const definition = P0_EFFECTS_BY_ID.get(card.effectId);
    const names = [card.effectId, card.name, definition?.displayName ?? "", ...card.ai.aliases]
      .map((name) => name.toLocaleLowerCase().trim())
      .filter((name) => name.length >= 2);
    return names.some((name) => normalized.includes(name));
  });
}

export function extractExplicitAddedText(text: string): string | undefined {
  const quoted = text.match(/[“"‘']([^”"’']{1,500})[”"’']/u)?.[1]?.trim();
  if (quoted) return quoted;
  const passive = text.match(
    /(?:^|[，。；;、\s])(?:实现|制作|生成|让|将)?\s*([^，。；;、]{1,200}?)\s*(?:被|由)\s*(?:打印机|打字机|手写|书写)(?:打出|打印|写出|绘制|呈现|显示)?/u
  )?.[1]?.trim();
  if (passive) return passive.replace(/^(?:实现|制作|生成|让|将)\s*/u, "").trim() || undefined;
  const named = text.match(/(?:新增|添加|写上|打出|打印|显示)(?:文字|标题|文案)?(?:为|是|：|:)?\s*([^，。；;、]{1,200})/u)?.[1]?.trim();
  return named || undefined;
}

export function explicitP0EffectRequest(text: string): P0CatalogEffectDefinition | undefined {
  const normalized = text.toLocaleLowerCase();
  return [...P0_EFFECTS_BY_ID.values()].find((definition) => {
    const card = effectCardForEffectId(definition.effectId);
    const names = [definition.effectId, definition.displayName, card?.name ?? ""]
      .map((name) => name.toLocaleLowerCase().trim())
      .filter((name) => name.length >= 3);
    return names.some((name) => normalized.includes(name));
  });
}

export function effectCardSearchTerms(card: EffectCard): readonly string[] {
  return Object.freeze([...new Set([
    card.name, card.description, card.categoryLabel, ...card.tags,
    ...card.ai.aliases, ...card.ai.useCases, ...card.ai.styles, ...card.ai.materials
  ])]);
}

export function effectCardTargetForLayerType(layerType: string): EffectCardTarget {
  if (layerType === "text") return "text";
  if (layerType === "image") return "image";
  if (layerType === "video") return "video";
  if (layerType === "audio") return "audio";
  return "composition";
}

export function effectCardSupportsLayer(card: EffectCard, layerType: string): boolean {
  return card.supportedTargets.includes(effectCardTargetForLayerType(layerType));
}

function paramsAtTime(card: EffectCard, time: number): JsonObject {
  return Object.fromEntries(Object.entries(card.defaultParams).map(([name, value]) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && "mode" in value) {
      return [name, evaluateAnimatable(value as never, time) as JsonValue];
    }
    return [name, structuredClone(value)];
  }));
}

const PREVIEW_PARAMETER_PRIORITY = Object.freeze([
  "progress", "angle", "rotationY", "radius", "strength", "distance", "intensity",
  "offset", "range", "amplitude", "height", "force", "diffusion", "grain", "streak",
  "shutterAngle", "xAmount", "yAmount", "opacity", "start", "end", "count", "frequency", "depth"
]);

function previewParamsAtTime(card: EffectCard, time: number): JsonObject {
  const params = paramsAtTime(card, time);
  const schema = card.parameterSchema as Record<string, unknown>;
  const properties = typeof schema.properties === "object" && schema.properties !== null
    ? schema.properties as Record<string, Record<string, unknown>> : {};
  const parameterName = PREVIEW_PARAMETER_PRIORITY.find((name) => properties[name]?.type === "number");
  if (parameterName) {
    const property = properties[parameterName]!;
    const minimum = typeof property.minimum === "number" ? property.minimum : 0;
    const maximum = typeof property.maximum === "number" ? property.maximum : 1;
    const fallback = typeof params[parameterName] === "number" ? params[parameterName] : minimum;
    const span = maximum - minimum;
    const start = parameterName === "progress" ? minimum : Math.max(minimum, fallback - span * 0.2);
    const end = parameterName === "progress" ? maximum : Math.min(maximum, fallback + span * 0.2);
    const ratio = Math.min(1, Math.max(0, time / card.defaultDuration));
    params[parameterName] = start + (end === start ? span * 0.1 : end - start) * ratio;
  }
  if (card.effectId === "fx.motion.fade") params.from = 0.05;
  return params;
}

export function createV22SampleEffectInstance(
  effectId: string,
  instanceId = `effect.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
): EffectInstance | undefined {
  const card = effectCardForEffectId(effectId);
  if (!card) return undefined;
  return {
    id: instanceId,
    effectId: card.effectId,
    version: card.version,
    enabled: true,
    mix: { mode: "constant", value: 1 },
    params: structuredClone(card.defaultParams),
    cachePolicy: "frame"
  };
}

export function renderEffectCardFrame(
  card: EffectCard,
  progress: number,
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly seed?: number;
    readonly primarySurface?: PixelSurface;
    readonly secondarySurface?: PixelSurface;
  } = {}
): PixelSurface {
  const width = options.width ?? 160;
  const height = options.height ?? 90;
  const duration = card.defaultDuration;
  const logicalProgress = Math.min(1, Math.max(0, progress));
  const effectTime = makeEffectTimeSample(card.effectId, card.fixture.fixtureId, logicalProgress * duration, duration, 0, 30);
  const primary = makeRealInputFixture(
    card.effectId,
    card.fixture.inputKind,
    width,
    height,
    false,
    "srgb",
    effectTime,
    card.fixture.demoText
  );
  const secondary = card.fixture.secondaryInput
    ? makeRealInputFixture(card.effectId, "media", width, height, true, "srgb", effectTime)
    : undefined;
  const definition = P0_EFFECTS_BY_ID.get(card.effectId);
  if (!definition) throw new RangeError(`Card effect is not registered: ${card.effectId}`);
  if (definition.sourceId === "T08") {
    const fixture = makeTextExtrudeCatalogFixture({
      effectId: "fx.text.textExtrude3D",
      effectInstanceId: "effect.card.t08",
      text: "3D FX",
      width,
      height,
      effectTime: logicalProgress * duration,
      duration,
      fps: 30,
      projectStart: 0
    });
    return definition.renderPixels(fixture.input, previewParamsAtTime(card, logicalProgress * duration), {
      time: fixture.time,
      seed: options.seed ?? 20260805,
      quality: "preview"
    });
  }
  const primarySurface = options.primarySurface ?? primary.surface;
  const secondarySurface = options.secondarySurface ?? secondary?.surface;
  if (primarySurface.width !== width || primarySurface.height !== height
    || secondarySurface && (secondarySurface.width !== width || secondarySurface.height !== height)) {
    throw new RangeError("Card preview surface dimensions must match the requested frame.");
  }
  return definition.renderPixels(primarySurface, previewParamsAtTime(card, logicalProgress * duration), {
    time: effectTime,
    seed: options.seed ?? 20260805,
    quality: "preview",
    rasterInput: primary.input,
    ...(secondary && secondarySurface ? { secondary: secondarySurface, secondaryRasterInput: secondary.input } : {}),
    ...(card.effectId === "fx.draw.brushReveal" ? { brushCoverage: makeBrushCoverage(), brushAssetId: "builtin://brush/round" } : {}),
    ...(card.effectId === "fx.composite.maskReveal" ? { mask: makeMaskSurface(width, height, logicalProgress * 0.45) } : {})
  });
}

export function verifyP0EffectCardRuntime(): readonly { effectId: string; available: boolean; renders: boolean; error?: string }[] {
  return P0_EFFECT_CARDS.map((card) => {
    const definition = P0_EFFECTS_BY_ID.get(card.effectId);
    if (!definition || definition.sourceId !== "T08"
      && !GROUP_2_P0_EFFECTS.includes(definition as P0EffectDefinition)) {
      return { effectId: card.effectId, available: false, renders: false, error: "not registered" };
    }
    try {
      renderEffectCardFrame(card, 0.5);
      return { effectId: card.effectId, available: true, renders: true };
    } catch (error) {
      return { effectId: card.effectId, available: true, renders: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** @deprecated Use verifyP0EffectCardRuntime. */
export const verifyV22SampleEffectRuntime = verifyP0EffectCardRuntime;
