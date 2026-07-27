import { EngineError, ERROR_CODES, type JsonObject } from "@codemotion/core";

export interface ResourceCancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  onAbort(listener: () => void): () => void;
}

export class ResourceCancellationController {
  private readonly listeners = new Set<() => void>();
  private abortedValue = false;
  private reasonValue: unknown;

  readonly signal: ResourceCancellationSignal;

  constructor() {
    const thisController = this;
    this.signal = {
      get aborted() { return thisController.abortedValue; },
      get reason() { return thisController.reasonValue; },
      onAbort(listener) {
        if (thisController.abortedValue) {
          listener();
          return () => {};
        }
        thisController.listeners.add(listener);
        return () => thisController.listeners.delete(listener);
      }
    };
  }

  abort(reason?: unknown): void {
    if (this.abortedValue) return;
    this.abortedValue = true;
    this.reasonValue = reason;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}

export interface ResourceDescriptor {
  readonly id: string;
  readonly type: string;
  readonly cacheKey: string;
  readonly metadata: JsonObject;
}

export interface ResourceLoader<T> {
  load(descriptor: ResourceDescriptor, signal: ResourceCancellationSignal): Promise<T> | T;
  release(resource: T): Promise<void> | void;
}

export interface ResourceLease<T> {
  readonly descriptor: ResourceDescriptor;
  readonly value: T;
  readonly released: boolean;
  release(): Promise<void>;
}

interface ResourceEntry<T> {
  readonly descriptor: ResourceDescriptor;
  readonly loader: ResourceLoader<T>;
  readonly controller: ResourceCancellationController;
  promise: Promise<T>;
  value?: T;
  references: number;
  waiters: number;
  orphaned: boolean;
  released: boolean;
}

function resourceError(code: typeof ERROR_CODES.RESOURCE_FAILED | typeof ERROR_CODES.RESOURCE_CANCELLED | typeof ERROR_CODES.RESOURCE_DISPOSED, message: string, descriptor?: ResourceDescriptor, cause?: unknown): EngineError {
  const details = descriptor === undefined ? {} : { resourceId: descriptor.id, resourceType: descriptor.type, cacheKey: descriptor.cacheKey };
  return new EngineError(code, message, { cause, details });
}

function isAborted(signal: ResourceCancellationSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class ResourceManager {
  private readonly loaders = new Map<string, ResourceLoader<unknown>>();
  private readonly entries = new Map<string, ResourceEntry<unknown>>();
  private disposed = false;

  register<T>(type: string, loader: ResourceLoader<T>): void {
    if (this.disposed) throw resourceError(ERROR_CODES.RESOURCE_DISPOSED, "Resource Manager is disposed.");
    if (type.length === 0 || this.loaders.has(type)) throw new RangeError("Resource loader types must be non-empty and unique.");
    this.loaders.set(type, loader as ResourceLoader<unknown>);
  }

  async acquire<T>(descriptor: ResourceDescriptor, signal?: ResourceCancellationSignal): Promise<ResourceLease<T>> {
    if (this.disposed) throw resourceError(ERROR_CODES.RESOURCE_DISPOSED, "Resource Manager is disposed.", descriptor);
    if (isAborted(signal)) throw resourceError(ERROR_CODES.RESOURCE_CANCELLED, "Resource acquisition was cancelled.", descriptor, signal?.reason);
    const loader = this.loaders.get(descriptor.type);
    if (loader === undefined) throw resourceError(ERROR_CODES.RESOURCE_FAILED, "No loader is registered for the resource type.", descriptor);
    let entry = this.entries.get(descriptor.cacheKey);
    if (entry !== undefined && (entry.descriptor.type !== descriptor.type || entry.descriptor.id !== descriptor.id)) {
      throw resourceError(ERROR_CODES.RESOURCE_FAILED, "Resource cache key collides with another descriptor.", descriptor);
    }
    if (entry === undefined) {
      entry = this.createEntry(descriptor, loader);
      this.entries.set(descriptor.cacheKey, entry);
    }
    entry.waiters += 1;
    try {
      const value = await this.awaitWithCancellation(entry.promise, descriptor, signal);
      if (isAborted(signal)) throw resourceError(ERROR_CODES.RESOURCE_CANCELLED, "Resource acquisition was cancelled.", descriptor, signal?.reason);
      entry.references += 1;
      return this.createLease(entry as ResourceEntry<T>, value as T);
    } finally {
      entry.waiters -= 1;
      if (entry.waiters === 0 && entry.references === 0 && entry.value === undefined) {
        entry.orphaned = true;
        this.entries.delete(entry.descriptor.cacheKey);
        entry.controller.abort("No resource waiters remain.");
      } else if (entry.waiters === 0 && entry.references === 0) {
        this.entries.delete(entry.descriptor.cacheKey);
        await this.releaseEntry(entry);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      if (entry.value === undefined) {
        entry.orphaned = true;
        entry.controller.abort("Resource Manager disposed.");
      }
    }
    await Promise.all(entries.map(async (entry) => {
      try {
        await entry.promise;
      } catch {
        return;
      }
      await this.releaseEntry(entry);
    }));
  }

  private createEntry(descriptor: ResourceDescriptor, loader: ResourceLoader<unknown>): ResourceEntry<unknown> {
    const controller = new ResourceCancellationController();
    const entry: ResourceEntry<unknown> = {
      descriptor,
      loader,
      controller,
      promise: undefined as unknown as Promise<unknown>,
      references: 0,
      waiters: 0,
      orphaned: false,
      released: false
    };
    entry.promise = Promise.resolve().then(() => loader.load(descriptor, controller.signal)).then(async (value) => {
      if (entry.orphaned || this.disposed) {
        try {
          await loader.release(value);
          entry.released = true;
        } catch (cause) {
          throw resourceError(ERROR_CODES.RESOURCE_FAILED, "Orphaned resource release failed.", descriptor, cause);
        }
        throw resourceError(ERROR_CODES.RESOURCE_CANCELLED, "Resource load completed after cancellation.", descriptor);
      }
      entry.value = value;
      return value;
    }).catch((cause) => {
      if (this.entries.get(descriptor.cacheKey) === entry) this.entries.delete(descriptor.cacheKey);
      if (cause instanceof EngineError) throw cause;
      throw resourceError(ERROR_CODES.RESOURCE_FAILED, "Resource load failed.", descriptor, cause);
    });
    return entry;
  }

  private awaitWithCancellation<T>(promise: Promise<T>, descriptor: ResourceDescriptor, signal?: ResourceCancellationSignal): Promise<T> {
    if (signal === undefined) return promise;
    return new Promise<T>((resolve, reject) => {
      let remove = (): void => {};
      const abort = (): void => {
        remove();
        reject(resourceError(ERROR_CODES.RESOURCE_CANCELLED, "Resource acquisition was cancelled.", descriptor, signal.reason));
      };
      remove = signal.onAbort(abort);
      promise.then(
        (value) => { remove(); resolve(value); },
        (cause) => { remove(); reject(cause); }
      );
    });
  }

  private createLease<T>(entry: ResourceEntry<T>, value: T): ResourceLease<T> {
    let released = false;
    return {
      descriptor: entry.descriptor,
      value,
      get released() { return released; },
      release: async () => {
        if (released) return;
        released = true;
        entry.references -= 1;
        if (entry.references === 0 && entry.waiters === 0) {
          this.entries.delete(entry.descriptor.cacheKey);
          await this.releaseEntry(entry as ResourceEntry<unknown>);
        }
      }
    };
  }

  private async releaseEntry(entry: ResourceEntry<unknown>): Promise<void> {
    if (entry.released || entry.value === undefined) return;
    entry.released = true;
    try {
      await entry.loader.release(entry.value);
    } catch (cause) {
      throw resourceError(ERROR_CODES.RESOURCE_FAILED, "Resource release failed.", entry.descriptor, cause);
    }
  }
}
