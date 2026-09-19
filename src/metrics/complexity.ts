import type { ComplexityMetrics, ComplexityStats, FileNode, FunctionRef, ResolvedConfig } from "../types.js";
import { cmpStr } from "../util/stable.js";
import { max, mean, percentile, round, sum } from "../util/stats.js";

function stats(values: readonly number[]): ComplexityStats {
  return {
    mean: round(mean(values), 3),
    p90: percentile(values, 90),
    max: max(values),
    total: sum(values),
  };
}

/**
 * Aggregates the per-function complexity recorded during extraction. Pure over
 * the graph: the AST work happened in Stage 4, this only summarises it.
 *
 * p90 rather than mean is what feeds the score. A module's mean complexity is
 * dragged to nothing by its getters; the p90 is the shape of the code someone
 * actually has to sit down and read.
 */
export function computeComplexity(
  files: readonly FileNode[],
  functionsOf: (file: string) => readonly { name: string; line: number; cyclomatic: number; cognitive: number }[],
  config: ResolvedConfig,
): ComplexityMetrics {
  const cyclomatic: number[] = [];
  const cognitive: number[] = [];
  const aboveThreshold: FunctionRef[] = [];

  for (const file of files) {
    for (const fn of functionsOf(file.path)) {
      cyclomatic.push(fn.cyclomatic);
      cognitive.push(fn.cognitive);
      if (fn.cyclomatic > config.thresholds.functionComplexity) {
        aboveThreshold.push({
          name: fn.name,
          file: file.path,
          line: fn.line,
          cyclomatic: fn.cyclomatic,
          cognitive: fn.cognitive,
        });
      }
    }
  }

  aboveThreshold.sort(
    (a, b) => b.cyclomatic - a.cyclomatic || cmpStr(a.file, b.file) || a.line - b.line,
  );

  return {
    functionCount: cyclomatic.length,
    cyclomatic: stats(cyclomatic),
    cognitive: stats(cognitive),
    aboveThreshold,
  };
}
