import type { Edge, FileNode, ModuleEdge, NestModuleInfo, ResolvedConfig } from "../types.js";
import { cmpStr, sortStrings } from "../util/stable.js";
import { round } from "../util/stats.js";

export interface FileDependency {
  readonly from: string;
  readonly to: string;
  /** `(typeOnly ? typeOnlyEdgeWeight : 1) * maxConfidence`. */
  readonly weight: number;
  readonly typeOnly: boolean;
  readonly confidence: number;
  readonly kinds: readonly string[];
}

export interface ModuleGraph {
  /** Every module id, sorted. */
  readonly moduleIds: readonly string[];
  /** Deduplicated file-to-file dependencies: one entry per ordered file pair. */
  readonly fileDeps: readonly FileDependency[];
  /** module -> modules it depends on. */
  readonly out: ReadonlyMap<string, ReadonlySet<string>>;
  /** module -> modules that depend on it. */
  readonly in: ReadonlyMap<string, ReadonlySet<string>>;
  /** module -> foreign files that depend on it. */
  readonly afferentFiles: ReadonlyMap<string, ReadonlySet<string>>;
  /** module -> own files that depend on another module. */
  readonly efferentFiles: ReadonlyMap<string, ReadonlySet<string>>;
  /** module -> summed weight of dependencies with both endpoints inside it. */
  readonly internalWeight: ReadonlyMap<string, number>;
  /** module -> summed weight of dependencies with exactly one endpoint inside it. */
  readonly externalWeight: ReadonlyMap<string, number>;
  /** module -> modules declared in its `@Module({ imports })`. */
  readonly declaredOut: ReadonlyMap<string, ReadonlySet<string>>;
  /** Cross-module file dependencies, sorted. */
  readonly crossDeps: readonly FileDependency[];
  /**
   * Module ids dropped by `config.excludeModules`. Absent from everything
   * above; present in `reachOut` alone.
   */
  readonly excluded: ReadonlySet<string>;
  /**
   * `out`, but spanning excluded modules. Used only to work out which modules
   * an entrypoint reaches: excluding the root `AppModule` must not sever every
   * other module from the application it composes.
   */
  readonly reachOut: ReadonlyMap<string, ReadonlySet<string>>;
}

function ensureSet<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let set = map.get(key);
  if (!set) {
    set = new Set<V>();
    map.set(key, set);
  }
  return set;
}

/**
 * Collapses the three overlaid edge sets into the module-level dependency
 * graph the coupling and cohesion metrics run on.
 *
 * File pairs are deduplicated first: importing a class and injecting it is one
 * dependency, not two, and counting it twice would silently double a module's
 * apparent coupling for using Nest the way Nest is meant to be used.
 *
 * `excluded` modules are treated as if they were not written: no id, no
 * weights, no edges in either direction. Their edges survive in `reachOut`
 * only, so an excluded module can still connect an entrypoint to what it
 * composes.
 */
