import { z } from "zod";
import { DEFAULT_CONFIG } from "./defaults.js";
import { NestMaintainabilityError } from "../errors.js";
import type { ResolvedConfig, UserConfig, Warning } from "../types.js";

const unit = z.number().min(0).max(1);
const nonNeg = z.number().min(0);
const positive = z.number().positive();

/**
 * User-facing schema. Every key is optional and unknown keys are rejected by
 * name, so a typo produces "Unrecognized key: 'weigths'" rather than being
 * silently ignored and quietly changing nobody's score.
 */
export const configSchema = z.strictObject({
  tsconfig: z.string().optional(),
  rootModule: z.string().nullable().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  excludeModules: z.array(z.string()).optional(),

  graph: z
    .strictObject({
      includeTypeOnlyImports: z.boolean().optional(),
      typeOnlyEdgeWeight: z.number().min(0).max(1).optional(),
      inferEventCoupling: z.boolean().optional(),
      inferEntityRelations: z.boolean().optional(),
      inferCqrs: z.boolean().optional(),
      inferHttp: z.boolean().optional(),
      includeDynamicImports: z.boolean().optional(),
    })
    .optional(),

  coupling: z.strictObject({ afferentWeight: unit.optional() }).optional(),

  weights: z
    .strictObject({
      coupling: nonNeg.optional(),
      cohesion: nonNeg.optional(),
      complexity: nonNeg.optional(),
      size: nonNeg.optional(),
      partitioning: nonNeg.optional(),
    })
    .optional(),

  thresholds: z
    .strictObject({
      freeComplexity: nonNeg.optional(),
      complexitySpan: positive.optional(),
      freeSize: nonNeg.optional(),
      sizeSpan: positive.optional(),
      functionComplexity: positive.optional(),
    })
    .optional(),

  grades: z
    .strictObject({
      A: z.number().min(0).max(100).optional(),
      B: z.number().min(0).max(100).optional(),
      C: z.number().min(0).max(100).optional(),
      D: z.number().min(0).max(100).optional(),
    })
    .optional(),

  lcom4: z
    .strictObject({
      excludeConstructor: z.boolean().optional(),
      minMethods: z.number().int().min(0).optional(),
      excludeDecorators: z.array(z.string()).optional(),
      excludeClasses: z.array(z.string()).optional(),
      excludeFiles: z.array(z.string()).optional(),
    })
    .optional(),

  fail: z
    .strictObject({
      appMaintainabilityBelow: z.number().min(0).max(100).nullable().optional(),
      moduleMaintainabilityBelow: z.number().min(0).max(100).nullable().optional(),
      newBoundaryViolations: z.boolean().optional(),
      warningsAbove: z.number().int().min(0).nullable().optional(),
    })
    .optional(),

  partitioning: z
    .strictObject({
      technicalNames: z.array(z.string()).optional(),
      technicalVerdictAbove: unit.optional(),
      domainVerdictBelow: unit.optional(),
    })
    .optional(),

  boundaries: z
    .strictObject({
      reportSyntheticTargets: z.boolean().optional(),
      allowGlobalModules: z.boolean().optional(),
      ignoreTypeOnly: z.boolean().optional(),
    })
    .optional(),

  cache: z
    .strictObject({
      enabled: z.boolean().optional(),
      dir: z.string().nullable().optional(),
    })
    .optional(),
});

export class ConfigError extends NestMaintainabilityError {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Turns a ZodError into a message that names the offending key. */
export function formatIssues(error: z.ZodError, source: string): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `  - ${key}: ${issue.message}`;
  });
  return `Invalid configuration in ${source}:\n${lines.join("\n")}`;
}

export function validate(input: unknown, source: string): UserConfig {
  const result = configSchema.safeParse(input ?? {});
  if (!result.success) throw new ConfigError(formatIssues(result.error, source), source);
  return result.data as UserConfig;
}

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge where arrays replace wholesale and `undefined` never overwrites. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Plain = { ...(base as unknown as Plain) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as unknown as T;
}

/**
 * Merge user config over the defaults and normalise. Returns warnings rather
 * than throwing for anything recoverable: a report that says "your weights did
 * not sum to 1, they were rescaled" is more useful than a hard failure.
 */
export function resolveConfig(
  user: UserConfig,
  source: string,
): { config: ResolvedConfig; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const merged = deepMerge(DEFAULT_CONFIG, user);

  const w = merged.weights;
  const total = w.coupling + w.cohesion + w.complexity + w.size + w.partitioning;
  let weights = w;
  if (total <= 0) {
    throw new ConfigError(`Invalid configuration in ${source}:\n  - weights: must not all be zero`, source);
  }
  if (Math.abs(total - 1) > 1e-9) {
    weights = {
      coupling: w.coupling / total,
      cohesion: w.cohesion / total,
      complexity: w.complexity / total,
      size: w.size / total,
      partitioning: w.partitioning / total,
    };
    warnings.push({
      code: "config",
      message: `weights summed to ${total.toFixed(4)}, not 1; rescaled proportionally so maintainabilityLevel stays within 0-100`,
      file: source,
    });
  }

  const g = merged.grades;
  if (!(g.A > g.B && g.B > g.C && g.C > g.D)) {
    throw new ConfigError(
      `Invalid configuration in ${source}:\n  - grades: bands must be strictly descending (A > B > C > D), got A=${g.A} B=${g.B} C=${g.C} D=${g.D}`,
      source,
    );
  }

  const p = merged.partitioning;
  if (p.domainVerdictBelow >= p.technicalVerdictAbove) {
    throw new ConfigError(
      `Invalid configuration in ${source}:\n  - partitioning.domainVerdictBelow (${p.domainVerdictBelow}) must be below partitioning.technicalVerdictAbove (${p.technicalVerdictAbove})`,
      source,
    );
  }

  const config: ResolvedConfig = {
    ...merged,
    weights,
    partitioning: {
      ...p,
      technicalNames: [...new Set(p.technicalNames.map((n) => n.toLowerCase()))].sort(),
    },
    lcom4: {
      ...merged.lcom4,
      excludeDecorators: [...merged.lcom4.excludeDecorators],
      excludeClasses: [...merged.lcom4.excludeClasses],
      excludeFiles: [...merged.lcom4.excludeFiles],
    },
    exclude: [...merged.exclude],
    include: [...merged.include],
    excludeModules: [...new Set(merged.excludeModules)].sort(),
  };

  return { config, warnings };
}
