import { CommandHistory, type JsonValue, type LayerDefinition, type MotionProject, type UndoableCommand } from "@codemotion/core";
import { loadProject, saveProject } from "@codemotion/schema";
import { evaluateAnimatable } from "@codemotion/timeline";
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
  view: WorkspaceView;
  currentTime: number;
  zoom: number;
  playing: boolean;
  saveStatus: "saved" | "dirty" | "saving" | "error";
  recoverable: boolean;
  error: LocatedError | null;
  revision: number;
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

export class EditorStore {
  private history: CommandHistory<EditorDocument>;
  private selectedLayerId: string | null;
  private readonly listeners = new Set<() => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotValue: EditorSnapshot;
  private revision = 0;

  constructor(private readonly storage?: StorageLike, project: MotionProject = createStarterProject()) {
    const document = { project, selectedLayerId: mainLayers(project)[1]?.id ?? mainLayers(project)[0]?.id ?? null };
    this.history = new CommandHistory(document, { maxDepth: 100 });
    this.selectedLayerId = document.selectedLayerId;
    this.snapshotValue = {
      document,
      view: "workbench",
      currentTime: 0,
      zoom: 52,
      playing: false,
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
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
      document: { project: this.history.state.project, selectedLayerId: this.selectedLayerId },
      revision: ++this.revision
    };
    this.listeners.forEach((listener) => listener());
  }

  private execute(label: string, apply: (draft: EditorDocument) => void): void {
    this.history.execute(new DocumentCommand(label, apply));
    this.publish({ saveStatus: "dirty", error: null });
    this.scheduleAutosave();
  }

  setView(view: WorkspaceView): void { this.publish({ view }); }
  setTime(currentTime: number): void { this.publish({ currentTime: Math.max(0, Math.min(this.history.state.project.duration, currentTime)) }); }
  setZoom(zoom: number): void { this.publish({ zoom: Math.max(15, Math.min(200, zoom)) }); }
  setPlaying(playing: boolean): void { this.publish({ playing }); }
  selectLayer(selectedLayerId: string): void { this.selectedLayerId = selectedLayerId; this.publish(); }

  newProject(name: string, width: number, height: number, fps: number): void {
    const project = createStarterProject(name, width, height, fps);
    this.selectedLayerId = "layer.accent";
    this.history = new CommandHistory({ project, selectedLayerId: "layer.accent" }, { maxDepth: 100 });
    this.publish({ view: "editor", currentTime: 0, saveStatus: "dirty", error: null });
    this.scheduleAutosave();
  }

  importProject(json: string): void {
    const project = loadProject(json);
    this.selectedLayerId = mainLayers(project)[0]?.id ?? null;
    this.history = new CommandHistory({ project, selectedLayerId: this.selectedLayerId }, { maxDepth: 100 });
    this.publish({ view: "editor", currentTime: 0, saveStatus: "saved", error: null });
  }

  undo(): void { this.history.undo(); this.publish({ saveStatus: "dirty" }); this.scheduleAutosave(); }
  redo(): void { this.history.redo(); this.publish({ saveStatus: "dirty" }); this.scheduleAutosave(); }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }

  updateSelected(field: PropertyFieldSchema, rawValue: string | number): void {
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
    });
  }

  propertyValue(field: PropertyFieldSchema): string | number {
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
    return typeof value === "number" || typeof value === "string" ? value : "";
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
      const projectJson = saveProject(this.history.state.project, { space: 0 });
      this.storage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), projectJson }));
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
      const parsed = JSON.parse(raw) as { projectJson?: unknown };
      if (typeof parsed.projectJson !== "string") throw new Error("自动保存记录缺少工程数据");
      this.importProject(parsed.projectJson);
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
