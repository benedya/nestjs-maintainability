import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError, resolveConfig, validate } from "../../src/config/schema.js";
import { findConfigFile, loadConfig } from "../../src/config/load.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nest-ml-config-"));
}

describe("config validation", () => {
  it("names the offending key on a type error", () => {
    expect(() => validate({ weights: { coupling: "lots" } }, "test.config.ts")).toThrow(
      /weights\.coupling/,
    );
  });

  it("rejects an unknown key rather than ignoring a typo", () => {
    expect(() => validate({ weigths: { coupling: 1 } }, "test.config.ts")).toThrow(
      /Unrecognized key.*weigths/s,
    );
  });

  it("rejects an out-of-range value", () => {
    expect(() => validate({ coupling: { afferentWeight: 2 } }, "test.config.ts")).toThrow(
      /coupling\.afferentWeight/,
    );
  });

  it("accepts an empty config", () => {
    expect(validate({}, "test")).toEqual({});
  });
});

describe("config resolution", () => {
  it("fills in every default", () => {
    const { config } = resolveConfig({}, "defaults");
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges deeply, leaving untouched siblings alone", () => {
    const { config } = resolveConfig({ weights: { coupling: 0.35 }, graph: { inferCqrs: true } }, "test");
    expect(config.weights.cohesion).toBe(DEFAULT_CONFIG.weights.cohesion);
    expect(config.graph.inferCqrs).toBe(true);
    expect(config.graph.includeTypeOnlyImports).toBe(true);
  });

  it("rescales weights that do not sum to 1, and says so", () => {
    const { config, warnings } = resolveConfig(
      { weights: { coupling: 1, cohesion: 1, complexity: 1, size: 1, partitioning: 1 } },
      "test",
    );
    expect(config.weights.coupling).toBeCloseTo(0.2, 10);
    const total =
      config.weights.coupling +
      config.weights.cohesion +
      config.weights.complexity +
      config.weights.size +
      config.weights.partitioning;
    expect(total).toBeCloseTo(1, 10);
    expect(warnings.map((warning) => warning.code)).toContain("config");
  });

  it("refuses all-zero weights instead of dividing by zero", () => {
    expect(() =>
      resolveConfig(
        { weights: { coupling: 0, cohesion: 0, complexity: 0, size: 0, partitioning: 0 } },
        "test",
      ),
    ).toThrow(ConfigError);
  });

  it("refuses non-descending grade bands", () => {
    expect(() => resolveConfig({ grades: { A: 50, B: 70 } }, "test")).toThrow(/strictly descending/);
  });

  it("refuses partitioning thresholds that overlap", () => {
    expect(() =>
      resolveConfig({ partitioning: { technicalVerdictAbove: 0.2, domainVerdictBelow: 0.5 } }, "test"),
    ).toThrow(/domainVerdictBelow/);
  });

  it("normalises technical names to lower case and deduplicates them", () => {
    const { config } = resolveConfig(
      { partitioning: { technicalNames: ["Services", "services", "UTILS"] } },
      "test",
    );
    expect(config.partitioning.technicalNames).toEqual(["services", "utils"]);
  });
});

describe("config discovery", () => {
  it("walks upward to find a config file", () => {
    const dir = tempDir();
    const nested = path.join(dir, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    const target = path.join(dir, "nestjs-maintainability.config.json");
    fs.writeFileSync(target, "{}");

    expect(findConfigFile(nested)).toBe(target);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when there is nothing to find", () => {
    const dir = tempDir();
    expect(findConfigFile(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads a JSON config", async () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "nestjs-maintainability.config.json"),
      JSON.stringify({ coupling: { afferentWeight: 0.9 } }),
    );

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.coupling.afferentWeight).toBe(0.9);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads a TypeScript config with a default export", async () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "nestjs-maintainability.config.ts"),
      `export default {
         coupling: { afferentWeight: 0.6 },
         thresholds: { freeSize: 1200 },
       };`,
    );

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.coupling.afferentWeight).toBe(0.6);
    expect(loaded.config.thresholds.freeSize).toBe(1200);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lets inline options win over the config file", async () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "nestjs-maintainability.config.json"),
      JSON.stringify({ coupling: { afferentWeight: 0.9 }, cache: { enabled: true } }),
    );

    const loaded = await loadConfig({ cwd: dir, inline: { cache: { enabled: false } } });
    expect(loaded.config.cache.enabled).toBe(false);
    expect(loaded.config.coupling.afferentWeight).toBe(0.9);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("errors with the file path when the config is invalid", async () => {
    const dir = tempDir();
    const file = path.join(dir, "nestjs-maintainability.config.json");
    fs.writeFileSync(file, JSON.stringify({ thresholds: { complexitySpan: -5 } }));

    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/complexitySpan/);
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(new RegExp(file.replace(/[/\\]/g, ".")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("errors when an explicitly named config file is missing", async () => {
    const dir = tempDir();
    await expect(loadConfig({ cwd: dir, configFile: "nope.config.json" })).rejects.toThrow(
      /not found/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
