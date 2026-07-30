export interface OwnerContext {
  readonly tenantId: string;
  readonly userId: string;
}

export interface OwnedTask<T> {
  readonly owner: OwnerContext;
  readonly taskId: string;
  readonly value: T;
}

function assertIdentifier(name: string, value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new TypeError(`${name} must be a non-empty string of at most 256 characters.`);
  }
}

export function assertOwnerContext(owner: OwnerContext): void {
  assertIdentifier("tenantId", owner.tenantId);
  assertIdentifier("userId", owner.userId);
}

function taskKey(owner: OwnerContext, taskId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, taskId]);
}

export class OwnedTaskStore<T> {
  private readonly tasks = new Map<string, OwnedTask<T>>();

  put(owner: OwnerContext, taskId: string, value: T): OwnedTask<T> {
    assertOwnerContext(owner);
    assertIdentifier("taskId", taskId);
    const record: OwnedTask<T> = {
      owner: { tenantId: owner.tenantId, userId: owner.userId },
      taskId,
      value
    };
    this.tasks.set(taskKey(owner, taskId), record);
    return record;
  }

  get(owner: OwnerContext, taskId: string): OwnedTask<T> {
    assertOwnerContext(owner);
    assertIdentifier("taskId", taskId);
    const record = this.tasks.get(taskKey(owner, taskId));
    if (record === undefined) throw new Error("Task not found or access denied.");
    return record;
  }

  list(owner: OwnerContext): readonly OwnedTask<T>[] {
    assertOwnerContext(owner);
    return [...this.tasks.values()].filter((task) =>
      task.owner.tenantId === owner.tenantId && task.owner.userId === owner.userId);
  }
}
