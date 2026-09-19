/**
 * Public, versioned type contract for `nestjs-maintainability`.
 *
 * The JSON reporter emits exactly this shape. It is treated as public API under
 * semver: `schemaVersion` changes major when a field is removed or its meaning
 * changes, minor when a field is added.
 */

/** Bumped independently of the package version. See README "JSON schema". */
export const SCHEMA_VERSION = "4.1.0";

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

/**
 * How a dependency edge was discovered. Only `import` and `di` are *resolved*
 * facts; everything below `di` is inferred and carries a confidence < 1.
 */
export type EdgeKind =
  | "import" // ES import / export-from / dynamic import() / require()
  | "di" // constructor param, @Inject, property injection, useFactory inject
  | "module-import" // declared in an @Module({ imports: [...] })
  | "event" // EventEmitter2 emit <-> @OnEvent, matched on the event name
  | "entity" // TypeORM relation decorator across a module boundary
  | "cqrs" // @nestjs/cqrs command/query/event <-> handler pairing
  | "http"; // injected HttpService call with a statically known URL

export interface Edge {
  /** Source file, project-relative POSIX path. */
  readonly from: string;
  /** Target file, project-relative POSIX path. */
  readonly to: string;
  readonly kind: EdgeKind;
  /** True when the dependency is erased at compile time (`import type`, type positions). */
  readonly typeOnly: boolean;
  /** 1 = resolved from syntax. < 1 = inferred heuristically. */
  readonly confidence: number;
  /** 1-based line in `from`. */
  readonly line: number;
  /** Raw module specifier or token text, for traceability. */
  readonly detail?: string;
}

export interface FunctionInfo {
  readonly name: string;
  readonly line: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  /** Statement count of the function body. */
  readonly statements: number;
}

/** Method/field graph of a class, used to compute LCOM4 as a pure function. */
export interface MemberGraph {
  readonly methods: readonly string[];
  readonly fields: readonly string[];
  /** Undirected edges `[member, member]`, method->field or method->method. */
  readonly edges: readonly (readonly [string, string])[];
}

export type ProviderScope = "default" | "request" | "transient";

export interface ClassInfo {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  /** Decorator names present on the class, e.g. `Injectable`, `Controller`. */
  readonly decorators: readonly string[];
  readonly isInjectable: boolean;
  readonly isController: boolean;
  readonly isModule: boolean;
  readonly isEntity: boolean;
  readonly abstract: boolean;
  readonly scope: ProviderScope;
  readonly members: MemberGraph;
  readonly functions: readonly FunctionInfo[];
}

export interface FileNode {
  /** Project-relative POSIX path. Primary key. */
  readonly path: string;
  /** Owning module id, always set after ownership resolution. */
  moduleId: string;
  /** True when the file sits outside its owning module's directory tree. */
  foreign: boolean;
  readonly statements: number;
  readonly classes: readonly ClassInfo[];
  /** Interfaces, type aliases and abstract classes: the abstract surface. */
  readonly abstractions: number;
  /** Concrete (non-abstract) classes. */
  readonly concretions: number;
  /** Count of syntactic parse errors; > 0 means the file was analysed partially. */
  readonly parseErrors: number;
}

/** A `{ provide: X, useClass: Y }`-style entry, or a plain class provider. */
export interface ProviderInfo {
  readonly id: string;
  /** Injection token text: class name, string literal, or symbol identifier. */
  readonly token: string;
  readonly kind: "class" | "useClass" | "useValue" | "useFactory" | "useExisting";
  /** Declaring file of the implementation, when resolvable. */
  readonly implementationFile: string | null;
  readonly implementationClass: string | null;
  /** Tokens listed in a `useFactory` `inject` array. */
  readonly inject: readonly string[];
  readonly moduleId: string;
  readonly exported: boolean;
  readonly file: string;
  readonly line: number;
  readonly scope: ProviderScope;
  /** False when the token could not be tied to an implementation file. */
  readonly resolved: boolean;
}

export type UnresolvedReason =
  | "dynamic-expression"
  | "spread"
  | "external-package"
  | "unresolved-specifier"
  | "string-token"
  | "computed";

