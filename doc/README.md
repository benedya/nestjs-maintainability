# Documentation

Start with the [README](../README.md) — install, the column reference, configuration and the CLI.
These documents are the detail behind it.

## Before the metrics

| Document | What it covers |
|---|---|
| [How the code is read](how-the-code-is-read.md) | The three graphs, boundary-violation reconciliation, and how every file is assigned to exactly one module. Everything below is computed over this. |
| [A worked example](worked-example.md) | Four files, two modules, every number computed by hand — and a test that fails if the tool and the document ever disagree. |
| [Known blind spots](blind-spots.md) | What the tool cannot see, and why a good-looking score can still be wrong. |

## The metrics

One document each, all sharing the same shape: the idea, how it is computed here, its impact on
`ML`, its bands, and the function in `src/` that produces it. The [index](metrics/README.md) maps
them onto the book's metrics.

| Metric | Column | Feeds `ML`? |
|---|---|---|
| [Maintainability level](metrics/maintainability-level.md) | `ML`, `Grade` | it *is* the score |
| [Coupling](metrics/coupling.md) | `c_i`, `Ca`, `Ce`, `I` | yes, 0.35 |
| [Structural cohesion](metrics/cohesion.md) | `Coh` | yes, 0.25 |
| [Complexity](metrics/complexity.md) | `CogP90` | yes, 0.20 |
| [Size](metrics/size.md) | `Stmts` | yes, 0.10 |
| [Technical vs domain partitioning](metrics/partitioning.md) | — (app verdict) | yes, 0.10 |
| [Blast radius](metrics/blast-radius.md) | `Blast` | no — risk indicator |
| [LCOM4](metrics/lcom4.md) | `LCOM4` | no — diagnostic |
