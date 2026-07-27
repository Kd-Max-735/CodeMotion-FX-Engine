import { describe, expect, it } from "vitest";
import { CommandHistory, ERROR_CODES, type UndoableCommand } from "../src/index.js";

function add(amount: number): UndoableCommand<number> {
  return {
    id: `add.${amount}`,
    label: `Add ${amount}`,
    execute: (state) => state + amount,
    undo: (state) => state - amount
  };
}

describe("CommandHistory", () => {
  it("executes, undoes, and redoes pure commands", () => {
    const history = new CommandHistory(0);
    expect(history.execute(add(2))).toBe(2);
    expect(history.execute(add(3))).toBe(5);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(0);
    expect(history.redo()).toBe(2);
    expect(history.redo()).toBe(5);
  });

  it("clears the redo branch after a new command", () => {
    const history = new CommandHistory(0);
    history.execute(add(1));
    history.execute(add(2));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(add(10));
    expect(history.state).toBe(11);
    expect(history.canRedo).toBe(false);
  });

  it("enforces history depth and treats empty undo/redo as no-ops", () => {
    const history = new CommandHistory(0, { maxDepth: 2 });
    history.execute(add(1));
    history.execute(add(1));
    history.execute(add(1));
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(1);
    history.clear();
    expect(history.redo()).toBe(1);
  });

  it("preserves history when command execution or undo fails", () => {
    const history = new CommandHistory(0);
    const executeFailure: UndoableCommand<number> = {
      id: "fail.execute",
      label: "Fail execute",
      execute: () => { throw new Error("failure"); },
      undo: (state) => state
    };
    expect(() => history.execute(executeFailure)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.COMMAND_FAILED })
    );
    expect(history.state).toBe(0);
    expect(history.canUndo).toBe(false);

    const undoFailure: UndoableCommand<number> = {
      id: "fail.undo",
      label: "Fail undo",
      execute: (state) => state + 1,
      undo: () => { throw new Error("failure"); }
    };
    history.execute(undoFailure);
    expect(() => history.undo()).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.COMMAND_FAILED })
    );
    expect(history.state).toBe(1);
    expect(history.canUndo).toBe(true);
  });

  it("replays the same command sequence deterministically", () => {
    const run = (): number => {
      const history = new CommandHistory(10);
      history.execute(add(5));
      history.execute(add(-2));
      history.undo();
      history.redo();
      return history.state;
    };
    expect([run(), run(), run()]).toEqual([13, 13, 13]);
  });
});
