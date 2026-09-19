import type { ResolvedConfig } from "../types.js";

/**
 * Default technical-layer directory names (section 4.5). The list from the
 * brief, plus the singular form of each, because both spellings occur in the
 * wild (`src/service/` and `src/services/`).
 *
 * Keep this list conservative. Every name added here makes it more likely that
 * a genuine domain folder is misread as a technical layer, which pushes
 * `domainAlignment` down for reasons the user cannot see.
 */
export const DEFAULT_TECHNICAL_NAMES: readonly string[] = [
  "common",
  "config",
  "constants",
  "controller",
  "controllers",
  "decorator",
  "decorators",
  "dto",
  "dtos",
  "entities",
  "entity",
  "filter",
  "filters",
  "guard",
  "guards",
  "helper",
  "helpers",
  "interceptor",
  "interceptors",
  "interface",
  "interfaces",
  "middleware",
  "middlewares",
  "model",
  "models",
  "pipe",
  "pipes",
  "provider",
  "providers",
  "repositories",
  "repository",
  "service",
  "services",
  "shared",
  "type",
  "types",
  "util",
  "utils",
];

/**
 * Class decorators that mark a data holder rather than behaviour: TypeORM
 * entities and views, Mongoose schemas, GraphQL object types. LCOM4 over a
 * bag of columns counts columns, not responsibilities.
 */
export const DEFAULT_LCOM4_EXCLUDE_DECORATORS: readonly string[] = [
  "ChildEntity",
  "Entity",
  "EntityRepository",
  "InputType",
  "ObjectType",
  "Schema",
  "ViewEntity",
];

/**
 * Class-name patterns excluded from LCOM4. A repository is a fan of unrelated
 * finders over one table by design: every method touches the same one or two
 * fields or none at all, so its LCOM4 measures the number of queries it
 * offers, not whether it does too many things.
 */
export const DEFAULT_LCOM4_EXCLUDE_CLASSES: readonly string[] = [
  "*Entity",
  "*Repository",
];

/** File patterns excluded from LCOM4: the same two shapes, by convention. */
export const DEFAULT_LCOM4_EXCLUDE_FILES: readonly string[] = [
  "**/*.entity.ts",
  "**/*.repository.ts",
  "**/entities/**",
  "**/repositories/**",
];

export const DEFAULT_EXCLUDE: readonly string[] = [
  "**/*.spec.ts",
  "**/*.test.ts",
  "**/*.e2e-spec.ts",
  "**/*.d.ts",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/migrations/**",
  "**/migration/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/coverage/**",
];

/**
 * Every constant the tool uses, in one place. Each is overridable from the
 * config file; the resolved values are echoed into `report.config` so any
 * headline number can be recomputed by hand from the JSON alone.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
  tsconfig: "tsconfig.json",
  rootModule: null,
  include: ["src/**/*.ts"],
  exclude: DEFAULT_EXCLUDE,

  // Empty by default: dropping a module changes every other module's `c_i`
  // (it changes `k`), so it is never something to do on the tool's initiative.
  excludeModules: [],

  graph: {
    // Type-only imports are erased by tsc but are real architectural coupling.
    // In a Nest app (DTOs, entities, interfaces) they are frequently the
    // majority of cross-module edges, so they are on by default.
    includeTypeOnlyImports: true,
    typeOnlyEdgeWeight: 1.0,
    inferEventCoupling: false,
    inferEntityRelations: true,
    inferCqrs: false,
    inferHttp: false,
    includeDynamicImports: true,
  },

  // Incoming coupling is emphasised: what depends on you constrains you
  // far more than what you depend on.
  coupling: { afferentWeight: 0.7 },

  weights: {
    coupling: 0.35,
    cohesion: 0.25,
    complexity: 0.2,
    size: 0.1,
    partitioning: 0.1,
  },

  thresholds: {
    // Below `free*` a metric costs nothing. A linear penalty from zero punishes
    // a module for merely existing and makes scores useless for comparison.
    freeComplexity: 8,
    complexitySpan: 22,
    freeSize: 800,
    sizeSpan: 3200,
    functionComplexity: 10,
  },

  grades: { A: 85, B: 70, C: 55, D: 40 },

  lcom4: {
    // A Nest constructor takes every collaborator as a parameter property, so
    // counting it as a member would connect all fields and force LCOM4 to 1.
    excludeConstructor: true,
    minMethods: 2,
    // Entities and repositories are excluded by default: neither is the kind of
    // class LCOM4 has anything to say about. See the constants above.
    excludeDecorators: DEFAULT_LCOM4_EXCLUDE_DECORATORS,
    excludeClasses: DEFAULT_LCOM4_EXCLUDE_CLASSES,
    excludeFiles: DEFAULT_LCOM4_EXCLUDE_FILES,
  },

  fail: {
    appMaintainabilityBelow: null,
    moduleMaintainabilityBelow: null,
    newBoundaryViolations: true,
    warningsAbove: null,
  },

  partitioning: {
    technicalNames: DEFAULT_TECHNICAL_NAMES,
    technicalVerdictAbove: 0.6,
    domainVerdictBelow: 0.25,
  },

  boundaries: {
    reportSyntheticTargets: false,
    allowGlobalModules: true,
    ignoreTypeOnly: false,
  },

  cache: { enabled: true, dir: null },
};
