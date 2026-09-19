import type { Report } from "../types.js";
import { stableStringify } from "../util/stable.js";

/**
 * The full typed report. Object keys are sorted and no timestamps appear
 * anywhere, so two runs over identical input produce byte-identical bytes -
 * which is what makes `diff` and CI caching meaningful.
 */
export function renderJson(report: Report, indent = 2): string {
  return stableStringify(report, indent);
}

/** One line, for CI logs and dashboards that just want the headline. */
export function renderJsonSummary(report: Report): string {
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    maintainabilityLevel: report.application.maintainabilityLevel,
    grade: report.application.grade,
    meanCoupling: report.application.meanCoupling,
    // Rescalings of meanCoupling, not extra measurements. Kept so existing
    // dashboards keep working; prefer meanCoupling for new consumers.
    couplingIndex: report.application.couplingIndex,
    rawCouplingSum: report.application.rawCouplingSum,
    modules: report.application.k,
    statements: report.application.totalStatements,
    partitioning: report.application.partitioning.verdict,
    partitioningConfidence: report.application.partitioning.confidence,
    boundaryViolations: report.boundaryViolations.length,
    warnings: report.warnings.length,
  });
}
