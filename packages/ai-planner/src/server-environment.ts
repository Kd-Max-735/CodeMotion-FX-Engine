import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerEnvironmentResult {
  readonly env: NodeJS.ProcessEnv;
  readonly repositoryRoot: string;
  readonly arkConfigured: boolean;
  readonly source: "process" | "root-env" | "missing";
}

function parseDotEnv(text: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) throw new Error("SERVER_ENV_INVALID");
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]!] = value;
  }
  return Object.freeze(values);
}

export function defaultRepositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function loadServerEnvironment(options: {
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly repositoryRoot?: string;
  readonly readText?: (path: string) => string;
} = {}): ServerEnvironmentResult {
  const processEnv = options.processEnv ?? process.env;
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot());
  const merged: NodeJS.ProcessEnv = { ...processEnv };
  const processKey = processEnv.ARK_API_KEY?.trim();
  let source: ServerEnvironmentResult["source"] = processKey ? "process" : "missing";
  if (!processKey) {
    try {
      const text = options.readText?.(resolve(repositoryRoot, ".env"))
        ?? readFileSync(resolve(repositoryRoot, ".env"), "utf8");
      const local = parseDotEnv(text);
      for (const [key, value] of Object.entries(local)) {
        if (merged[key] === undefined || merged[key] === "") merged[key] = value;
      }
      if (merged.ARK_API_KEY?.trim()) source = "root-env";
    } catch (error) {
      if (error instanceof Error && error.message === "SERVER_ENV_INVALID") throw error;
    }
  }
  return Object.freeze({ env: merged, repositoryRoot,
    arkConfigured: Boolean(merged.ARK_API_KEY?.trim()), source });
}
