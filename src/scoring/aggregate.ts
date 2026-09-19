import { gradeFor } from "./grade.js";
import type {
  AppPartitioning,
  ModuleReport,
  RefactorCandidate,
  ResolvedConfig,
  ScopeReport,
} from "../types.js";
import { cmpStr, sortStrings } from "../util/stable.js";
import { mean, round } from "../util/stats.js";

/**
 * Section 5.2. Two independent application-level figures:
 *
 *   meanCoupling          the mean of `c_i` over the scope. 0-1, lower is
 *                         better - the same unit and direction as the
 *                         per-module `c_i` the module table shows.
 *   maintainabilityLevel  the headline: a size-weighted mean of per-module ML.
 *
 * `rawCouplingSum` and `couplingIndex` are rescalings of `meanCoupling`
 * (`* k`, and `100 * (1 - x)` respectively), not extra measurements. They are
 * emitted for book fidelity and backwards compatibility; the reporters show
 * `meanCoupling` alone, so a reader never has to hold two directions at once.
 *
 * The mean is size-weighted because a 40-file `OrdersModule` and a 2-file
 * `HealthModule` should not get an equal vote. A weighted mean can still hide
 * one catastrophic module, so read it against the per-module table rather than
 * on its own.
 */
export function aggregateScope(
  name: string,
  entrypoint: string | null,
  rootModule: string | null,
  modules: readonly ModuleReport[],
  partitioning: AppPartitioning,
  config: ResolvedConfig,
): ScopeReport {
  const sorted = [...modules].sort((a, b) => cmpStr(a.id, b.id));
  const k = sorted.length;

  const totalStatements = sorted.reduce((total, module) => total + module.size.statements, 0);
  const totalFiles = sorted.reduce((total, module) => total + module.files.length, 0);

  const rawCouplingSum = sorted.reduce((total, module) => total + module.coupling.ci, 0);
  const meanCoupling = k === 0 ? 0 : rawCouplingSum / k;
  const couplingIndex = 100 * (1 - meanCoupling);

  const levels = sorted.map((module) => module.maintainabilityLevel);

  const weighted =
    totalStatements > 0
      ? sorted.reduce(
          (total, module) =>
            total + (module.size.statements / totalStatements) * module.maintainabilityLevel,
          0,
        )
      : mean(levels);

  const maintainabilityLevel = round(weighted, 2);

  return {
    name,
    entrypoint,
    rootModule,
    moduleIds: sortStrings(sorted.map((module) => module.id)),
    k,
    totalStatements,
    totalFiles,
    meanCoupling: round(meanCoupling, 4),
    rawCouplingSum: round(rawCouplingSum, 4),
    couplingIndex: round(Math.max(0, Math.min(100, couplingIndex)), 2),
    maintainabilityLevel,
    grade: gradeFor(maintainabilityLevel, config),
    partitioning,
  };
}

/**
 * Where refactoring pays best: `coupling * size`, each normalised against the
 * worst module in the project.
 *
 * The product, not the sum, is deliberate. A huge module nothing depends on and
 * a widely depended-on module that is tiny are both fine; it is the
 * intersection that costs a team real time.
 */
export function rankRefactorCandidates(
  modules: readonly ModuleReport[],
  limit: number,
): RefactorCandidate[] {
  const maxStatements = Math.max(1, ...modules.map((module) => module.size.statements));

  const candidates = modules.map((module) => {
    const couplingFactor = Math.max(module.coupling.ci, module.blastRadius.ratio);
    const sizeFactor = module.size.statements / maxStatements;
    const score = couplingFactor * sizeFactor;

    const reasons: string[] = [];
    if (module.blastRadius.moduleCount > 0) {
      reasons.push(
        `changes reach ${module.blastRadius.moduleCount} module(s) (${Math.round(module.blastRadius.ratio * 100)}% of the app)`,
      );
    }
    reasons.push(`${module.size.statements} statements`);
    if (module.cohesion.lcom4Max > 1) {
      reasons.push(`worst class splits into ${module.cohesion.lcom4Max} responsibilities`);
    }

    return {
      moduleId: module.id,
      name: module.name,
      score: round(score, 4),
      couplingFactor: round(couplingFactor, 4),
      sizeFactor: round(sizeFactor, 4),
      maintainabilityLevel: module.maintainabilityLevel,
      reason: reasons.join("; "),
    };
  });

  return candidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || cmpStr(a.moduleId, b.moduleId))
    .slice(0, limit);
}