export interface ModuleImportRef {
  /** Target module id, or null when unresolved. */
  readonly moduleId: string | null;
  readonly text: string;
  readonly forwardRef: boolean;
  /** `forRoot` / `registerAsync` / etc., when the entry is a dynamic module. */
  readonly dynamicCall: string | null;
  readonly line: number;
  readonly unresolvedReason?: UnresolvedReason;
}

export interface NestModuleInfo {
  /** Stable id: `<relative file>#<ClassName>` for real modules, `synthetic:<dir>` otherwise. */
  readonly id: string;
  readonly name: string;
  /** Null for synthetic pseudo-modules. */
  readonly file: string | null;
  readonly line: number;
  readonly kind: "nest" | "synthetic";
  readonly global: boolean;
  /** Directory the module owns, project-relative POSIX. */
  readonly dir: string;
  readonly imports: readonly ModuleImportRef[];
  /** Module ids re-exported through `exports: [...]`. */
  readonly exportedModules: readonly string[];
  readonly controllers: readonly string[];
  readonly providers: readonly string[];
  readonly exports: readonly string[];
  /** Files owned by this module, sorted. */
  files: string[];
}

export interface ProjectGraph {
  readonly root: string;
  readonly files: ReadonlyMap<string, FileNode>;
  readonly modules: ReadonlyMap<string, NestModuleInfo>;
  readonly providers: readonly ProviderInfo[];
  /** File-level import edges (a). */
  readonly importEdges: readonly Edge[];
  /** Declared `@Module({ imports })` edges (b), module id -> module id. */
  readonly moduleEdges: readonly ModuleEdge[];
  /** DI edges (c), file -> file. */
  readonly diEdges: readonly Edge[];
  /** Lower-confidence inferred edges (events, entities, cqrs, http). */
  readonly inferredEdges: readonly Edge[];
  readonly entrypoints: readonly Entrypoint[];
  readonly warnings: readonly Warning[];
}

export interface ModuleEdge {
  readonly from: string;
  readonly to: string;
  readonly forwardRef: boolean;
  readonly line: number;
}

