import type { ModuleGraph } from "../graph/module-graph.js";
import type {
  AppPartitioning,
  ModulePartitioningMetrics,
  NestModuleInfo,
  Partitioning,
  ResolvedConfig,
} from "../types.js";
import { baseName } from "../util/paths.js";
import { clamp, round } from "../util/stats.js";
import { cmpStr } from "../util/stable.js";

export type Classification = "technical" | "domain";

/** Everything here is a heuristic and is capped below certainty on purpose. */
const MAX_CONFIDENCE = 0.95;

export function classifyName(name: string, technicalNames: ReadonlySet<string>): Classification {
  const normalised = name.toLowerCase().replace(/[-_]/g, "");
  if (technicalNames.has(name.toLowerCase())) return "technical";
  for (const technical of technicalNames) {
    if (technical.replace(/[-_]/g, "") === normalised) return "technical";
  }
  return "domain";
}

/**
 * A module is technical when the folder it lives in, or its class name with
 * the `Module` suffix removed, is a technical-layer name.
 */
export function classifyModule(
  module: NestModuleInfo,
  technicalNames: ReadonlySet<string>,
): Classification {
  const folder = baseName(module.dir);
  if (folder && classifyName(folder, technicalNames) === "technical") return "technical";
  const bare = module.name.replace(/Module$/, "").replace(/\/$/, "");
  if (bare && classifyName(bare, technicalNames) === "technical") return "technical";
  return "domain";
}

/**
 * Section 4.5, signal 1: is the top of the source tree organised by technical
 * layer or by domain?
 *
 * This is the least automatable of the five metrics and the output says so.
 * The confidence falls towards the middle of the range, and falls further when
 * there are too few top-level directories to draw any conclusion from.
 */
export function computeAppPartitioning(
  topLevelDirs: readonly string[],
  config: ResolvedConfig,
): AppPartitioning {
  const technicalNames = new Set(config.partitioning.technicalNames);
  const dirs = [...new Set(topLevelDirs)]
    .filter((name) => name !== "")
    .sort(cmpStr)
    .map((name) => ({ name, classification: classifyName(name, technicalNames) }));

  if (dirs.length === 0) {
    return {
      verdict: "mixed",
      confidence: 0,
      technicalRatio: 0,
      topLevelDirs: [],
      note: "No top-level source directories were found, so partitioning could not be judged.",
    };
  }

  const technicalCount = dirs.filter((dir) => dir.classification === "technical").length;
  const ratio = technicalCount / dirs.length;
  const above = config.partitioning.technicalVerdictAbove;
  const below = config.partitioning.domainVerdictBelow;

  let verdict: Partitioning;
  let margin: number;
  if (ratio >= above) {
    verdict = "technical";
    margin = above >= 1 ? 1 : (ratio - above) / (1 - above);
  } else if (ratio <= below) {
    verdict = "domain";
    margin = below <= 0 ? 1 : (below - ratio) / below;
  } else {
    verdict = "mixed";
    const mid = (above + below) / 2;
    const halfSpan = (above - below) / 2;
    margin = halfSpan === 0 ? 0 : 1 - Math.abs(ratio - mid) / halfSpan;
  }

  // Four directories is the point below which the sample says very little.
  const sampleFactor = Math.min(1, dirs.length / 4);
  const confidence = clamp((0.5 + 0.5 * clamp(margin, 0, 1)) * sampleFactor, 0, MAX_CONFIDENCE);

  return {
    verdict,
    confidence: round(confidence, 3),
    technicalRatio: round(ratio, 4),
    topLevelDirs: dirs,
    note:
      `${technicalCount} of ${dirs.length} top-level directories under the source root match a technical-layer name. ` +
      "This is a name-matching heuristic; a domain folder that happens to be called `models` will be misread.",
  };
}

/**
 * Section 4.5, signal 2: how much of this module's outgoing coupling lands on
 * technical layers rather than domain peers.
 *
 * `domainAlignment` of 1 means every dependency stays among domain modules.
 * Low values mean the module's behaviour is smeared across layers, where one
 * feature touches the controller, the service, the repository and the shared
 * entity folder.
 */
export function computeModulePartitioning(
  moduleId: string,
  graph: ModuleGraph,
  classificationOf: (id: string) => Classification,
  scope: ReadonlySet<string>,
): ModulePartitioningMetrics {
  let technicalEdges = 0;
  let domainEdges = 0;

  for (const target of graph.out.get(moduleId) ?? []) {
    if (target === moduleId || !scope.has(target)) continue;
    if (classificationOf(target) === "technical") technicalEdges++;
    else domainEdges++;
  }

  const total = technicalEdges + domainEdges;
  const domainAlignment = total === 0 ? 1 : domainEdges / total;
  const confidence = clamp(0.4 + 0.05 * total, 0, MAX_CONFIDENCE);

  return {
    domainAlignment: round(domainAlignment, 4),
    technicalEdges,
    domainEdges,
    classification: classificationOf(moduleId),
    confidence: round(confidence, 3),
  };
}
