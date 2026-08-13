import { CommandHistory, type EffectInstance, type JsonValue, type LayerDefinition, type MotionProject, type UndoableCommand } from "@codemotion/core";
import { P0_BROWSER_PROJECT_AUTHORITY_V1, createV22SampleEffectInstance } from "@codemotion/effects-2d";
import { loadProject, saveProject, validateContract, type BrowserProjectConstraintsV1, type BrowserProjectEnvelopeV1 } from "@codemotion/schema";
import {
  evaluateAnimatable,
  evaluateAnimatableAt,
  resolveEffectTimeSample,
  resolveLayerTimeSample,
  resolveProjectTimeSample
} from "@codemotion/timeline";
import {
  createP0EffectInstance,
  effectDefinition,
  effectParameterFields,
  presetParams,
  type EffectParameterField
} from "./effect-catalog.js";
import {
  createStarterProject,
  findLayer,
  locateProjectError,
  mainLayers,
  pipelineEffect,
  type EditorDocument,
  type LocatedError,
  type PropertyFieldSchema,
  type WorkspaceView
} from "./model.js";

export const AUTOSAVE_KEY = "codemotion.editor.autosave.v1";
export const RECENTS_KEY = "codemotion.editor.recents.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EditorSnapshot {
  document: Readonly<EditorDocument>;
  editableProject: BrowserProjectEnvelopeV1;
  view: WorkspaceView;
  currentTime: number;
  zoom: number;
  playing: boolean;
  selectedEffectId: string | null;
  saveStatus: "saved" | "dirty" | "saving" | "error";
  recoverable: boolean;
  error: LocatedError | null;
  revision: number;
}

const EMPTY_CONSTRAINTS: BrowserProjectConstraintsV1 = Object.freeze({
  style: Object.freeze([]),
  brand: Object.freeze({
    colors: Object.freeze([]),
    tone: Object.freeze([]),
    requiredText: Object.freeze([]),
    forbiddenContent: Object.freeze([]),
    logoAssetIds: Object.freeze([])
  })
});

function safeEnvelope(project: MotionProject, constraints: BrowserProjectConstraintsV1): BrowserProjectEnvelopeV1 {
  const localProject = structuredClone(project);
  localProject.metadata = { timeContractVersion: "1.1.0" };
  let needsFont = false;
  for (const composition of localProject.compositions) {
    for (const layer of composition.layers) {
      if (layer.type !== "text") continue;
      layer.properties.fontFamily = "Codemotion Planner Unicode Bitmap";
      needsFont = true;
    }
  }
  localProject.fonts = needsFont ? [{
    id: "font.codemotion.unicode-bitmap-v1",
    family: "Codemotion Planner Unicode Bitmap"
  }] : [];
  const result = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(localProject, constraints);
  if (!result.valid) throw new Error(result.error.message);
  return result.value;
}

