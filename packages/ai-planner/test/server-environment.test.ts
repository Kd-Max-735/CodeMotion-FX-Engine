import { describe, expect, it } from "vitest";
import { loadServerEnvironment } from "../src/server-environment.js";

describe("server-only root environment loading", () => {
  it("prefers an existing process secret without reading the file", () => {
    let reads = 0;
    const result = loadServerEnvironment({ processEnv: { ARK_API_KEY: "process-secret-value" }, repositoryRoot: "D:/repo",
      readText: () => { reads += 1; return "ARK_API_KEY=file-secret"; } });
    expect(result).toMatchObject({ arkConfigured: true, source: "process" });
    expect(result.env.ARK_API_KEY).toBe("process-secret-value");
    expect(reads).toBe(0);
  });

  it("loads the repository root .env only when process configuration is absent", () => {
    let requested = "";
    const result = loadServerEnvironment({ processEnv: {}, repositoryRoot: "D:/repo", readText: (path) => {
      requested = path; return "# local\nARK_API_KEY=root-secret-value\n";
    } });
    expect(requested.replaceAll("\\", "/")).toBe("D:/repo/.env");
    expect(result).toMatchObject({ arkConfigured: true, source: "root-env" });
  });

  it("reports only unconfigured state for an empty key", () => {
    const result = loadServerEnvironment({ processEnv: {}, repositoryRoot: "D:/repo", readText: () => "ARK_API_KEY=\n" });
    expect(result).toMatchObject({ arkConfigured: false, source: "missing" });
  });
});
