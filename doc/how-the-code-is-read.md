# How the code is read

Before any metric is computed, the project is turned into a graph and every file is assigned to
exactly one module. Both steps are described here because every number in
[README §2](../README.md#2-the-metrics) is computed over them.

## The graph

Three overlaid directed graphs, each separately queryable:

**(a) File import graph.** Every `import`, `export … from`, dynamic `import()` and `require()`.
**Type-only dependencies are included by default.** An interface, DTO or entity type imported for
a signature is erased by `tsc`, but it is real architectural coupling — in a Nest app these are
frequently the *majority* of cross-module edges. Every edge is tagged `type-only` or `value`, so
you can weight or exclude them (`graph.typeOnlyEdgeWeight`, `graph.includeTypeOnlyImports`).

**(b) Nest module graph.** The `imports` arrays. This is the *declared* architecture. Resolution
handles plain class references, `forwardRef(() => X)` (unwrapped), dynamic modules (`X.forRoot()`, `X.registerAsync()`, …), and spreads of statically
determinable arrays. Anything that cannot be resolved goes into `report.warnings[]` with a file
and line — never silently dropped.

**(c) DI graph.** Constructor parameter types, `@Inject(TOKEN)`, `@InjectRepository(Entity)` and
friends, property injection, `useFactory` `inject` arrays, and `ModuleRef.get/resolve` with a
statically resolvable argument.

Then they are reconciled: an edge in (a) or (c) that crosses a module boundary that (b) never
declared is a **boundary violation**. Nest's own visibility rules are respected, so a legitimate
re-export chain (`A` imports `B`, `B` exports `C`) and every `@Global()` module are not reported.

Lower-confidence overlays, each flagged with a `confidence` below 1 and each behind a flag:

| Overlay | Confidence | Default |
|---|---|---|
| TypeORM `@ManyToOne` / `@OneToMany` across a boundary | 0.8 | on |
| `@nestjs/cqrs` handler pairing | 0.6 | off (`--infer-cqrs`) |
| `EventEmitter2` `emit` ↔ `@OnEvent` matched by event name | 0.5 | off (`--infer-events`) |
| `HttpService` call to a statically known controller route | 0.4 | off (`--infer-http`) |

## File ownership

Every file belongs to exactly one module.

1. The **deepest** `@Module()` directory containing it — which implements "unless that
   subdirectory has its own module" for free.
2. A module that names the file in `controllers`/`providers` even though the file lives
   elsewhere. Claimed, and flagged `foreign: true`, because a module reaching outside its folder
   for its own providers is itself worth reporting.
3. Everything left goes into **synthetic pseudo-modules** named after their folder (`common/`,
   `entities/`), shown with a trailing slash. These are usually the highest-`Ca` nodes in the
   graph, so they are never dropped on the tool's initiative — but they are ordinary modules to
   [`excludeModules`](../README.md#4-configuration), which matches them by folder name with or
   without the trailing slash.

**One deliberate refinement.** A module sitting *at* the source root — the usual
`src/app.module.ts` — is a composition root, not a folder owner. If it swallowed the whole tree
there would be exactly one module, every coupling number would be zero, and the report would say
nothing at all about a technically-layered application. Such a module owns only the files beside
it, and each unclaimed subfolder becomes its own pseudo-module. The same reasoning applies to
rule 2: a root module registering the entire application is the technically-partitioned pattern,
not an overreach, so it is reported as a warning rather than used to claim ownership.
