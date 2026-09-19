import { computeModuleLcom4 } from "./lcom4.js";
import type { ModuleGraph } from "../graph/module-graph.js";
import type { ClassInfo, CohesionMetrics, ResolvedConfig } from "../types.js";
import { mean, round } from "../util/stats.js";

/**
 * Structural cohesion: of all dependencies with at least one endpoint inside
 * the module, the fraction that stay inside.
 *
 *   cohesion(m) = internal / (internal + external)
 *
 * Both terms are *weighted* sums, not raw counts, so that a type-only edge can
 * be discounted via `graph.typeOnlyEdgeWeight` and an inferred edge counts only
 * for its confidence. Both values are reported, so the division can be checked
 * by hand from the JSON.
 *
 * A module with no dependencies at all scores 1: a single self-contained file
 * is perfectly cohesive, and scoring it 0 would punish exactly the thing the
 * metric is supposed to reward.
 */
export function computeCohesion(
  moduleId: string,
  graph: ModuleGraph,
  classes: readonly ClassInfo[],
  config: ResolvedConfig,
): CohesionMetrics {
  const internalEdges = graph.internalWeight.get(moduleId) ?? 0;
  const externalEdges = graph.externalWeight.get(moduleId) ?? 0;
  const total = internalEdges + externalEdges;
  const structural = total === 0 ? 1 : internalEdges / total;

  const lcom4Classes = computeModuleLcom4(classes, config);
  const counted = lcom4Classes.filter((entry) => entry.counted);
  const scores = counted.map((entry) => entry.lcom4);

  return {
    structural: round(structural, 4),
    internalEdges: round(internalEdges, 4),
    externalEdges: round(externalEdges, 4),
    lcom4Max: scores.length === 0 ? 1 : Math.max(...scores),
    lcom4Mean: scores.length === 0 ? 1 : round(mean(scores), 3),
    lcom4Classes,
  };
}
