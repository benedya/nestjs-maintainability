import path from "node:path";
import { loadConfig } from "./config/load.js";
import { ConfigError } from "./config/schema.js";
import { loadProject } from "./discovery/project.js";
import { SymbolResolver } from "./discovery/symbols.js";
import { discoverModules } from "./discovery/modules.js";
import { resolveOwnership } from "./discovery/ownership.js";
import { selectExcludedModules } from "./discovery/exclusions.js";
import { buildEdges } from "./graph/build.js";
import { buildModuleGraph, type ModuleGraph } from "./graph/module-graph.js";
import { findBoundaryViolations } from "./graph/reconcile.js";
import { cycleId, findCycles } from "./graph/cycles.js";
import { computeCoupling } from "./metrics/coupling.js";
import { computeBlastRadius } from "./metrics/blast-radius.js";
import { computeCohesion } from "./metrics/cohesion.js";
import { computeComplexity } from "./metrics/complexity.js";
import { computeSize } from "./metrics/size.js";
import {
  classifyModule,
  computeAppPartitioning,
  computeModulePartitioning,
  type Classification,
} from "./metrics/partitioning.js";
import { computePenalties, maintainabilityLevel } from "./scoring/penalties.js";
import { gradeFor } from "./scoring/grade.js";
import { aggregateScope, rankRefactorCandidates } from "./scoring/aggregate.js";
import { SCHEMA_VERSION } from "./types.js";
import { VERSION } from "./version.js";
import { topLevelSegment, toPosix } from "./util/paths.js";
import { cmpStr, sortStrings } from "./util/stable.js";
import type {
  AnalyzeOptions,
  ClassInfo,
  Entrypoint,
  ExcludedModule,
  FileCycle,
  FileNode,
  FileReport,
  ModuleReport,
  NestModuleInfo,
  Report,
  ResolvedConfig,
  ScopeReport,
  Warning,
} from "./types.js";

const MAX_REFACTOR_CANDIDATES = 15;

/**
 * The whole pipeline, Stage 1 through Stage 5.
 *
 * Every CLI feature is reachable from here; the CLI is a thin shell over this
 * function and the reporters.
 */
