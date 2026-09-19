import type { CohesionMetrics, ComplexityMetrics, CouplingMetrics, ModulePartitioningMetrics, Penalties, ResolvedConfig, SizeMetrics } from "../types.js";
import { clamp01, round } from "../util/stats.js";

/**
 * Section 5.1. Every metric becomes a penalty in [0,1] where 0 is "no problem",
 * then the penalties are combined with the configured weights:
 *
 *   ML_m = 100 * (1 - sum_j w_j * p_j)
 *
 * The `free...` thresholds define a zone where a metric costs nothing. This is
 * not decoration: a penalty that rises linearly from zero charges a module for
 * merely existing, every module ends up mid-range, and the scores stop being
 * comparable to each other - which is the only thing they are for.
 */
export function computePenalties(
  coupling: CouplingMetrics,
  cohesion: CohesionMetrics,
  complexity: ComplexityMetrics,
  size: SizeMetrics,
  partitioning: ModulePartitioningMetrics,
  config: ResolvedConfig,
): Penalties {
  const { freeComplexity, complexitySpan, freeSize, sizeSpan } = config.thresholds;

  return {
    coupling: round(clamp01(coupling.ci), 4),
    cohesion: round(clamp01(1 - cohesion.structural), 4),
    complexity: round(clamp01((complexity.cognitive.p90 - freeComplexity) / complexitySpan), 4),
    size: round(clamp01((size.statements - freeSize) / sizeSpan), 4),
    partitioning: round(clamp01(1 - partitioning.domainAlignment), 4),
  };
}

/** `100 * (1 - sum(w_j * p_j))`, clamped to 0-100. */
export function maintainabilityLevel(penalties: Penalties, weights: Penalties): number {
  const total =
    weights.coupling * penalties.coupling +
    weights.cohesion * penalties.cohesion +
    weights.complexity * penalties.complexity +
    weights.size * penalties.size +
    weights.partitioning * penalties.partitioning;

  return round(Math.max(0, Math.min(100, 100 * (1 - total))), 2);
}
