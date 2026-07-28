import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly stdout: Buffer;
  readonly stderr: string;
}

export function runProcess(
  executable: string,
  args: readonly string[],
  options: { input?: Uint8Array; signal?: AbortSignal; cwd?: string } = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const abort = (): void => { child.kill(); };
    if (options.signal?.aborted === true) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (options.signal?.aborted === true) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Operation cancelled."));
      } else if (code !== 0) {
        reject(new Error(`${executable} exited with code ${String(code)}: ${stderrText.trim()}`));
      } else {
        resolve({ stdout: Buffer.concat(stdout), stderr: stderrText });
      }
    });
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}