export async function analyze(options: AnalyzeOptions = {}): Promise<Report> {
  const progress = options.onProgress ?? (() => {});
  const root = path.resolve(options.path ?? process.cwd());

  const { path: _path, configFile, noConfigFile, onProgress: _onProgress, ...inline } = options;

  progress("config");
  const loaded = await loadConfig({
    cwd: root,
    configFile: configFile ?? null,
    noConfigFile: noConfigFile ?? false,
    inline,
  });
  const config = loaded.config;
  const warnings: Warning[] = [...loaded.warnings];

  progress("load", "parsing project");
  const project = loadProject(root, config);
  warnings.push(...project.warnings);

  const resolver = new SymbolResolver(project.extracted, project.resolve);

  progress("modules", "discovering @Module classes");
  const discovered = discoverModules(project.extracted, resolver);
  warnings.push(...discovered.warnings);

  progress("ownership", "assigning files to modules");
  const ownership = resolveOwnership(project.extracted, discovered.modules, project.sourceRoot);
  warnings.push(...ownership.warnings);

  const allFiles = ownership.files;
  const allModules = ownership.modules;

  const exclusions = selectExcludedModules(allModules, config.excludeModules, loaded.filepath ?? "config");
  warnings.push(...exclusions.warnings);
  if (allModules.size > 0 && exclusions.ids.size === allModules.size) {
    throw new ConfigError(
      `excludeModules matched all ${allModules.size} discovered module(s), leaving nothing to score: ` +
        `${JSON.stringify(config.excludeModules)}`,
      loaded.filepath ?? "config",
    );
  }

  // Excluded modules leave the report entirely: their files are not scored,
  // not counted and not available to couple anything else. Only the module
  // graph keeps a memory of them, so an excluded composition root can still
  // connect an entrypoint to the modules it wires together.
  const excludedModules = describeExclusions(allModules, allFiles, exclusions.matchedBy);
  const files = filterFiles(allFiles, exclusions.ids);
  const modules = filterModules(allModules, exclusions.ids);

  progress("graph", "building import, module and DI graphs");
  const edges = buildEdges(project.extracted, allFiles, discovered.providers, resolver, config);
  warnings.push(...edges.warnings);

  const edgeSets = [edges.importEdges, edges.diEdges, edges.inferredEdges];
  const graph = buildModuleGraph(
    allFiles,
    allModules,
    edgeSets,
    discovered.moduleEdges,
    config,
    exclusions.ids,
  );

  progress("reconcile", "finding boundary violations");
  // `allModules` on purpose: an excluded module is invisible as an endpoint
  // (its files are gone from `files`) but a re-export chain that happens to
  // run through one is still how Nest resolves the provider.
  const boundaryViolations = findBoundaryViolations(edgeSets, files, allModules, config);

  const fileAdjacency = new Map<string, string[]>();
  for (const dep of graph.fileDeps) {
    if (!files.has(dep.from) || !files.has(dep.to)) continue;
    const list = fileAdjacency.get(dep.from) ?? [];
    list.push(dep.to);
    fileAdjacency.set(dep.from, list);
  }
  const fileCycles: FileCycle[] = findCycles(
    sortStrings(files.keys()),
    (file) => fileAdjacency.get(file) ?? [],
  ).map((members) => ({
    files: members,
    length: members.length,
    id: cycleId("file", members),
  }));

  progress("metrics", "scoring modules");

  const technicalNames = new Set(config.partitioning.technicalNames);
  const classifications = new Map<string, Classification>();
  for (const module of modules.values()) {
    classifications.set(module.id, classifyModule(module, technicalNames));
  }
  const classificationOf = (id: string): Classification => classifications.get(id) ?? "domain";

  const statementsByModule = new Map<string, number>();
  for (const module of modules.values()) {
    let total = 0;
    for (const file of module.files) total += files.get(file)?.statements ?? 0;
    statementsByModule.set(module.id, total);
  }
  const scoreScope = (scope: ReadonlySet<string>): ModuleReport[] => {
    const scopeStatements = [...scope].reduce(
      (total, id) => total + (statementsByModule.get(id) ?? 0),
      0,
    );

    return sortStrings(scope).map((id) =>
      scoreModule(
        modules.get(id) as NestModuleInfo,
        graph,
        scope,
        files,
        project.extracted,
        classificationOf,
        statementsByModule,
        scopeStatements,
        config,
      ),
    );
  };

  const allModuleIds = new Set(graph.moduleIds);
  const moduleReports = scoreScope(allModuleIds);

  const topLevelDirs = sortStrings(
    new Set([...files.keys()].map((file) => topLevelSegment(project.sourceRoot, file))),
  ).filter((name) => name !== "");
  const appPartitioning = computeAppPartitioning(topLevelDirs, config);

  const application = aggregateScope("all", null, null, moduleReports, appPartitioning, config);

  // Each NestFactory entrypoint is its own application; the union above keeps
  // the monorepo-wide picture. An explicit `rootModule` overrides detection.
  const applications: ScopeReport[] = [];
  const roots = resolveRoots(config.rootModule, discovered.entrypoints, allModules, root, warnings);
  for (const entry of roots) {
    const scope = reachableFrom(entry.rootModuleId as string, graph);
    if (scope.size === 0) continue;
    const scoped = scoreScope(scope);
    const scopeDirs = sortStrings(
      new Set(
        [...scope].flatMap((id) =>
          (modules.get(id)?.files ?? []).map((file) => topLevelSegment(project.sourceRoot, file)),
        ),
      ),
    ).filter((name) => name !== "");
    applications.push(
      aggregateScope(
        allModules.get(entry.rootModuleId as string)?.name ?? entry.rootModuleName,
        entry.file,
        entry.rootModuleId,
        scoped,
        computeAppPartitioning(scopeDirs, config),
        config,
      ),
    );
  }
  if (applications.length === 0) applications.push(application);
  else if (applications.length > 1) applications.unshift(application);

  const fileReports = buildFileReports(files, graph);

  // Counted over the files that survived `excludeModules`, so the edge totals
  // describe the same codebase as every other number in the report.
  const scored = (edge: { from: string; to: string }): boolean =>
    files.has(edge.from) && files.has(edge.to);
  const importEdges = edges.importEdges.filter(scored);
  const stats = {
    importEdges: importEdges.length,
    diEdges: edges.diEdges.filter(scored).length,
    inferredEdges: edges.inferredEdges.filter(scored).length,
    typeOnlyEdges: importEdges.filter((edge) => edge.typeOnly).length,
    crossModuleEdges: graph.crossDeps.length,
    filesFromCache: project.cacheHits,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "nestjs-maintainability", version: VERSION },
    project: {
      root: toPosix(root),
      tsconfig: toPosix(path.relative(root, project.tsconfigPath)),
      sourceRoot: project.sourceRoot,
      fileCount: files.size,
      entrypoints: discovered.entrypoints,
    },
    config,
    application,
    applications,
    modules: moduleReports.sort(
      (a, b) => a.maintainabilityLevel - b.maintainabilityLevel || cmpStr(a.id, b.id),
    ),
    files: fileReports,
    providers: discovered.providers,
    boundaryViolations,
    fileCycles,
    refactorCandidates: rankRefactorCandidates(moduleReports, MAX_REFACTOR_CANDIDATES),
    excludedModules,
    warnings: sortWarnings(warnings),
    stats,
  };
}

