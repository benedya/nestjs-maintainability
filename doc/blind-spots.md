# Known blind spots

**Coupling that leaves the process is invisible to this tool.** A user who assumes otherwise will
draw badly wrong conclusions from a good-looking score. Specifically:

- **String-token DI that cannot be statically resolved.** `@Inject('CONFIG')` is only tied to an
  implementation if some `@Module` in the analysed project provides that exact token. If the
  provider lives in a package, or the token is computed, the dependency does not exist in the
  graph. A warning is emitted for every such token.
- **`ModuleRef` dynamic lookup.** `moduleRef.get(X)` is resolved only when `X` is a static
  reference. `moduleRef.get(someVariable)` is invisible.
- **Anything behind `useFactory` logic.** The factory's `inject` array is read; the factory *body*
  is not. A factory that picks between two implementations at runtime is one edge to the tool and
  two in reality.
- **Message brokers and queues.** Kafka, RabbitMQ, SQS, BullMQ — a producer and a consumer coupled
  through a topic name look completely independent here. `--infer-events` covers only in-process
  `EventEmitter2` with literal event names.
- **HTTP calls between modules or services.** `--infer-http` matches a statically known URL
  against a controller route prefix at confidence 0.4. Anything templated, configured or built at
  runtime is missed.
- **Runtime feature flags and conditional module registration.** A module registered only when an
  env var is set is either always present or always absent in the graph, depending on how it is
  written.
- **Type-only edges are detected syntactically.** `import type { X }` and all-inline-`type`
  specifiers are tagged type-only. A value import used only in type positions is tagged as a value
  import.
- **The partitioning metric is name matching.** A domain folder called `models` is read as a
  technical layer. Adjust `partitioning.technicalNames` for your codebase.
- **Cognitive complexity does not charge recursion**, and does not De Morgan-normalise negated
  boolean expressions before counting operator runs.
- **Cross-package coupling in a monorepo** is followed only through `tsconfig` `paths` aliases and
  relative imports. A workspace dependency resolved through `node_modules` is treated as external.

The tool never fails silently. Every one of the resolvable gaps above produces an entry in
`report.warnings[]` with a file and line, and the summary prints the count. An acknowledged gap is
better than a confidently wrong number.