export interface Entrypoint {
  readonly file: string;
  readonly rootModuleId: string | null;
  readonly rootModuleName: string;
  readonly line: number;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export type WarningCode =
  | "unresolved-module-import"
  | "unresolved-provider"
  | "unresolved-specifier"
  | "dynamic-module"
  | "spread-element"
  | "ambiguous-ownership"
  | "no-root-module"
  | "parse-errors"
  | "foreign-provider"
  | "string-token"
  | "config";

export interface Warning {
  readonly code: WarningCode;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface CouplingMetrics {
  /** Distinct other modules depending on this one (afferent / incoming). */
  readonly Ca: number;
  /** Distinct other modules this one depends on (efferent / outgoing). */
  readonly Ce: number;
  /** Distinct *files* in other modules depending on this one. */
  readonly CaFiles: number;
  /** Distinct *files* in this module depending on other modules. */
  readonly CeFiles: number;
  readonly afferentModules: readonly string[];
  readonly efferentModules: readonly string[];
  /** Martin's instability, `Ce / (Ca + Ce)`. 0 = maximally stable. */
  readonly instability: number;
  /** Normalised coupling level `c_i` in [0,1]. Feeds rawCouplingSum. */
  readonly ci: number;
  /** `alpha` used for this run, echoed so `ci` can be recomputed by hand. */
  readonly afferentWeight: number;
  /** Module count used as the `k - 1` denominator. */
  readonly k: number;
  /** Martin's abstractness, `abstractions / (abstractions + concretions)`. */
  readonly abstractness: number;
  /** Distance from the main sequence, `|A + I - 1| / sqrt(2)`. 0 is on the line. */
  readonly distanceFromMainSequence: number;
}

export interface BlastRadius {
  /** Modules that transitively depend on this one (excluding itself). */
  readonly modules: readonly string[];
  readonly moduleCount: number;
  /** `moduleCount / (k - 1)` as a 0-1 ratio. */
  readonly ratio: number;
  /** Statements in the transitive dependent set. */
  readonly statements: number;
  readonly statementRatio: number;
}

/**
 * Why a class was left out of the module's LCOM4 aggregate:
 * - `minMethods` - too little behaviour to be incoherent (a DTO).
 * - `decorator` / `class` / `file` - matched `lcom4.excludeDecorators`,
 *   `lcom4.excludeClasses` or `lcom4.excludeFiles`.
 */
export type Lcom4Exclusion = "minMethods" | "decorator" | "class" | "file";

export interface Lcom4ClassResult {
  readonly class: string;
  readonly file: string;
  readonly line: number;
  readonly lcom4: number;
  readonly methodCount: number;
  readonly fieldCount: number;
  /** Member names per connected component, sorted. Shows *how* the class splits. */
  readonly components: readonly (readonly string[])[];
  /** False when the class was excluded from the module aggregate. */
  readonly counted: boolean;
  /** Why it was excluded, or `null` when it counted. */
  readonly excludedBy: Lcom4Exclusion | null;
}

export interface CohesionMetrics {
  /** `internal / (internal + external)`, 1 when there are no edges at all. */
  readonly structural: number;
  readonly internalEdges: number;
  readonly externalEdges: number;
  readonly lcom4Max: number;
  readonly lcom4Mean: number;
  readonly lcom4Classes: readonly Lcom4ClassResult[];
}

export interface ComplexityStats {
  readonly mean: number;
  readonly p90: number;
  readonly max: number;
  readonly total: number;
}

export interface ComplexityMetrics {
  readonly functionCount: number;
  readonly cyclomatic: ComplexityStats;
  readonly cognitive: ComplexityStats;
  /** Functions with cyclomatic complexity above `thresholds.functionComplexity`. */
  readonly aboveThreshold: readonly FunctionRef[];
}

export interface FunctionRef {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
}

export interface SizeMetrics {
  readonly statements: number;
  readonly files: number;
  readonly meanStatementsPerFile: number;
  readonly largestFile: { readonly path: string; readonly statements: number } | null;
}

export type Partitioning = "technical" | "domain" | "mixed";

export interface ModulePartitioningMetrics {
  /** 1 = every cross-module dependency lands on a domain peer. */
  readonly domainAlignment: number;
  readonly technicalEdges: number;
  readonly domainEdges: number;
  readonly classification: "technical" | "domain";
  /** Heuristic. Always < 1. */
  readonly confidence: number;
}

export interface AppPartitioning {
  readonly verdict: Partitioning;
  readonly confidence: number;
  readonly technicalRatio: number;
  readonly topLevelDirs: readonly {
    readonly name: string;
    readonly classification: "technical" | "domain";
  }[];
  readonly note: string;
}

export interface Penalties {
  readonly coupling: number;
  readonly cohesion: number;
  readonly complexity: number;
  readonly size: number;
  readonly partitioning: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface ModuleReport {
  readonly id: string;
  readonly name: string;
  readonly file: string | null;
  readonly kind: "nest" | "synthetic";
  readonly global: boolean;
  readonly dir: string;
  readonly files: readonly string[];
  readonly coupling: CouplingMetrics;
  readonly blastRadius: BlastRadius;
  readonly cohesion: CohesionMetrics;
  readonly complexity: ComplexityMetrics;
  readonly size: SizeMetrics;
  readonly partitioning: ModulePartitioningMetrics;
  readonly penalties: Penalties;
  /** Weights applied, echoed so `maintainabilityLevel` can be recomputed by hand. */
  readonly weights: Penalties;
  readonly maintainabilityLevel: number;
  readonly grade: Grade;
}

export interface ScopeReport {
  readonly name: string;
  readonly entrypoint: string | null;
  readonly rootModule: string | null;
  /** Module ids in this scope, sorted. */
  readonly moduleIds: readonly string[];
  /** `k` — module count including synthetic pseudo-modules. */
  readonly k: number;
  readonly totalStatements: number;
  readonly totalFiles: number;
  /**
   * Application coupling, in the same unit and direction as the per-module
   * `c_i`: the mean of `c_i` over the scope's modules. 0-1, lower = better.
   * This is the one coupling figure the reporters show.
   */
  readonly meanCoupling: number;
  /**
   * The literal `Σ c_i`, as the book prints it. No cap, higher = worse.
   * A rescaling of `meanCoupling` (`meanCoupling * k`), kept for book fidelity.
   */
  readonly rawCouplingSum: number;
  /**
   * `100 * (1 - (1/k) * Σ c_i)`. 0-100, higher = better. Coupling only.
   * A rescaling of `meanCoupling` (`100 * (1 - meanCoupling)`), kept for
   * backwards compatibility; it carries no information `meanCoupling` lacks.
   */
  readonly couplingIndex: number;
  /** Headline: size-weighted mean of per-module ML. 0-100, higher = better. */
  readonly maintainabilityLevel: number;
  readonly grade: Grade;
  readonly partitioning: AppPartitioning;
}

export interface BoundaryViolation {
  readonly from: string;
  readonly to: string;
  readonly fromModule: string;
  readonly toModule: string;
  readonly kind: EdgeKind;
  readonly typeOnly: boolean;
  readonly line: number;
  readonly detail?: string;
  readonly confidence: number;
  /** Stable identity used by baseline diffing. */
  readonly id: string;
}

export interface FileCycle {
  readonly files: readonly string[];
  readonly length: number;
  readonly id: string;
}

export interface RefactorCandidate {
  readonly moduleId: string;
  readonly name: string;
  /** `couplingFactor * sizeFactor`, both normalised to [0,1]. */
  readonly score: number;
  readonly couplingFactor: number;
  readonly sizeFactor: number;
  readonly maintainabilityLevel: number;
  readonly reason: string;
}

/**
 * A module matched by `excludeModules` and left out of every figure in the
 * report. Listed so a score can never be quietly smaller than the codebase:
 * the report always says what it chose not to look at.
 */
export interface ExcludedModule {
  readonly id: string;
  readonly name: string;
  readonly file: string | null;
  readonly kind: "nest" | "synthetic";
  /** The `excludeModules` pattern that matched. */
  readonly pattern: string;
  /** Files that left the analysis with it. */
  readonly files: number;
  readonly statements: number;
}

export interface FileReport {
  readonly path: string;
  readonly moduleId: string;
  readonly foreign: boolean;
  readonly statements: number;
  readonly classes: readonly string[];
  readonly imports: number;
  readonly importedBy: number;
  readonly crossModuleImports: number;
  readonly cyclomaticMax: number;
  readonly cognitiveMax: number;
  readonly parseErrors: number;
}

export interface Report {
  readonly schemaVersion: string;
  readonly tool: { readonly name: string; readonly version: string };
  readonly project: {
    readonly root: string;
    readonly tsconfig: string;
    readonly sourceRoot: string;
    readonly fileCount: number;
    readonly entrypoints: readonly Entrypoint[];
  };
  /** The fully resolved config actually used. A score is meaningless without it. */
  readonly config: ResolvedConfig;
  /** Union scope: every discovered module. */
  readonly application: ScopeReport;
  /** One per `NestFactory.create` entrypoint, plus the union when there are several. */
  readonly applications: readonly ScopeReport[];
  readonly modules: readonly ModuleReport[];
  readonly files: readonly FileReport[];
  readonly providers: readonly ProviderInfo[];
  readonly boundaryViolations: readonly BoundaryViolation[];
  readonly fileCycles: readonly FileCycle[];
  readonly refactorCandidates: readonly RefactorCandidate[];
  /** Modules dropped by `excludeModules`, and what each cost the report. */
  readonly excludedModules: readonly ExcludedModule[];
  readonly warnings: readonly Warning[];
  readonly stats: {
    readonly importEdges: number;
    readonly diEdges: number;
    readonly inferredEdges: number;
    readonly typeOnlyEdges: number;
    readonly crossModuleEdges: number;
    readonly filesFromCache: number;
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ResolvedConfig {
  readonly tsconfig: string;
  readonly rootModule: string | null;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Globs matched against a module's name, id, declaring file or directory. */
  readonly excludeModules: readonly string[];
  readonly graph: {
    readonly includeTypeOnlyImports: boolean;
    readonly typeOnlyEdgeWeight: number;
    readonly inferEventCoupling: boolean;
    readonly inferEntityRelations: boolean;
    readonly inferCqrs: boolean;
    readonly inferHttp: boolean;
    readonly includeDynamicImports: boolean;
  };
  readonly coupling: { readonly afferentWeight: number };
  readonly weights: {
    readonly coupling: number;
    readonly cohesion: number;
    readonly complexity: number;
    readonly size: number;
    readonly partitioning: number;
  };
  readonly thresholds: {
    readonly freeComplexity: number;
    readonly complexitySpan: number;
    readonly freeSize: number;
    readonly sizeSpan: number;
    readonly functionComplexity: number;
  };
  readonly grades: {
    readonly A: number;
    readonly B: number;
    readonly C: number;
    readonly D: number;
  };
  readonly lcom4: {
    readonly excludeConstructor: boolean;
    readonly minMethods: number;
    /** Class decorators whose classes are excluded from LCOM4, e.g. `Entity`. */
    readonly excludeDecorators: readonly string[];
    /** Globs matched against the class name, e.g. `*Repository`. */
    readonly excludeClasses: readonly string[];
    /** Globs matched against the project-relative file path. */
    readonly excludeFiles: readonly string[];
  };
  readonly fail: {
    readonly appMaintainabilityBelow: number | null;
    readonly moduleMaintainabilityBelow: number | null;
    readonly newBoundaryViolations: boolean;
    readonly warningsAbove: number | null;
  };
  readonly partitioning: {
    readonly technicalNames: readonly string[];
    readonly technicalVerdictAbove: number;
    readonly domainVerdictBelow: number;
  };
  readonly boundaries: {
    /** Treat edges into synthetic pseudo-modules as violations. Off by default: a
     *  pseudo-module is not a Nest module and cannot appear in an `imports` array. */
    readonly reportSyntheticTargets: boolean;
    readonly allowGlobalModules: boolean;
    readonly ignoreTypeOnly: boolean;
  };
  readonly cache: { readonly enabled: boolean; readonly dir: string | null };
}

/** User-facing config: every field optional, deep-partial of {@link ResolvedConfig}. */
export type UserConfig = DeepPartial<ResolvedConfig>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly (infer _U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface AnalyzeOptions extends UserConfig {
  /** Project root. Defaults to `process.cwd()`. */
  readonly path?: string;
  /** Explicit config file path; skips upward discovery. */
  readonly configFile?: string | null;
  /** Skip config file discovery entirely and use defaults + these options. */
  readonly noConfigFile?: boolean;
  readonly onProgress?: (stage: string, detail?: string) => void;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface Baseline {
  readonly schemaVersion: string;
  readonly tool: string;
  readonly createdAt?: string;
  readonly application: {
    readonly maintainabilityLevel: number;
    readonly couplingIndex: number;
    readonly rawCouplingSum: number;
    readonly grade: Grade;
    readonly k: number;
  };
  readonly modules: readonly {
    readonly id: string;
    readonly name: string;
    readonly maintainabilityLevel: number;
    readonly ci: number;
    readonly Ca: number;
    readonly Ce: number;
    readonly statements: number;
  }[];
  readonly boundaryViolations: readonly string[];
  readonly warningCount: number;
}

export interface DiffEntry {
  readonly id: string;
  readonly name: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number;
  readonly regression: boolean;
}

export interface DiffResult {
  readonly application: {
    readonly before: number;
    readonly after: number;
    readonly delta: number;
    readonly regression: boolean;
  };
  readonly modules: readonly DiffEntry[];
  readonly newBoundaryViolations: readonly string[];
  readonly fixedBoundaryViolations: readonly string[];
  readonly regressed: boolean;
  readonly reasons: readonly string[];
}
