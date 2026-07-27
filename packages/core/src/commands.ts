import { EngineError, ERROR_CODES } from "./errors.js";

export interface UndoableCommand<TState> {
  readonly id: string;
  readonly label: string;
  execute(state: Readonly<TState>): TState;
  undo(state: Readonly<TState>): TState;
}

interface HistoryEntry<TState> {
  readonly command: UndoableCommand<TState>;
  readonly before: TState;
  readonly after: TState;
}

export class CommandHistory<TState> {
  private currentState: TState;
  private readonly undoStack: HistoryEntry<TState>[] = [];
  private readonly redoStack: HistoryEntry<TState>[] = [];
  private readonly maxDepth: number;

  constructor(initialState: TState, options: { maxDepth?: number } = {}) {
    const maxDepth = options.maxDepth ?? 100;
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError("maxDepth must be a positive integer.");
    }
    this.currentState = initialState;
    this.maxDepth = maxDepth;
  }

  get state(): Readonly<TState> {
    return this.currentState;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  execute(command: UndoableCommand<TState>): Readonly<TState> {
    const before = this.currentState;
    let after: TState;
    try {
      after = command.execute(before);
    } catch (cause) {
      throw this.commandError(command, "execute", cause);
    }

    this.currentState = after;
    this.undoStack.push({ command, before, after });
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    return this.currentState;
  }

  undo(): Readonly<TState> {
    const entry = this.undoStack.at(-1);
    if (entry === undefined) {
      return this.currentState;
    }

    let previous: TState;
    try {
      previous = entry.command.undo(this.currentState);
    } catch (cause) {
      throw this.commandError(entry.command, "undo", cause);
    }

    this.undoStack.pop();
    this.redoStack.push(entry);
    this.currentState = previous;
    return this.currentState;
  }

  redo(): Readonly<TState> {
    const entry = this.redoStack.at(-1);
    if (entry === undefined) {
      return this.currentState;
    }

    let next: TState;
    try {
      next = entry.command.execute(this.currentState);
    } catch (cause) {
      throw this.commandError(entry.command, "redo", cause);
    }

    this.redoStack.pop();
    this.undoStack.push({ command: entry.command, before: this.currentState, after: next });
    this.currentState = next;
    return this.currentState;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private commandError(
    command: UndoableCommand<TState>,
    operation: "execute" | "undo" | "redo",
    cause: unknown
  ): EngineError {
    return new EngineError(ERROR_CODES.COMMAND_FAILED, `Command ${operation} failed.`, {
      cause,
      details: { commandId: command.id, commandLabel: command.label, operation }
    });
  }
}
