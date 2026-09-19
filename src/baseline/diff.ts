import type { Baseline, DiffEntry, DiffResult, Report, ResolvedConfig } from "../types.js";
import { cmpStr } from "../util/stable.js";
import { round } from "../util/stats.js";

export interface DiffOptions {
  /** Ignore drops smaller than this, so float noise does not fail a build. */
  readonly tolerance?: number;
}

const DEFAULT_TOLERANCE = 0.05;

/**
 * The ratchet. `diff` fails only on regression, so a legacy codebase can start
 * at 42 and still gate every PR - what matters is that the number never gets
 * worse, and that when it does the report names the file.
 *
 * A tool that only says "you are at 42" gets uninstalled inside a week. One
 * that says "you were at 42, this PR takes you to 41, here is the import that
 * did it" gets kept.
 */
export function diffAgainstBaseline(
  baseline: Baseline,
  report: Report,
  config: ResolvedConfig,
  options: DiffOptions = {},
): DiffResult {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const reasons: string[] = [];

  const appDelta = round(report.application.maintainabilityLevel - baseline.application.maintainabilityLevel, 2);
  const appRegression = appDelta < -tolerance;
  if (appRegression) {
    reasons.push(
      `application maintainability fell ${Math.abs(appDelta).toFixed(2)} points, from ${baseline.application.maintainabilityLevel.toFixed(2)} to ${report.application.maintainabilityLevel.toFixed(2)}`,
    );
  }

  const before = new Map(baseline.modules.map((module) => [module.id, module]));
  const after = new Map(report.modules.map((module) => [module.id, module]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(cmpStr);

  const modules: DiffEntry[] = [];
  for (const id of ids) {
    const previous = before.get(id);
    const current = after.get(id);
    const beforeLevel = previous?.maintainabilityLevel ?? null;
    const afterLevel = current?.maintainabilityLevel ?? null;
    const delta =
      beforeLevel !== null && afterLevel !== null ? round(afterLevel - beforeLevel, 2) : 0;
    const regression = delta < -tolerance;

    modules.push({
      id,
      name: current?.name ?? previous?.name ?? id,
      before: beforeLevel,
      after: afterLevel,
      delta,
      regression,
    });

    if (regression) {
      reasons.push(
        `${current?.name ?? id} fell ${Math.abs(delta).toFixed(2)} points, from ${(beforeLevel as number).toFixed(2)} to ${(afterLevel as number).toFixed(2)}`,
      );
    }
  }

  const beforeViolations = new Set(baseline.boundaryViolations);
  const afterViolations = new Set(report.boundaryViolations.map((violation) => violation.id));
  const newBoundaryViolations = [...afterViolations].filter((id) => !beforeViolations.has(id)).sort(cmpStr);
  const fixedBoundaryViolations = [...beforeViolations].filter((id) => !afterViolations.has(id)).sort(cmpStr);

  if (config.fail.newBoundaryViolations && newBoundaryViolations.length > 0) {
    reasons.push(`${newBoundaryViolations.length} new boundary violation(s)`);
  }

  const regressed =
    appRegression ||
    modules.some((entry) => entry.regression) ||
    (config.fail.newBoundaryViolations && newBoundaryViolations.length > 0);

  return {
    application: {
      before: baseline.application.maintainabilityLevel,
      after: report.application.maintainabilityLevel,
      delta: appDelta,
      regression: appRegression,
    },
    modules,
    newBoundaryViolations,
    fixedBoundaryViolations,
    regressed,
    reasons,
  };
}
