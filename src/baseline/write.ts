import type { Baseline, Report } from "../types.js";
import { stableStringify } from "../util/stable.js";

export const BASELINE_FILENAME = "nestjs-maintainability.baseline.json";

/**
 * A committed snapshot of the current scores.
 *
 * Deliberately small and deterministic: no timestamp, sorted keys, only the
 * values `diff` compares. It is meant to live in version control next to the
 * code, so a reviewer can see in the PR diff exactly which number moved.
 */
export function createBaseline(report: Report): Baseline {
  return {
    schemaVersion: report.schemaVersion,
    tool: `${report.tool.name}@${report.tool.version}`,
    application: {
      maintainabilityLevel: report.application.maintainabilityLevel,
      couplingIndex: report.application.couplingIndex,
      rawCouplingSum: report.application.rawCouplingSum,
      grade: report.application.grade,
      k: report.application.k,
    },
    modules: [...report.modules]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((module) => ({
        id: module.id,
        name: module.name,
        maintainabilityLevel: module.maintainabilityLevel,
        ci: module.coupling.ci,
        Ca: module.coupling.Ca,
        Ce: module.coupling.Ce,
        statements: module.size.statements,
      })),
    boundaryViolations: report.boundaryViolations.map((violation) => violation.id).sort(),
    warningCount: report.warnings.length,
  };
}

export function serializeBaseline(baseline: Baseline): string {
  return `${stableStringify(baseline, 2)}\n`;
}