function sortWarnings(warnings: readonly Warning[]): Warning[] {
  return [...warnings].sort(
    (a, b) =>
      cmpStr(a.code, b.code) ||
      cmpStr(a.file ?? "", b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      cmpStr(a.message, b.message),
  );
}

/**
 * The application roots to score separately. `config.rootModule` wins when it
 * is set and resolves; otherwise every detected `NestFactory` call is a root.
 */
function resolveRoots(
  configured: string | null,
  entrypoints: readonly Entrypoint[],
  modules: ReadonlyMap<string, NestModuleInfo>,
  root: string,
  warnings: Warning[],
): Entrypoint[] {
  const detected = entrypoints.filter((entry) => entry.rootModuleId !== null);
  if (!configured) return detected;

  const wanted = toPosix(path.relative(root, path.resolve(root, configured)));
  const match = [...modules.values()].find((module) => module.file === wanted);

  if (!match) {
    warnings.push({
      code: "no-root-module",
      message: `rootModule was set to ${wanted}, but no @Module class was found there; falling back to the ${detected.length} detected NestFactory entrypoint(s)`,
      file: wanted,
    });
    return detected;
  }

  const existing = detected.find((entry) => entry.rootModuleId === match.id);
  return [
    existing ?? {
      file: wanted,
      rootModuleId: match.id,
      rootModuleName: match.name,
      line: match.line,
    },
  ];
}

/**
 * Everything a root module pulls in, directly or transitively.
 *
 * The walk uses `reachOut`, which spans excluded modules, and drops them from
 * the answer afterwards. Walking `out` instead would make excluding a
 * composition root silently empty its whole application.
 */
function reachableFrom(rootId: string, graph: ModuleGraph): Set<string> {
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const next of graph.reachOut.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const id of graph.excluded) seen.delete(id);
  return seen;
}

function filterFiles(
  files: ReadonlyMap<string, FileNode>,
  excluded: ReadonlySet<string>,
): Map<string, FileNode> {
  const kept = new Map<string, FileNode>();
  for (const [path, node] of files) {
    if (!excluded.has(node.moduleId)) kept.set(path, node);
  }
  return kept;
}

function filterModules(
  modules: ReadonlyMap<string, NestModuleInfo>,
  excluded: ReadonlySet<string>,
): Map<string, NestModuleInfo> {
  const kept = new Map<string, NestModuleInfo>();
  for (const [id, module] of modules) {
    if (!excluded.has(id)) kept.set(id, module);
  }
  return kept;
}

/** What each exclusion cost the report, so the omission is never invisible. */
function describeExclusions(
  modules: ReadonlyMap<string, NestModuleInfo>,
  files: ReadonlyMap<string, FileNode>,
  matchedBy: ReadonlyMap<string, string>,
): ExcludedModule[] {
  return sortStrings(matchedBy.keys()).map((id) => {
    const module = modules.get(id) as NestModuleInfo;
    return {
      id,
      name: module.name,
      file: module.file,
      kind: module.kind,
      pattern: matchedBy.get(id) as string,
      files: module.files.length,
      statements: module.files.reduce((total, path) => total + (files.get(path)?.statements ?? 0), 0),
    };
  });
}

