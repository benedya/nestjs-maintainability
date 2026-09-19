/**
 * `nestjs-maintainability` - static maintainability and coupling metrics for
 * NestJS codebases.
 *
 * Everything the CLI can do is reachable from here. `analyze()` returns the
 * complete typed report; the reporters are pure functions over it.
 */
export { analyze } from "./analyze.js";

export { SCHEMA_VERSION } from "./types.js";
export { VERSION } from "./version.js";

export {
  DEFAULT_CONFIG,
  DEFAULT_TECHNICAL_NAMES,
  DEFAULT_EXCLUDE,
  DEFAULT_LCOM4_EXCLUDE_DECORATORS,
  DEFAULT_LCOM4_EXCLUDE_CLASSES,
  DEFAULT_LCOM4_EXCLUDE_FILES,
  configSchema,
  resolveConfig,
  loadConfig,
  findConfigFile,
  ConfigError,
} from "./config/index.js";

export {
  render,
  FORMATS,
  renderJson,
  renderJsonSummary,
  renderTableReport,
  renderModuleDetail,
  renderWhatIf,
  renderMarkdown,
  renderHtml,
  renderSarif,
  renderDot,
  renderDiff,
  findModule,
} from "./reporters/index.js";
export type { Format } from "./reporters/index.js";

export { NestMaintainabilityError } from "./errors.js";

export { createBaseline, serializeBaseline, BASELINE_FILENAME } from "./baseline/write.js";
export { diffAgainstBaseline } from "./baseline/diff.js";

// Metrics are exported so they can be reused, and unit-tested, against a
// hand-built graph without going near a filesystem.
export { computeCoupling } from "./metrics/coupling.js";
export { computeBlastRadius } from "./metrics/blast-radius.js";
export { computeCohesion } from "./metrics/cohesion.js";
export { computeLcom4, computeModuleLcom4 } from "./metrics/lcom4.js";
export { computeComplexity } from "./metrics/complexity.js";
export { computeSize } from "./metrics/size.js";
export {
  computeAppPartitioning,
  computeModulePartitioning,
  classifyName,
  classifyModule,
} from "./metrics/partitioning.js";
export { computePenalties, maintainabilityLevel } from "./scoring/penalties.js";
export { gradeFor } from "./scoring/grade.js";
export { aggregateScope, rankRefactorCandidates } from "./scoring/aggregate.js";
export { buildModuleGraph, visibleModules } from "./graph/module-graph.js";
export { selectExcludedModules } from "./discovery/exclusions.js";
export type { ModuleExclusions } from "./discovery/exclusions.js";
export { findCycles, cycleId } from "./graph/cycles.js";
export { computeComplexity as computeFunctionComplexity } from "./graph/ast/complexity.js";

export type * from "./types.js";
export type { ModuleGraph, FileDependency } from "./graph/module-graph.js";
