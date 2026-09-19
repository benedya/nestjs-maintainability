import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ts } from "ts-morph";
import { ConfigError, resolveConfig, validate } from "./schema.js";
import { shortHash } from "../util/hash.js";
import type { ResolvedConfig, UserConfig, Warning } from "../types.js";

const CONFIG_BASENAMES = ["nestjs-maintainability.config", "nest-ml.config"];
const CONFIG_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cjs", ".json"];

export interface LoadedConfig {
  config: ResolvedConfig;
  /** Absolute path of the config file, or null when running on defaults. */
  filepath: string | null;
  warnings: Warning[];
}

/** Walk up from `from` looking for a config file. Stops at the filesystem root. */
export function findConfigFile(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    for (const base of CONFIG_BASENAMES) {
      for (const ext of CONFIG_EXTENSIONS) {
        const candidate = path.join(dir, base + ext);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Kept out of the bundlers' reach so a CJS build does not rewrite it to require().
const dynamicImport = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

async function importModule(file: string): Promise<unknown> {
  const url = pathToFileURL(file).href + `?t=${Date.now()}`;
  const mod = await dynamicImport(url);
  return mod.default ?? mod;
}

/**
 * TypeScript config files are transpiled to CommonJS and required. No type
 * checking happens: the Zod schema is the contract, and requiring a clean
 * typecheck of a config file would be a surprising place to fail.
 */
function requireTypeScript(file: string): unknown {
  const source = fs.readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: file,
  }).outputText;

  const tmp = path.join(
    os.tmpdir(),
    `nestjs-maintainability-${shortHash(file + transpiled)}.cjs`,
  );
  fs.writeFileSync(tmp, transpiled);
  try {
    const req = createRequire(file);
    // The temp file is outside the project, so relative requires inside the
    // config would break; resolve them from the config's own location instead.
    const loaded = req(tmp) as Record<string, unknown>;
    return loaded.default ?? loaded;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function readConfigFile(file: string): Promise<unknown> {
  const ext = path.extname(file);
  if (ext === ".json") return JSON.parse(fs.readFileSync(file, "utf8"));
  if (ext === ".ts" || ext === ".mts") return requireTypeScript(file);
  return importModule(file);
}

/**
 * Load, validate and resolve configuration.
 *
 * Precedence, lowest to highest: built-in defaults, config file, inline
 * options passed to `analyze()` / CLI flags.
 */
export async function loadConfig(options: {
  cwd: string;
  configFile?: string | null;
  noConfigFile?: boolean;
  inline?: UserConfig;
}): Promise<LoadedConfig> {
  const warnings: Warning[] = [];
  let filepath: string | null = null;
  let fileConfig: UserConfig = {};

  if (!options.noConfigFile) {
    filepath = options.configFile
      ? path.resolve(options.cwd, options.configFile)
      : findConfigFile(options.cwd);

    if (options.configFile && filepath && !fs.existsSync(filepath)) {
      throw new ConfigError(`Config file not found: ${filepath}`, filepath);
    }

    if (filepath) {
      let raw: unknown;
      try {
        raw = await readConfigFile(filepath);
      } catch (error) {
        throw new ConfigError(
          `Failed to load config file ${filepath}: ${(error as Error).message}`,
          filepath,
        );
      }
      fileConfig = validate(raw, filepath);
    }
  }

  const inline = validate(options.inline ?? {}, "inline options");
  const source = filepath ?? "defaults";

  const merged = mergeUserConfigs(fileConfig, inline);
  const resolved = resolveConfig(merged, source);
  warnings.push(...resolved.warnings);

  return { config: resolved.config, filepath, warnings };
}

function mergeUserConfigs(a: UserConfig, b: UserConfig): UserConfig {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      typeof current === "object" &&
      current !== null &&
      !Array.isArray(current) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      out[key] = { ...(current as object), ...(value as object) };
    } else {
      out[key] = value;
    }
  }
  return out as UserConfig;
}

export { ConfigError };
