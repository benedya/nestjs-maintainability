import type { ModuleGraph } from "../graph/module-graph.js";
import type { BlastRadius } from "../types.js";
import { round } from "../util/stats.js";
import { sortStrings } from "../util/stable.js";

/**
 * The transitive closure of *incoming* edges: everything that would land in
 * the change scope if this module changed.
 *
 * It answers "which parts of the system do I have to think about?" when a
 * module changes - and for most teams it is
 * the single most actionable number in the report, because unlike a score it
 * names the files.
 */
export function computeBlastRadius(
  moduleId: string,
  graph: ModuleGraph,
  scope: ReadonlySet<string>,
  statementsOf: (id: string) => number,
  totalStatements: number,
): BlastRadius {
  const seen = new Set<string>();
  const queue = [moduleId];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const dependent of graph.in.get(current) ?? []) {
      if (dependent === moduleId || !scope.has(dependent) || seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
    }
  }

  const modules = sortStrings(seen);
  const statements = modules.reduce((total, id) => total + statementsOf(id), 0);
  const others = Math.max(scope.size - 1, 1);
  const otherStatements = Math.max(totalStatements - statementsOf(moduleId), 1);

  return {
    modules,
    moduleCount: modules.length,
    ratio: round(modules.length / others, 4),
    statements,
    statementRatio: round(statements / otherStatements, 4),
  };
}