class DocumentCommand implements UndoableCommand<EditorDocument> {
  readonly id = `editor.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  private before: EditorDocument | undefined;

  constructor(readonly label: string, private readonly apply: (draft: EditorDocument) => void) {}

  execute(state: Readonly<EditorDocument>): EditorDocument {
    this.before ??= structuredClone(state);
    const draft = structuredClone(state);
    this.apply(draft);
    return draft;
  }

  undo(): EditorDocument {
    if (this.before === undefined) throw new Error("Command has not executed.");
    return structuredClone(this.before);
  }
}

function pathValue(layer: LayerDefinition, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  }, layer);
}

function setPath(target: object, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target as Record<string, unknown>;
  parts.slice(0, -1).forEach((part) => {
    const next = cursor[part];
    if (typeof next !== "object" || next === null) throw new Error(`Invalid editor property path: ${path}`);
    cursor = next as Record<string, unknown>;
  });
  const key = parts.at(-1);
  if (key === undefined) throw new Error("Property path cannot be empty.");
  cursor[key] = value;
}

function findEffect(layer: LayerDefinition | undefined, effectInstanceId: string): EffectInstance | undefined {
  return layer?.effects.find((effect) => effect.id === effectInstanceId);
}

function isAnimatableValue(value: unknown): value is { mode: string; value?: JsonValue; keyframes?: { time: number; value: JsonValue }[] } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "mode" in value;
}

function effectEvaluation(
  project: MotionProject,
  layer: LayerDefinition,
  effect: EffectInstance,
  currentTime: number
) {
  const projectTime = resolveProjectTimeSample({
    projectTime: Math.min(currentTime, Math.max(0, project.duration - 1 / project.fps)),
    previousProjectTime: Math.max(0, currentTime - 1 / project.fps),
    fps: project.fps
  });
  const layerTime = resolveLayerTimeSample(layer, projectTime);
  const effectTime = resolveEffectTimeSample(effect, layerTime, projectTime, layer.endTime - layer.startTime);
  return { project: projectTime, layer: layerTime, effect: effectTime };
}

export class EditorStore {
  private history: CommandHistory<EditorDocument>;
  private selectedLayerId: string | null;
  private readonly listeners = new Set<() => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotValue: EditorSnapshot;
  private revision = 0;
  private constraints: BrowserProjectConstraintsV1;

  constructor(private readonly storage?: StorageLike, project: MotionProject = createStarterProject()) {
    const initial = safeEnvelope(project, EMPTY_CONSTRAINTS);
    this.constraints = initial.constraints;
    const document = { project: initial.project, selectedLayerId: mainLayers(initial.project)[1]?.id ?? mainLayers(initial.project)[0]?.id ?? null };
    this.history = new CommandHistory(document, { maxDepth: 100 });
    this.selectedLayerId = document.selectedLayerId;
    this.snapshotValue = {
      document,
      editableProject: initial,
      view: "ai-planner",
      currentTime: 0,
      zoom: 52,
      playing: false,
      selectedEffectId: null,
      saveStatus: "saved",
      recoverable: storage?.getItem(AUTOSAVE_KEY) !== null,
      error: null,
      revision: this.revision
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.snapshotValue;

  private publish(patch: Partial<Omit<EditorSnapshot, "document" | "revision">> = {}): void {
    const editableProject: BrowserProjectEnvelopeV1 = {
      contract: "browser-project/v1",
      project: this.history.state.project,
      constraints: this.constraints
    };
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
      document: { project: this.history.state.project, selectedLayerId: this.selectedLayerId },
      editableProject,
      revision: ++this.revision
    };
    this.listeners.forEach((listener) => listener());
  }

  private execute(label: string, apply: (draft: EditorDocument) => void): void {
    const candidate = structuredClone(this.history.state);
    apply(candidate);
    const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope({
      contract: "browser-project/v1",
      project: candidate.project,
      constraints: this.constraints
    });
    if (!checked.valid) throw new Error(checked.error.message);
    this.history.execute(new DocumentCommand(label, apply));
    this.publish({ saveStatus: "dirty", error: null });
    this.scheduleAutosave();
  }

  setView(view: WorkspaceView): void { this.publish({ view }); }
  setTime(currentTime: number): void { this.publish({ currentTime: Math.max(0, Math.min(this.history.state.project.duration, currentTime)) }); }
  setZoom(zoom: number): void { this.publish({ zoom: Math.max(15, Math.min(200, zoom)) }); }
  setPlaying(playing: boolean): void { this.publish({ playing }); }

  audioTrackVolume(trackId: string): number {
    const track = this.history.state.project.audioTracks.find((item) => item.id === trackId);
    return track ? evaluateAnimatable(track.volume, this.snapshotValue.currentTime) : 0;
  }

  setAudioTrackVolume(trackId: string, volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.execute("调整音频音量", (draft) => {
      const track = draft.project.audioTracks.find((item) => item.id === trackId);
      if (track) track.volume = { mode: "constant", value: Math.max(0, Math.min(2, volume)) };
    });
  }

  setAudioTrackStart(trackId: string, startTime: number): void {
    if (!Number.isFinite(startTime)) return;
    this.execute("调整音频位置", (draft) => {
      const track = draft.project.audioTracks.find((item) => item.id === trackId);
      if (!track) return;
      const trackDuration = track.endTime - track.startTime;
      track.startTime = Math.max(0, Math.min(draft.project.duration, startTime));
      track.endTime = Math.min(draft.project.duration, track.startTime + trackDuration);
    });
  }
  selectLayer(selectedLayerId: string): void {
    this.selectedLayerId = selectedLayerId;
    this.publish({ selectedEffectId: null });
  }

  clearSelection(): void {
    this.selectedLayerId = null;
    this.publish({ selectedEffectId: null });
  }

  selectEffect(effectId: string | null): void { this.publish({ selectedEffectId: effectId }); }

  newProject(name: string, width: number, height: number, fps: number): void {
    const envelope = safeEnvelope(createStarterProject(name, width, height, fps), EMPTY_CONSTRAINTS);
    const project = envelope.project;
    this.constraints = envelope.constraints;
    this.selectedLayerId = "layer.accent";
    this.history = new CommandHistory({ project, selectedLayerId: "layer.accent" }, { maxDepth: 100 });
    this.publish({ view: "editor", currentTime: 0, selectedEffectId: null, saveStatus: "dirty", error: null });
    this.scheduleAutosave();
  }

  importProject(json: string): void {
    const parsed = JSON.parse(json) as unknown;
    const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(parsed);
    const envelope = checked.valid ? checked.value : safeEnvelope(loadProject(json), EMPTY_CONSTRAINTS);
    this.adoptEditableProject(envelope);
  }

  adoptEditableProject(value: unknown): void {
    this.loadEditableProject(value);
    this.publish({ view: "editor" });
  }

  loadEditableProject(value: unknown): void {
    const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(value);
    if (!checked.valid) throw new Error(checked.error.message);
    const envelope = structuredClone(checked.value);
    const project = envelope.project;
    this.constraints = envelope.constraints;
    this.selectedLayerId = mainLayers(project)[0]?.id ?? null;
    this.history = new CommandHistory({ project, selectedLayerId: this.selectedLayerId }, { maxDepth: 100 });
    this.publish({ currentTime: 0, selectedEffectId: null, saveStatus: "saved", error: null });
    this.scheduleAutosave();
  }

  undo(): void { this.history.undo(); this.publish({ saveStatus: "dirty" }); this.scheduleAutosave(); }
  redo(): void { this.history.redo(); this.publish({ saveStatus: "dirty" }); this.scheduleAutosave(); }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }

  updateSelected(field: PropertyFieldSchema, rawValue: string | number | boolean): void {
    const layerId = this.selectedLayerId;
    if (layerId === null) return;
    this.execute(`修改${field.label}`, (draft) => {
      const layer = findLayer(draft.project, layerId);
      if (layer === undefined) throw new Error(`Layer not found: ${layerId}`);
      let value: unknown = field.kind === "number" ? Number(rawValue) : rawValue;
      if (field.kind === "number") {
        if (!Number.isFinite(value)) throw new Error(`${field.label}必须是数字`);
        if (field.minimum !== undefined) value = Math.max(field.minimum, value as number);
        if (field.maximum !== undefined) value = Math.min(field.maximum, value as number);
      }
      const existing = pathValue(layer, field.path);
      if (field.component && typeof existing === "object" && existing !== null && "mode" in existing) {
        const animatable = existing as { mode: string; value?: Record<string, JsonValue>; keyframes?: { time: number; value: Record<string, JsonValue> }[] };
        if (animatable.mode === "constant" && animatable.value) animatable.value[field.component] = value as JsonValue;
        else if (animatable.mode === "keyframes" && animatable.keyframes) {
          const current = evaluateAnimatable(animatable as never, this.snapshotValue.currentTime) as unknown as Record<string, JsonValue>;
          animatable.keyframes.push({
            time: this.snapshotValue.currentTime,
            value: { ...current, [field.component]: value as JsonValue } as Record<string, JsonValue>
          });
          animatable.keyframes.sort((a, b) => a.time - b.time);
        }
      } else if (typeof existing === "object" && existing !== null && "mode" in existing) {
        const animatable = existing as { mode: string; value?: JsonValue; keyframes?: { time: number; value: JsonValue }[] };
        if (animatable.mode === "constant") animatable.value = value as JsonValue;
        else if (animatable.mode === "keyframes" && animatable.keyframes) {
          animatable.keyframes.push({ time: this.snapshotValue.currentTime, value: value as JsonValue });
          animatable.keyframes.sort((a, b) => a.time - b.time);
        }
      } else setPath(layer, field.path, value);
      const validation = validateContract("LayerDefinition", layer);
      if (!validation.valid) throw new Error(`${field.label}未通过正式 LayerDefinition Schema 校验。`);
    });
  }

  propertyValue(field: PropertyFieldSchema): string | number | boolean {
    const layer = findLayer(this.history.state.project, this.selectedLayerId);
    if (layer === undefined) return "";
    const value = pathValue(layer, field.path);
    if (typeof value === "object" && value !== null && "mode" in value) {
      const evaluated = evaluateAnimatable(value as never, this.snapshotValue.currentTime) as unknown;
      if (field.component && typeof evaluated === "object" && evaluated !== null) {
        const component = (evaluated as Record<string, unknown>)[field.component];
        return typeof component === "number" ? Math.round(component * 100) / 100 : "";
      }
      return typeof evaluated === "number" || typeof evaluated === "string" ? evaluated : "";
    }
    return typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : "";
  }

  updateLayerGeometry(layerId: string, positionX: number, positionY: number, scaleX: number, scaleY: number): void {
    const values = [positionX, positionY, scaleX, scaleY];
    if (values.some((value) => !Number.isFinite(value))) return;
    this.execute("调整图层几何", (draft) => {
      const layer = findLayer(draft.project, layerId);
      if (!layer || layer.locked) return;
      const update = (target: typeof layer.transform.position, x: number, y: number): void => {
        if (target.mode === "constant") target.value = { ...target.value, x, y };
        else if (target.mode === "keyframes") {
          const current = evaluateAnimatable(target, this.snapshotValue.currentTime);
          const existing = target.keyframes.find((frame) => Math.abs(frame.time - this.snapshotValue.currentTime) < 0.0001);
          if (existing) existing.value = { ...current, x, y };
          else target.keyframes.push({ time: this.snapshotValue.currentTime, value: { ...current, x, y } });
          target.keyframes.sort((left, right) => left.time - right.time);
        }
      };
      update(layer.transform.position, positionX, positionY);
      update(layer.transform.scale, Math.max(5, scaleX), Math.max(5, scaleY));
    });
  }

  addKeyframe(animatablePath: string): void {
    const layerId = this.selectedLayerId;
    if (layerId === null) return;
    this.execute("添加关键帧", (draft) => {
      const layer = findLayer(draft.project, layerId);
      if (layer === undefined) throw new Error(`Layer not found: ${layerId}`);
      const target = pathValue(layer, animatablePath) as { mode: string; value?: JsonValue; keyframes?: { time: number; value: JsonValue; interpolation?: "linear" }[] };
      const current = evaluateAnimatable(target as never, this.snapshotValue.currentTime) as JsonValue;
      if (target.mode === "constant") {
        target.mode = "keyframes";
        delete target.value;
        target.keyframes = [{ time: this.snapshotValue.currentTime, value: current, interpolation: "linear" }];
      } else if (target.mode === "keyframes" && target.keyframes) {
        const frame = target.keyframes.find((item) => Math.abs(item.time - this.snapshotValue.currentTime) < 0.0001);
        if (frame) frame.value = current;
        else target.keyframes.push({ time: this.snapshotValue.currentTime, value: current });
        target.keyframes.sort((a, b) => a.time - b.time);
      }
    });
  }

  toggleLayer(layerId: string, key: "visible" | "locked" | "solo"): void {
    this.execute(`切换图层${key}`, (draft) => {
      const layer = findLayer(draft.project, layerId);
      if (layer) layer[key] = !layer[key];
    });
  }

  addLayer(): void {
    const id = `layer.shape.${Date.now().toString(36)}`;
    this.execute("新建图层", (draft) => {
      const layers = mainLayers(draft.project);
      const source = layers.find((layer) => layer.type === "shape") ?? layers[0];
      if (!source) throw new Error("Cannot create a layer without a composition template.");
      const layer = structuredClone(source);
      layer.id = id;
      layer.name = "新建图形";
      layer.zIndex = layers.length;
      layer.effects = [];
      layer.visible = true;
      layer.locked = false;
      layer.solo = false;
      layers.push(layer);
    });
    this.selectedLayerId = id;
    this.publish();
  }

  duplicateLayer(layerId: string): void {
    const id = `${layerId}.copy.${Date.now().toString(36)}`;
    this.execute("复制图层", (draft) => {
      const layers = mainLayers(draft.project);
      const index = layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) return;
      const copy = structuredClone(layers[index]!);
      copy.id = id;
      copy.name = `${copy.name} 副本`;
      layers.splice(index + 1, 0, copy);
      layers.forEach((layer, zIndex) => { layer.zIndex = zIndex; });
    });
    this.selectedLayerId = id;
    this.publish();
  }

  deleteLayer(layerId: string): void {
    const layers = mainLayers(this.history.state.project);
    if (layers.length <= 1) return;
    const index = layers.findIndex((layer) => layer.id === layerId);
    this.execute("删除图层", (draft) => {
      const draftLayers = mainLayers(draft.project);
      const draftIndex = draftLayers.findIndex((layer) => layer.id === layerId);
      if (draftIndex >= 0) draftLayers.splice(draftIndex, 1);
      draftLayers.forEach((layer, zIndex) => { layer.zIndex = zIndex; });
    });
    this.selectedLayerId = layers[Math.max(0, index - 1)]?.id ?? layers.find((layer) => layer.id !== layerId)?.id ?? null;
    this.publish();
  }

  reorderLayer(layerId: string, direction: -1 | 1): void {
    this.execute("图层排序", (draft) => {
      const layers = mainLayers(draft.project);
      const index = layers.findIndex((layer) => layer.id === layerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= layers.length) return;
      [layers[index], layers[target]] = [layers[target]!, layers[index]!];
      layers.forEach((layer, zIndex) => { layer.zIndex = zIndex; });
    });
  }

  addPipelineEffect(layerId: string): void {
    this.execute("添加 WebGL 管线校验", (draft) => {
      findLayer(draft.project, layerId)?.effects.push(pipelineEffect());
    });
  }

  addEffect(layerId: string, effectId: string, presetIndex = 1): void {
    const instance = createV22SampleEffectInstance(effectId) ?? createP0EffectInstance(effectId, presetIndex);
    this.execute(`添加 ${effectDefinition(effectId).displayName}`, (draft) => {
      const layer = findLayer(draft.project, layerId);
      if (layer === undefined) throw new Error(`Layer not found: ${layerId}`);
      layer.effects.push(instance);
    });
    this.selectedLayerId = layerId;
    this.publish({ selectedEffectId: instance.id });
  }

  toggleEffect(layerId: string, effectInstanceId: string): void {
    this.execute("启停效果", (draft) => {
      const effect = findEffect(findLayer(draft.project, layerId), effectInstanceId);
      if (effect !== undefined) effect.enabled = !effect.enabled;
    });
  }

  deleteEffect(layerId: string, effectInstanceId: string): void {
    this.execute("删除效果", (draft) => {
      const effects = findLayer(draft.project, layerId)?.effects;
      const index = effects?.findIndex((effect) => effect.id === effectInstanceId) ?? -1;
      if (effects !== undefined && index >= 0) effects.splice(index, 1);
    });
    if (this.snapshotValue.selectedEffectId === effectInstanceId) this.publish({ selectedEffectId: null });
  }

  applyEffectPreset(layerId: string, effectInstanceId: string, presetIndex: number): void {
    this.execute("应用效果预设", (draft) => {
      const effect = findEffect(findLayer(draft.project, layerId), effectInstanceId);
      if (effect === undefined) return;
      const definition = effectDefinition(effect.effectId);
      const keyframeable = new Set(effectParameterFields(definition)
        .filter((field) => field.keyframeable).map((field) => field.name));
      effect.params = Object.fromEntries(Object.entries(presetParams(effect.effectId, presetIndex)).map(([name, value]) => [
        name,
        keyframeable.has(name) ? { mode: "constant", value: structuredClone(value) } : structuredClone(value)
      ]));
    });
  }

  updateEffectParameter(
    layerId: string,
    effectInstanceId: string,
    field: EffectParameterField,
    rawValue: JsonValue
  ): void {
    this.execute(`修改 ${field.label}`, (draft) => {
      const layer = findLayer(draft.project, layerId);
      const effect = findEffect(layer, effectInstanceId);
      if (layer === undefined || effect === undefined) return;
      let value = structuredClone(rawValue);
      if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field.label} must be finite.`);
        const numeric = value as number;
        value = Math.min(field.maximum ?? numeric, Math.max(field.minimum ?? numeric, numeric));
      } else if (field.type === "string") {
        if (typeof value !== "string") throw new TypeError(`${field.label} must be text.`);
        value = value.slice(0, field.maxLength ?? value.length);
      } else if (field.type === "boolean" && typeof value !== "boolean") {
        throw new TypeError(`${field.label} must be boolean.`);
      } else if (field.type === "array") {
        if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
          throw new TypeError(`${field.label} must be a finite vector2.`);
        }
        value = value.map((item) => {
          const numeric = item as number;
          return Math.min(field.maximum ?? numeric, Math.max(field.minimum ?? numeric, numeric));
        }) as JsonValue;
      }
      const current = effect.params[field.name];
      if (isAnimatableValue(current)) {
        if (current.mode === "constant") current.value = value;
        else if (current.mode === "keyframes" && current.keyframes) {
          const time = effectEvaluation(draft.project, layer, effect, this.snapshotValue.currentTime).effect.effectTime;
          const frame = current.keyframes.find((item) => Math.abs(item.time - time) < 0.0001);
          if (frame) frame.value = value;
          else current.keyframes.push({ time, value });
          current.keyframes.sort((left, right) => left.time - right.time);
        }
      } else effect.params[field.name] = field.keyframeable ? { mode: "constant", value } : value;
    });
  }

  effectParameterValue(
    layerId: string,
    effectInstanceId: string,
    field: EffectParameterField
  ): JsonValue {
    const project = this.history.state.project;
    const layer = findLayer(project, layerId);
    const effect = findEffect(layer, effectInstanceId);
    if (layer === undefined || effect === undefined) return "";
    const value = effect.params[field.name];
    if (!isAnimatableValue(value)) return structuredClone(value as JsonValue);
    return evaluateAnimatableAt(value as never, "effect", effectEvaluation(
      project,
      layer,
      effect,
      this.snapshotValue.currentTime
    )) as JsonValue;
  }

  addEffectKeyframe(layerId: string, effectInstanceId: string, field: EffectParameterField): void {
    if (!field.keyframeable) return;
    this.execute(`添加 ${field.label} 关键帧`, (draft) => {
      const layer = findLayer(draft.project, layerId);
      const effect = findEffect(layer, effectInstanceId);
      if (layer === undefined || effect === undefined) return;
      const current = effect.params[field.name];
      const times = effectEvaluation(draft.project, layer, effect, this.snapshotValue.currentTime);
      const value = isAnimatableValue(current)
        ? evaluateAnimatableAt(current as never, "effect", times) as JsonValue
        : structuredClone(current as JsonValue);
      const time = times.effect.effectTime;
      if (!isAnimatableValue(current) || current.mode === "constant") {
        effect.params[field.name] = { mode: "keyframes", keyframes: [{ time, value, interpolation: "linear" }] };
      } else if (current.mode === "keyframes" && current.keyframes) {
        const frame = current.keyframes.find((item) => Math.abs(item.time - time) < 0.0001);
        if (frame) frame.value = value;
        else current.keyframes.push({ time, value });
        current.keyframes.sort((left, right) => left.time - right.time);
      }
    });
  }

  reorderEffect(layerId: string, effectId: string, direction: -1 | 1): void {
    this.execute("效果排序", (draft) => {
      const effects = findLayer(draft.project, layerId)?.effects;
      if (!effects) return;
      const index = effects.findIndex((effect) => effect.id === effectId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= effects.length) return;
      [effects[index], effects[target]] = [effects[target]!, effects[index]!];
    });
  }

  reportError(error: LocatedError): void { this.publish({ error }); }
  clearError(): void { this.publish({ error: null }); }

  saveNow(): void {
    if (!this.storage) return;
    this.publish({ saveStatus: "saving" });
    try {
      const editableProject = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(this.snapshotValue.editableProject);
      if (!editableProject.valid) throw new Error(editableProject.error.message);
      const projectJson = saveProject(editableProject.value.project, { space: 0 });
      this.storage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), editableProject: editableProject.value, projectJson }));
      const recents = this.recents().filter((item) => item.id !== this.history.state.project.id);
      recents.unshift({ id: this.history.state.project.id, name: this.history.state.project.name, savedAt: Date.now() });
      this.storage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 8)));
      this.publish({ saveStatus: "saved", recoverable: true });
    } catch {
      this.publish({ saveStatus: "error" });
    }
  }

  private scheduleAutosave(): void {
    if (!this.storage) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.saveNow(), 400);
  }

  recover(): void {
    const raw = this.storage?.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { editableProject?: unknown };
      if (parsed.editableProject === undefined) throw new Error("Autosave is missing the safe project envelope.");
      this.adoptEditableProject(parsed.editableProject);
      this.publish({ recoverable: false });
    } catch (error) {
      const located = locateProjectError(error, this.history.state.project);
      this.publish({
        saveStatus: "error",
        recoverable: true,
        error: { ...located, message: `自动保存恢复失败：${located.message}` }
      });
    }
  }

  dismissRecovery(): void {
    this.storage?.removeItem(AUTOSAVE_KEY);
    this.publish({ recoverable: false });
  }

  recents(): { id: string; name: string; savedAt: number }[] {
    try { return JSON.parse(this.storage?.getItem(RECENTS_KEY) ?? "[]") as { id: string; name: string; savedAt: number }[]; }
    catch { return []; }
  }

  exportJson(): string { return saveProject(this.history.state.project); }
}
