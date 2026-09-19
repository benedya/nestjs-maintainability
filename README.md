# nestjs-maintainability

Static maintainability and coupling metrics for NestJS codebases — per module, per file, and application-wide.

> [!WARNING]
> This project was built out of curiosity — a way to play with these metrics and see what they
> say about a real codebase. The numbers it reports may be inaccurate. Use it with care, and
> don't treat its output as authoritative.

```bash
npx nestjs-maintainability analyze
```

![nestjs-maintainability analyze output](https://raw.githubusercontent.com/benedya/nestjs-maintainability/main/doc/analyze-output.png)

<details><summary>Text version</summary>

```
  nestjs-maintainability v0.1.0

  Maintainability   53.7 (D)    size-weighted mean of module ML
  Coupling          0.33        mean c_i across 6 modules; lower is better
  Modules (k)       6           17 files, 182 statements
  Partitioning      technical   confidence 0.95 (heuristic)

  Module         ML  Grade   c_i  Ca  Ce     I   Coh  LCOM4  CogP90      Stmts  Blast
  -----------------------------------------------------------------------------------
  services/      53  D      0.46   2   3  0.60  0.17      2       4  56% (102)    40%
  repositories/  53  D      0.34   2   1  0.33  0.00      1       3   25% (45)    60%
  controllers/   54  D      0.32   1   3  0.75  0.00      1       0   13% (24)    20%
  entities/      60  C      0.42   3   0  0.00  0.00      1       0     2% (3)    80%
  AppModule      61  C      0.18   0   3  1.00  0.10      1       0     3% (5)     0%
  dtos/          65  C      0.28   2   0  0.00  0.00      1       0     2% (3)    60%
```

</details>

No runtime instrumentation, no `@nestjs/*` dependency, no booting your app. It reads
the source, resolves `@Module()` metadata and the DI graph, and reports numbers you can
check by hand.

It reports at three levels: **per Nest module**, **whole application**, and **per file / per
provider**, so any number can be traced back to a location.

---

## Contents

1. [Install and use](#1-install-and-use)
2. [The metrics](#2-the-metrics)
3. [How to read these numbers](#3-how-to-read-these-numbers)
4. [Configuration](#4-configuration)
5. [CLI](#5-cli)
6. [Output formats](#6-output-formats)

Fuller documentation lives in [`doc/`](doc/README.md): [how the code is read](doc/how-the-code-is-read.md),
a fully hand-computed [worked example](doc/worked-example.md), one document
[per metric](doc/metrics/README.md), and [known blind spots](doc/blind-spots.md).

---

## 1. Install and use

```bash
npm install --save-dev nestjs-maintainability
```

Requires **Node ≥ 20**. Ships ESM and CJS builds with TypeScript types.

Installing puts the `nestjs-maintainability` binary on your project's
`node_modules/.bin`. The examples below assume you have installed the package as above;
`npx nestjs-maintainability` also works without installing anything.

```bash
# analyse the current project
npx nestjs-maintainability analyze

# drill into one module
npx nestjs-maintainability analyze --module OrdersModule

# what breaks if I change this?
npx nestjs-maintainability analyze --what-if OrdersModule

# lock in today's scores, then gate every PR against them
npx nestjs-maintainability baseline write
npx nestjs-maintainability diff
```

---

## 2. The metrics

Every metric is measured per module. Some are combined into the headline score; the rest are
reported as diagnostics, without feeding it. **Each one has its own document**, so a metric's
definition, formula, thresholds, config knobs and source location are in a single place.

This is also the column reference for the `analyze` table: every column, what it means, its
traffic-light band, and whether it feeds the score.

| Column | Metric | What it answers | Colour bands | Feeds `ML`? | Document |
|---|---|---|---|---|---|
| `ML` | **Maintainability level** | The headline score the scored metrics combine into, 0–100 | 🟢 ≥ 70 · 🟡 55–69 · 🔴 < 55 | it *is* the score | [maintainability-level](doc/metrics/maintainability-level.md) |
| `Grade` | **Maintainability level** | Letter grade for `ML` | 🟢 A/B · 🟡 C · 🔴 D/F | — | [letter grades](doc/metrics/maintainability-level.md#letter-grades) |
| `c_i` | **Coupling** | How much of the rest of the app is this module entangled with? (normalised 0–1) | 🟢 < 0.30 · 🟡 0.30–0.60 · 🔴 > 0.60 | yes, weight 0.35 | [coupling](doc/metrics/coupling.md#cᵢ--coupling-level) |
| `Ca` | **Coupling** | How many modules depend on this one? (afferent) | not graded — role-dependent | via `c_i` | [coupling](doc/metrics/coupling.md#ca--afferent-coupling) |
| `Ce` | **Coupling** | How many modules does this one depend on? (efferent) | not graded — role-dependent | via `c_i` | [coupling](doc/metrics/coupling.md#ce--efferent-coupling) |
| `I` | **Coupling** | Instability, `Ce/(Ca+Ce)` | not graded — no bad end | no | [coupling](doc/metrics/coupling.md#i--instability) |
| `Coh` | **Cohesion** | Do this module's dependencies stay inside it? (0–1) | 🟢 ≥ 0.70 · 🟡 0.40–0.69 · 🔴 < 0.40 | yes, weight 0.25 | [cohesion](doc/metrics/cohesion.md) |
| `LCOM4` | **LCOM4** | Is this module's worst class secretly several classes? | 🟢 1 · 🟡 2 · 🔴 ≥ 3 | no — diagnostic | [lcom4](doc/metrics/lcom4.md) |
| `CogP90` | **Complexity** | How hard is a typically hard function here to read? (90th pct cognitive) | 🟢 ≤ 8 · 🟡 9–18 · 🔴 ≥ 19 | yes, weight 0.20 | [complexity](doc/metrics/complexity.md) |
| `Stmts` | **Size** | How much code is this, and does one module dominate? (% of app) | 🟢 < 20% · 🟡 20–40% · 🔴 > 40% | yes, weight 0.10 | [size](doc/metrics/size.md) |
| `Blast` | **Blast radius** | If I change this, what lands in the change scope? (% of other modules) | 🟢 < 20% · 🟡 20–50% · 🔴 > 50% | no — risk indicator | [blast-radius](doc/metrics/blast-radius.md) |
| *(no column)* | **Partitioning** | Is the app split by layer or by domain? | app-level verdict above the table | yes, weight 0.10 — via per-module `domainAlignment` | [partitioning](doc/metrics/partitioning.md) |

### Two application-level figures, never substituted for one another

`maintainabilityLevel` (the headline, every scored metric, 0–100, higher is better) and
`meanCoupling` (coupling only, 0–1, lower is better). `meanCoupling` is the mean of the `cᵢ`
column, so the application figure and the per-module column share one unit, one direction and one
set of thresholds — there is never a "higher is better" number sitting next to a "lower is
better" one measuring the same thing.

The JSON additionally carries `couplingIndex` and `rawCouplingSum`, which are exact rescalings of
`meanCoupling` rather than separate measurements. Why, and why the book's printed formula is
illustrative rather than operational, is in
[coupling § the application-level figures](doc/metrics/coupling.md#the-application-level-figures).

### Reading the colours

The green/amber/red the terminal paints on each cell is a **reading aid only** — it does not feed
any score, and it is a different judgement from the score penalties. Columns that are inherently
role- or size-dependent (`Ca`, `Ce`, `I`) are deliberately left uncoloured. Colour is suppressed
for non-TTY output and by `--no-color` / `NO_COLOR`. The bands are listed in the table above.

---

## 3. How to read these numbers

**The absolute score is weakly meaningful.** 68 is not a fact about your codebase. It is the
output of a weighted sum whose weights are a judgement call, over metrics that each approximate
something real. Treating it as a grade on your team's work would be a misuse of it.

**Cross-project comparison is meaningless.** `cᵢ` is normalised against `k − 1`, so the same
application split into four modules and eight modules scores differently. Statement counts depend
on style. `domainAlignment` depends on folder naming. Two projects' numbers are not on the same
scale, and a leaderboard of them would be actively harmful.

**The trend within one project is where all the value is.** Commit a baseline. Run `diff` in CI.
The interesting output is not "you are at 62", it is "this PR took you from 62 to 59, and here is
the import that did it". A score that only moves one way is worth having; a score you stare at
once is not.

**The lists are more useful than the numbers.** Boundary violations, blast radius, and the
LCOM4 component split of your worst class each name a specific thing to go
and fix. The composite score is a summary of those; the summary is not the deliverable.

**Read the warnings.** `report.warnings[]` is where the tool tells you what it could not see.
A score computed over a graph with twelve unresolved dynamic modules is a score over a fiction.

---

## 4. Configuration

`nestjs-maintainability.config.{ts,js,mjs,cjs,json}`, discovered upward from the working directory.
Validated with a full schema: an unknown key is an error naming the key, not a silent no-op.

**The block below is the full set of defaults**, with the comments saying why each was chosen.
Every key is optional; you only write the ones you are changing. Each constant is also documented
next to the metric it shapes — see the *Configuration* section of the relevant document under
[`doc/metrics/`](doc/metrics/README.md).

```ts
// nestjs-maintainability.config.ts
export default {
  tsconfig: "tsconfig.json",
  rootModule: null,                      // auto-detected from NestFactory.create()
  include: ["src/**/*.ts"],

  // Files, dropped before parsing. Setting this replaces the default list wholesale, rather
  // than adding to it, so keep the entries you still want.
  exclude: [
    "**/*.spec.ts", "**/*.test.ts", "**/*.e2e-spec.ts", "**/*.d.ts",
    "**/test/**", "**/tests/**", "**/__tests__/**", "**/__mocks__/**",
    "**/migrations/**", "**/migration/**",
    "**/dist/**", "**/node_modules/**", "**/coverage/**",
  ],

  // Whole modules, dropped after discovery. Empty by default - see "Excluding whole modules"
  // below, because dropping one changes every other module's score.
  excludeModules: [],

  graph: {
    includeTypeOnlyImports: true,        // erased by the compiler but real architectural
                                          // coupling - often the majority of it in a Nest app
    typeOnlyEdgeWeight: 1.0,             // full weight by default; lower it if you consider
                                          // type-only dependencies cheap
    // Inferred edges carry a confidence below 1 and are weighted by it. Only the unambiguous
    // one is on by default; the rest are opt-in because they match on names, not references.
    inferEntityRelations: true,          // TypeORM @ManyToOne/@OneToMany       confidence 0.8
    inferCqrs: false,                    // @nestjs/cqrs handler pairing        0.6, --infer-cqrs
    inferEventCoupling: false,           // EventEmitter2 emit <-> @OnEvent     0.5, --infer-events
    inferHttp: false,                    // HttpService call -> known route     0.4, --infer-http
    includeDynamicImports: true,
  },

  coupling: {
    afferentWeight: 0.7,                 // incoming coupling is emphasised: what you depend on
                                          // you can change, what depends on you, you cannot
  },

  weights: {                             // must sum to 1 (rescaled with a warning otherwise);
                                          // coupling + cohesion carry 60% of the score
    coupling: 0.35,                      // the primary metric
    cohesion: 0.25,                      // the other primary metric
    complexity: 0.20,                    // real, but local - fixable without moving anything
    size: 0.10,                          // mostly a proxy for the others; weighted low so it
                                          // does not double-count
    partitioning: 0.10,                  // weighted low precisely because it is the heuristic one
  },

  thresholds: {
    freeComplexity: 8,                   // a couple of branches - normal code should cost nothing
    complexitySpan: 22,                  // full penalty at a cognitive p90 of 30, code most
                                          // reviewers would refuse
    freeSize: 800,                       // roughly 15-25 files of ordinary Nest code
    sizeSpan: 3200,                      // full penalty at 4,000 statements - a module nobody
                                          // holds in their head
    functionComplexity: 10,              // conventional cyclomatic threshold, used only for the
                                          // "functions above threshold" list and SARIF
  },

  grades: { A: 85, B: 70, C: 55, D: 40 }, // deliberately generous at the top - a well-factored
                                           // Nest app should be able to reach an A

  lcom4: {
    excludeConstructor: true,            // a Nest constructor connects every injected field;
                                          // including it pins LCOM4 to 1 for every provider
    minMethods: 2,                       // a class with one method or none cannot be incoherent
                                          // in any interesting way
    // An entity is a bag of columns and a repository is a fan of independent queries; LCOM4 over
    // either counts columns or queries, not responsibilities. Lists replace the defaults
    // wholesale; [] opts back in.
    excludeDecorators: ["ChildEntity", "Entity", "EntityRepository", "InputType",
                        "ObjectType", "Schema", "ViewEntity"],
    excludeClasses: ["*Entity", "*Repository"],
    excludeFiles: ["**/*.entity.ts", "**/*.repository.ts",
                   "**/entities/**", "**/repositories/**"],
  },

  fail: {                                // CI gates; null to never fail on that check
    appMaintainabilityBelow: null,
    moduleMaintainabilityBelow: null,
    newBoundaryViolations: true,         // an undeclared cross-module dependency is a decision
                                          // someone should have made deliberately
    warningsAbove: null,
  },

  partitioning: {
    // 38 names - the five shown plus common, config, guards, pipes, utils and friends, most in
    // both singular and plural. The only abridged entry here; in full in src/config/defaults.ts.
    technicalNames: ["controllers", "services", "repositories", "dtos", "entities", /* … */],
    technicalVerdictAbove: 0.6,          // a clear majority of technical folder names before
                                          // calling an app technically partitioned
    domainVerdictBelow: 0.25,            // most real apps have one or two shared folders; that
                                          // is not technical partitioning
  },

  boundaries: {
    reportSyntheticTargets: false,       // a pseudo-module can't appear in an `imports` array,
                                          // so there is nothing to go and fix - it still counts
                                          // fully towards coupling
    allowGlobalModules: true,            // Nest makes @Global() modules visible everywhere;
                                          // reporting them would be reporting the framework
    ignoreTypeOnly: false,
  },

  cache: { enabled: true, dir: null },
};
```

If your weights do not sum to 1 they are rescaled proportionally and a warning says so, rather
than silently producing scores outside 0–100.

### Excluding whole modules

`exclude` drops **files** before parsing. `excludeModules` drops **whole modules** after
discovery, and is empty by default: removing a module changes `k`, and therefore every other
module's `cᵢ`, so it is never something the tool does on its own initiative.

The usual candidate is a composition root like `AppModule`, which imports every feature and so
shows up as afferent coupling on all of them. Each entry is a glob, matched against a module's
name, its id, its declaring file or its directory — whichever spelling you already have in front
of you:

| Pattern | Matches on |
|---|---|
| `AppModule` | the class name |
| `src/app.module.ts#AppModule` | the module id, as the report prints it |
| `**/*.seed.module.ts` | the declaring file |
| `src/common` | the directory the module owns |
| `common/` or `common` | the name of a synthetic pseudo-module, with or without its slash |

A pattern matching nothing is a warning, not a silent no-op — the whole point of the option is to
change the scores, so a typo that quietly changes nothing is the worst available outcome.

An excluded module leaves the report entirely — no `Ca`/`Ce`, no blast radius, no boundary
violations or cycles, and not counted in `fileCount` or `totalStatements`. It *is* still traversed
to work out which modules an entrypoint reaches, so excluding the root does not empty the app it
composes. Dropped modules and the pattern that matched each one appear in
`report.excludedModules` and on the table's `Excluded` line.

Two things to keep in mind: it **hides, it does not fix**; and because it shrinks `k`, every
remaining `cᵢ` is renormalised against a smaller `k − 1`, so `meanCoupling` can *rise* even though
you removed real edges. Change the list in the same commit as `nestjs-maintainability baseline write`.

---

## 5. CLI

The `nestjs-maintainability` binary is installed with the package. It is a local
binary: run it from an npm script, via `npx` inside the installed project, or install
globally to call it anywhere.

```
nestjs-maintainability analyze [path]            # default command
  -f, --format json|table|markdown|html|sarif|dot
  -o, --out <file>
  -c, --config <path>
  -m, --module <name>                            # drill into one module
      --what-if <name>                           # blast-radius simulation
      --fail-under <n>                           # exit 1 below n
      --json-summary                             # one line, for CI logs
      --verbose                                  # every violation and warning
      --tsconfig <path>  --root-module <path>
      --include <glob...>  --exclude <glob...>
      --exclude-module <pattern...>              # drop whole modules, e.g. AppModule
      --no-type-only                             # drop type-only imports from the graph
      --infer-events  --infer-cqrs  --infer-http  --no-infer-entities
      --no-cache  --no-color  -q, --quiet

nestjs-maintainability baseline write [path]     # snapshot current scores
nestjs-maintainability diff [baseline] [path]    # compare; exit 1 on regression
      --tolerance <n>                            # ignore drops smaller than n points
      --format table|json

nestjs-maintainability graph [path] --out g.dot  # Graphviz export
```

Exit codes: **0** clean, **1** a gate or the ratchet failed, **2** an error.

### The ratchet is the point

A legacy codebase will score badly on day one, and a tool that only says "you are at 42" gets
uninstalled inside a week. One that says "you were at 42, this PR takes you to 41, here is the
import that did it" gets kept.

```bash
nestjs-maintainability baseline write   # commit nestjs-maintainability.baseline.json
nestjs-maintainability diff             # in CI: fails only on regression
```

```
  Application  72.01 -> 67.59  -4.42

  Modules
    OrdersModule                      71.83 ->  62.63  -9.20
    UsersModule                       67.17 ->  62.63  -4.54

  1 new boundary violation(s)
    UsersModule -> OrdersModule  src/users/users.service.ts:5

  REGRESSION
    - application maintainability fell 4.42 points, from 72.01 to 67.59
    - 1 new boundary violation(s)
```

Scores can only move one way. The baseline is deterministic and carries no timestamp, so it
diffs cleanly in review.

---

## 6. Output formats

| Format | Use |
|---|---|
| `table` (default) | The terminal summary. App block, then modules sorted worst-first, then violations, refactor candidates and warnings. |
| `json` | The complete typed `Report`. Deterministic, versioned, public API. |
| `markdown` | PR comments and wikis. |
| `html` | A single self-contained file: force-directed module graph (node size = statements, colour = ML), an instability/abstractness scatter with the main sequence drawn on it, a sortable module table and a per-module drill-down. No network requests, no CDN. |
| `sarif` | SARIF 2.1.0, so boundary violations and over-complex functions appear as inline GitHub PR annotations. |
| `dot` | Graphviz. Solid edges are declared `@Module` imports; dashed red edges are dependencies no imports array declares. |

```bash
nestjs-maintainability analyze -f html -o maintainability.html
nestjs-maintainability graph --out modules.dot && dot -Tsvg modules.dot -o modules.svg
```

---

## Credits

> **Inspired by:** _Software Architecture: The Hard Parts_  
> **Implemented by:** AI  
> **Driven by:** [benedya](https://github.com/benedya)

## License

MIT