export function buildModuleGraph(
  files: ReadonlyMap<string, FileNode>,
  modules: ReadonlyMap<string, NestModuleInfo>,
  edgeSets: readonly (readonly Edge[])[],
  moduleEdges: readonly ModuleEdge[],
  config: ResolvedConfig,
  excluded: ReadonlySet<string> = new Set<string>(),
): ModuleGraph {
  const merged = new Map<string, { edge: Edge; kinds: Set<string>; typeOnly: boolean; confidence: number }>();

  for (const edges of edgeSets) {
    for (const edge of edges) {
      const key = `${edge.from} ${edge.to}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          edge,
          kinds: new Set([edge.kind]),
          typeOnly: edge.typeOnly,
          confidence: edge.confidence,
        });
        continue;
      }
      existing.kinds.add(edge.kind);
      // A value dependency subsumes a type-only one; the strongest evidence wins.
      existing.typeOnly = existing.typeOnly && edge.typeOnly;
      existing.confidence = Math.max(existing.confidence, edge.confidence);
    }
  }

  const fileDeps: FileDependency[] = [];
  for (const { edge, kinds, typeOnly, confidence } of merged.values()) {
    const weight = (typeOnly ? config.graph.typeOnlyEdgeWeight : 1) * confidence;
    if (weight === 0) continue;
    fileDeps.push({
      from: edge.from,
      to: edge.to,
      weight,
      typeOnly,
      confidence,
      kinds: sortStrings(kinds),
    });
  }
  fileDeps.sort((a, b) => cmpStr(a.from, b.from) || cmpStr(a.to, b.to));

  const moduleIds = sortStrings(modules.keys()).filter((id) => !excluded.has(id));
  const out = new Map<string, Set<string>>();
  const reachOut = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const afferentFiles = new Map<string, Set<string>>();
  const efferentFiles = new Map<string, Set<string>>();
  const internalWeight = new Map<string, number>();
  const externalWeight = new Map<string, number>();
  const declaredOut = new Map<string, Set<string>>();

  for (const id of modules.keys()) ensureSet(reachOut, id);

  for (const id of moduleIds) {
    ensureSet(out, id);
    ensureSet(incoming, id);
    ensureSet(afferentFiles, id);
    ensureSet(efferentFiles, id);
    ensureSet(declaredOut, id);
    internalWeight.set(id, 0);
    externalWeight.set(id, 0);
  }

  const crossDeps: FileDependency[] = [];

  for (const dep of fileDeps) {
    const fromModule = files.get(dep.from)?.moduleId;
    const toModule = files.get(dep.to)?.moduleId;
    if (!fromModule || !toModule) continue;
    if (fromModule !== toModule) ensureSet(reachOut, fromModule).add(toModule);
    if (excluded.has(fromModule) || excluded.has(toModule)) continue;

    if (fromModule === toModule) {
      internalWeight.set(fromModule, (internalWeight.get(fromModule) ?? 0) + dep.weight);
      continue;
    }

    crossDeps.push(dep);
    externalWeight.set(fromModule, (externalWeight.get(fromModule) ?? 0) + dep.weight);
    externalWeight.set(toModule, (externalWeight.get(toModule) ?? 0) + dep.weight);
    ensureSet(out, fromModule).add(toModule);
    ensureSet(incoming, toModule).add(fromModule);
    ensureSet(efferentFiles, fromModule).add(dep.from);
    ensureSet(afferentFiles, toModule).add(dep.from);
  }

  // Declared `@Module({ imports })` edges are coupling in their own right: Nest
  // instantiates the imported module whether or not any code references it.
  for (const edge of moduleEdges) {
    if (!modules.has(edge.from) || !modules.has(edge.to) || edge.from === edge.to) continue;
    ensureSet(reachOut, edge.from).add(edge.to);
    if (excluded.has(edge.from) || excluded.has(edge.to)) continue;
    ensureSet(declaredOut, edge.from).add(edge.to);
    ensureSet(out, edge.from).add(edge.to);
    ensureSet(incoming, edge.to).add(edge.from);
  }

  for (const id of moduleIds) {
    internalWeight.set(id, round(internalWeight.get(id) ?? 0, 4));
    externalWeight.set(id, round(externalWeight.get(id) ?? 0, 4));
  }

  return {
    moduleIds,
    fileDeps,
    out,
    in: incoming,
    afferentFiles,
    efferentFiles,
    internalWeight,
    externalWeight,
    declaredOut,
    crossDeps,
    excluded,
    reachOut,
  };
}

/**
 * Modules whose providers `m` may legitimately reach, per Nest's own rules:
 * everything it imports, everything those imports re-export, and every
 * `@Global()` module.
 */
export function visibleModules(
  moduleId: string,
  modules: ReadonlyMap<string, NestModuleInfo>,
  allowGlobal: boolean,
): Set<string> {
  const visible = new Set<string>([moduleId]);
  const queue: string[] = [];

  const module = modules.get(moduleId);
  if (module) {
    for (const ref of module.imports) {
      if (ref.moduleId) queue.push(ref.moduleId);
    }
  }

  if (allowGlobal) {
    for (const [id, candidate] of modules) {
      if (candidate.global) queue.push(id);
    }
  }

  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (visible.has(next)) continue;
    visible.add(next);
    // A re-exported module is reachable through the module that re-exports it.
    for (const reExported of modules.get(next)?.exportedModules ?? []) queue.push(reExported);
  }

  return visible;
}
