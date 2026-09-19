import type { ModuleGraph } from "../graph/module-graph.js";
import type { CouplingMetrics, ResolvedConfig } from "../types.js";
import { clamp01, round } from "../util/stats.js";
import { sortStrings } from "../util/stable.js";

/**
 * Afferent and efferent coupling, and the normalised coupling level `c_i`
 * (section 4.1).
 *
 *   c_i = clamp01( (alpha * Ca + (1 - alpha) * Ce) / (k - 1) )
 *
 * `k - 1` is the number of *other* modules, so `c_i` is "what fraction of the
 * rest of the application is entangled with this module". `alpha` defaults to
 * 0.7 because incoming coupling is the thing that constrains change: what you
 * depend on is your problem, what depends on you is everyone else's.
 *
 * Pure over the graph. `scope` restricts every count to one application's
 * module set, so a monorepo's per-app numbers are not polluted by its siblings.
 */
export function computeCoupling(
  moduleId: string,
  graph: ModuleGraph,
  scope: ReadonlySet<string>,
  filesOfModule: (id: string) => ReadonlySet<string>,
  abstractSurface: { abstractions: number; concretions: number },
  config: ResolvedConfig,
): CouplingMetrics {
  const k = scope.size;
  const alpha = config.coupling.afferentWeight;

  const afferentModules = sortStrings(
    [...(graph.in.get(moduleId) ?? [])].filter((id) => id !== moduleId && scope.has(id)),
  );
  const efferentModules = sortStrings(
    [...(graph.out.get(moduleId) ?? [])].filter((id) => id !== moduleId && scope.has(id)),
  );

  const Ca = afferentModules.length;
  const Ce = efferentModules.length;

  const inScopeFile = (path: string, ownFiles: ReadonlySet<string>): boolean => !ownFiles.has(path);
  const ownFiles = filesOfModule(moduleId);

  const CaFiles = [...(graph.afferentFiles.get(moduleId) ?? [])].filter((path) =>
    inScopeFile(path, ownFiles),
  ).length;
  const CeFiles = (graph.efferentFiles.get(moduleId) ?? new Set<string>()).size;

  const ci = k <= 1 ? 0 : clamp01((alpha * Ca + (1 - alpha) * Ce) / (k - 1));
  const instability = Ca + Ce === 0 ? 0 : Ce / (Ca + Ce);

  // Martin's abstractness and distance from the main sequence (A + I = 1).
  // Not part of the composite score - it is reported so the HTML scatter can
  // show where a module sits relative to the zones of pain and uselessness.
  const declarations = abstractSurface.abstractions + abstractSurface.concretions;
  const abstractness = declarations === 0 ? 0 : abstractSurface.abstractions / declarations;
  const distance = Math.abs(abstractness + instability - 1) / Math.SQRT2;

  return {
    Ca,
    Ce,
    CaFiles,
    CeFiles,
    afferentModules,
    efferentModules,
    instability: round(instability, 4),
    ci: round(ci, 4),
    afferentWeight: alpha,
    k,
    abstractness: round(abstractness, 4),
    distanceFromMainSequence: round(distance, 4),
  };
}
