import { visibleModules } from "./module-graph.js";
import type {
  BoundaryViolation,
  Edge,
  FileNode,
  NestModuleInfo,
  ResolvedConfig,
} from "../types.js";
import { cmpStr } from "../util/stable.js";

/**
 * Stage 4's reconciliation step: an actual dependency that crosses a module
 * boundary Nest was never told about.
 *
 * "Told about" follows Nest's own visibility rules - the module's own
 * `imports`, anything those imports re-export, and every `@Global()` module -
 * so a legitimate re-export chain is not reported.
 *
 * Two deliberate exclusions:
 *   - synthetic pseudo-modules as the *source*: there is no `imports` array to
 *     add anything to, so there is nothing actionable to report;
 *   - synthetic pseudo-modules as the *target* unless `reportSyntheticTargets`
 *     is on: shared folders are not Nest modules and cannot be imported.
 * Both still count fully towards coupling. This only governs what is listed as
 * a violation to go and fix.
 */
export function findBoundaryViolations(
  edgeSets: readonly (readonly Edge[])[],
  files: ReadonlyMap<string, FileNode>,
  modules: ReadonlyMap<string, NestModuleInfo>,
  config: ResolvedConfig,
): BoundaryViolation[] {
  const visibilityCache = new Map<string, Set<string>>();
  const visibility = (id: string): Set<string> => {
    let set = visibilityCache.get(id);
    if (!set) {
      set = visibleModules(id, modules, config.boundaries.allowGlobalModules);
      visibilityCache.set(id, set);
    }
    return set;
  };

  const seen = new Set<string>();
  const violations: BoundaryViolation[] = [];

  for (const edges of edgeSets) {
    for (const edge of edges) {
      if (edge.typeOnly && config.boundaries.ignoreTypeOnly) continue;

      const fromNode = files.get(edge.from);
      const toNode = files.get(edge.to);
      if (!fromNode || !toNode) continue;
      if (fromNode.moduleId === toNode.moduleId) continue;

      const fromModule = modules.get(fromNode.moduleId);
      const toModule = modules.get(toNode.moduleId);
      if (!fromModule || !toModule) continue;
      if (fromModule.kind !== "nest") continue;
      if (toModule.kind === "synthetic" && !config.boundaries.reportSyntheticTargets) continue;

      if (visibility(fromModule.id).has(toModule.id)) continue;

      const id = `${edge.from}->${edge.to}#${edge.kind}`;
      if (seen.has(id)) continue;
      seen.add(id);

      violations.push({
        from: edge.from,
        to: edge.to,
        fromModule: fromModule.id,
        toModule: toModule.id,
        kind: edge.kind,
        typeOnly: edge.typeOnly,
        line: edge.line,
        confidence: edge.confidence,
        id,
        ...(edge.detail ? { detail: edge.detail } : {}),
      });
    }
  }

  return violations.sort(
    (a, b) =>
      cmpStr(a.fromModule, b.fromModule) ||
      cmpStr(a.toModule, b.toModule) ||
      cmpStr(a.from, b.from) ||
      cmpStr(a.to, b.to) ||
      cmpStr(a.kind, b.kind),
  );
}