function scoreModule(
  module: NestModuleInfo,
  graph: ModuleGraph,
  scope: ReadonlySet<string>,
  files: ReadonlyMap<string, FileNode>,
  extracted: ReadonlyMap<string, { file: { functions: readonly { name: string; line: number; cyclomatic: number; cognitive: number }[] } }>,
  classificationOf: (id: string) => Classification,
  statementsByModule: ReadonlyMap<string, number>,
  scopeStatements: number,
  config: ResolvedConfig,
): ModuleReport {
  const ownFiles = new Set(module.files);
  const fileNodes = module.files
    .map((path) => files.get(path))
    .filter((node): node is FileNode => node !== undefined);

  const classes: ClassInfo[] = fileNodes.flatMap((node) => [...node.classes]);

  const abstractSurface = fileNodes.reduce(
    (totals, node) => ({
      abstractions: totals.abstractions + node.abstractions,
      concretions: totals.concretions + node.concretions,
    }),
    { abstractions: 0, concretions: 0 },
  );

  const coupling = computeCoupling(module.id, graph, scope, () => ownFiles, abstractSurface, config);
  const blastRadius = computeBlastRadius(
    module.id,
    graph,
    scope,
    (id) => statementsByModule.get(id) ?? 0,
    scopeStatements,
  );
  const cohesion = computeCohesion(module.id, graph, classes, config);
  const complexity = computeComplexity(
    fileNodes,
    (file) => extracted.get(file)?.file.functions ?? [],
    config,
  );
  const size = computeSize(fileNodes);
  const partitioning = computeModulePartitioning(module.id, graph, classificationOf, scope);

  const penalties = computePenalties(coupling, cohesion, complexity, size, partitioning, config);
  const weights = {
    coupling: config.weights.coupling,
    cohesion: config.weights.cohesion,
    complexity: config.weights.complexity,
    size: config.weights.size,
    partitioning: config.weights.partitioning,
  };
  const ml = maintainabilityLevel(penalties, weights);

  return {
    id: module.id,
    name: module.name,
    file: module.file,
    kind: module.kind,
    global: module.global,
    dir: module.dir,
    files: module.files,
    coupling,
    blastRadius,
    cohesion,
    complexity,
    size,
    partitioning,
    penalties,
    weights,
    maintainabilityLevel: ml,
    grade: gradeFor(ml, config),
  };
}

function buildFileReports(
  files: ReadonlyMap<string, FileNode>,
  graph: ModuleGraph,
): FileReport[] {
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const crossOut = new Map<string, number>();

  for (const dep of graph.fileDeps) {
    outDegree.set(dep.from, (outDegree.get(dep.from) ?? 0) + 1);
    inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
    const fromModule = files.get(dep.from)?.moduleId;
    const toModule = files.get(dep.to)?.moduleId;
    if (fromModule && toModule && fromModule !== toModule) {
      crossOut.set(dep.from, (crossOut.get(dep.from) ?? 0) + 1);
    }
  }

  return sortStrings(files.keys()).map((path) => {
    const node = files.get(path) as FileNode;
    let cyclomaticMax = 0;
    let cognitiveMax = 0;
    for (const info of node.classes) {
      for (const fn of info.functions) {
        if (fn.cyclomatic > cyclomaticMax) cyclomaticMax = fn.cyclomatic;
        if (fn.cognitive > cognitiveMax) cognitiveMax = fn.cognitive;
      }
    }

    return {
      path,
      moduleId: node.moduleId,
      foreign: node.foreign,
      statements: node.statements,
      classes: sortStrings(node.classes.map((info) => info.name)),
      imports: outDegree.get(path) ?? 0,
      importedBy: inDegree.get(path) ?? 0,
      crossModuleImports: crossOut.get(path) ?? 0,
      cyclomaticMax,
      cognitiveMax,
      parseErrors: node.parseErrors,
    };
  });
}
