import { buildModuleGraph, type ModuleGraph } from "../../src/graph/module-graph.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { resolveConfig } from "../../src/config/schema.js";
import type {
  ClassInfo,
  Edge,
  FileNode,
  MemberGraph,
  ModuleEdge,
  NestModuleInfo,
  ResolvedConfig,
  UserConfig,
} from "../../src/types.js";

/**
 * Hand-built graph fixtures. Nothing here touches the filesystem, so every
 * metric can be exercised against a graph whose expected values were worked out
 * on paper.
 */

export interface ModuleSpec {
  /** File name -> statement count. Files are placed under `<name>/`. */
  files?: Record<string, number>;
  kind?: "nest" | "synthetic";
  global?: boolean;
  dir?: string;
  /** Declared `@Module({ imports })` targets. */
  imports?: string[];
  exportedModules?: string[];
  classes?: ClassInfo[];
  abstractions?: number;
  concretions?: number;
}

export interface GraphSpec {
  modules: Record<string, ModuleSpec>;
  /** `"a/x.ts -> b/y.ts"` dependency edges. */
  deps?: string[];
  typeOnly?: string[];
  config?: UserConfig;
}

export interface BuiltFixture {
  graph: ModuleGraph;
  files: Map<string, FileNode>;
  modules: Map<string, NestModuleInfo>;
  config: ResolvedConfig;
  scope: Set<string>;
  statementsOf: (id: string) => number;
  filesOf: (id: string) => Set<string>;
  classesOf: (id: string) => ClassInfo[];
  totalStatements: number;
}

export function emptyMembers(): MemberGraph {
  return { methods: [], fields: [], edges: [] };
}

export function makeClass(name: string, members: Partial<MemberGraph>, file = "x.ts"): ClassInfo {
  return {
    name,
    file,
    line: 1,
    decorators: [],
    isInjectable: true,
    isController: false,
    isModule: false,
    isEntity: false,
    abstract: false,
    scope: "default",
    members: { methods: [], fields: [], edges: [], ...members },
    functions: [],
  };
}

export function buildFixture(spec: GraphSpec): BuiltFixture {
  const config =
    spec.config === undefined
      ? DEFAULT_CONFIG
      : resolveConfig(spec.config, "test").config;

  const files = new Map<string, FileNode>();
  const modules = new Map<string, NestModuleInfo>();
  const statements = new Map<string, number>();
  const classes = new Map<string, ClassInfo[]>();

  for (const [id, module] of Object.entries(spec.modules)) {
    const owned = Object.keys(module.files ?? { "index.ts": 1 }).map((name) => `${id}/${name}`);
    let total = 0;

    Object.entries(module.files ?? { "index.ts": 1 }).forEach(([name, count], fileIndex) => {
      const path = `${id}/${name}`;
      total += count;
      files.set(path, {
        path,
        moduleId: id,
        foreign: false,
        statements: count,
        classes: fileIndex === 0 ? (module.classes ?? []) : [],
        abstractions: fileIndex === 0 ? (module.abstractions ?? 0) : 0,
        concretions: fileIndex === 0 ? (module.concretions ?? 1) : 1,
        parseErrors: 0,
      });
    });

    statements.set(id, total);
    classes.set(id, module.classes ?? []);
    modules.set(id, {
      id,
      name: id,
      file: module.kind === "synthetic" ? null : `${id}/index.ts`,
      line: 1,
      kind: module.kind ?? "nest",
      global: module.global ?? false,
      dir: module.dir ?? id,
      imports: (module.imports ?? []).map((target) => ({
        moduleId: target,
        text: target,
        forwardRef: false,
        dynamicCall: null,
        line: 1,
      })),
      exportedModules: module.exportedModules ?? [],
      controllers: [],
      providers: [],
      exports: [],
      files: owned,
    });
  }

  const typeOnly = new Set(spec.typeOnly ?? []);
  const edges: Edge[] = (spec.deps ?? []).map((entry) => {
    const [from, to] = entry.split("->").map((part) => part.trim());
    return {
      from: from as string,
      to: to as string,
      kind: "import",
      typeOnly: typeOnly.has(entry),
      confidence: 1,
      line: 1,
    };
  });

  const moduleEdges: ModuleEdge[] = [];
  for (const module of modules.values()) {
    for (const ref of module.imports) {
      if (ref.moduleId) moduleEdges.push({ from: module.id, to: ref.moduleId, forwardRef: false, line: 1 });
    }
  }

  const graph = buildModuleGraph(files, modules, [edges], moduleEdges, config);
  const totalStatements = [...statements.values()].reduce((a, b) => a + b, 0);

  return {
    graph,
    files,
    modules,
    config,
    scope: new Set(modules.keys()),
    statementsOf: (id) => statements.get(id) ?? 0,
    filesOf: (id) => new Set(modules.get(id)?.files ?? []),
    classesOf: (id) => classes.get(id) ?? [],
    totalStatements,
  };
}
