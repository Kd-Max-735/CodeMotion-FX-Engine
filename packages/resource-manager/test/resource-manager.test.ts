import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@codemotion/core";
import {
  ResourceCancellationController,
  ResourceManager,
  type ResourceDescriptor,
  type ResourceLoader
} from "../src/index.js";

const descriptor: ResourceDescriptor = { id: "asset.logo", type: "image", cacheKey: "sha256:logo", metadata: {} };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ResourceManager", () => {
  it("deduplicates concurrent loads and releases after the final lease", async () => {
    let loads = 0;
    let releases = 0;
    const pending = deferred<{ pixels: number }>();
    const manager = new ResourceManager();
    manager.register("image", {
      load() { loads += 1; return pending.promise; },
      release() { releases += 1; }
    });
    const firstPromise = manager.acquire<{ pixels: number }>(descriptor);
    const secondPromise = manager.acquire<{ pixels: number }>(descriptor);
    pending.resolve({ pixels: 4 });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(loads).toBe(1);
    expect(first.value).toBe(second.value);
    await first.release();
    expect(releases).toBe(0);
    await second.release();
    await second.release();
    expect(releases).toBe(1);
  });

  it("cancels before and during load and releases an orphaned result", async () => {
    let loads = 0;
    let releases = 0;
    const pending = deferred<object>();
    const manager = new ResourceManager();
    manager.register("image", {
      load(_descriptor, signal) {
        loads += 1;
        expect(signal.aborted).toBe(false);
        return pending.promise;
      },
      release() { releases += 1; }
    });
    const before = new ResourceCancellationController();
    before.abort("before");
    await expect(manager.acquire(descriptor, before.signal)).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_CANCELLED });
    expect(loads).toBe(0);

    const during = new ResourceCancellationController();
    const acquisition = manager.acquire(descriptor, during.signal);
    during.abort("during");
    await expect(acquisition).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_CANCELLED });
    pending.resolve({});
    await new Promise((resolve) => setImmediate(resolve));
    expect(releases).toBe(1);
  });

  it("disposes live resources once and rejects later acquisition", async () => {
    let releases = 0;
    const manager = new ResourceManager();
    manager.register("image", {
      load: () => ({ pixels: 1 }),
      release: () => { releases += 1; }
    });
    const lease = await manager.acquire(descriptor);
    await manager.dispose();
    await lease.release();
    expect(releases).toBe(1);
    await expect(manager.acquire(descriptor)).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_DISPOSED });
  });

  it("isolates load failures and permits a retry", async () => {
    let attempts = 0;
    const loader: ResourceLoader<object> = {
      load() {
        attempts += 1;
        if (attempts === 1) throw new Error("sensitive");
        return {};
      },
      release() {}
    };
    const manager = new ResourceManager();
    manager.register("image", loader);
    await expect(manager.acquire(descriptor)).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_FAILED });
    const lease = await manager.acquire(descriptor);
    expect(attempts).toBe(2);
    await lease.release();
  });

  it("normalizes release failures and never releases the same lease twice", async () => {
    let releases = 0;
    const manager = new ResourceManager();
    manager.register("image", {
      load: () => ({}),
      release() { releases += 1; throw new Error("sensitive release"); }
    });
    const lease = await manager.acquire(descriptor);
    await expect(lease.release()).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_FAILED });
    await lease.release();
    expect(releases).toBe(1);
  });

  it("does not let an orphaned load delete a newer retry entry", async () => {
    const firstLoad = deferred<object>();
    const secondLoad = deferred<object>();
    let loads = 0;
    let releases = 0;
    const manager = new ResourceManager();
    manager.register("image", {
      load() { loads += 1; return loads === 1 ? firstLoad.promise : secondLoad.promise; },
      release() { releases += 1; }
    });

    const cancellation = new ResourceCancellationController();
    const cancelled = manager.acquire(descriptor, cancellation.signal);
    cancellation.abort();
    await expect(cancelled).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_CANCELLED });

    const retry = manager.acquire<object>(descriptor);
    firstLoad.resolve({ old: true });
    await new Promise((resolve) => setImmediate(resolve));
    const deduplicated = manager.acquire<object>(descriptor);
    secondLoad.resolve({ current: true });
    const [retryLease, deduplicatedLease] = await Promise.all([retry, deduplicated]);
    expect(loads).toBe(2);
    expect(retryLease.value).toBe(deduplicatedLease.value);
    expect(releases).toBe(1);
    await retryLease.release();
    await deduplicatedLease.release();
    expect(releases).toBe(2);
  });
});
