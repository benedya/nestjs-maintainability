# The metrics

Every number this tool reports, one document per metric. Each one opens with the same six-row
table, so the whole metric is answered before you read any prose:

| Row | Answers |
|---|---|
| **The idea** | What the metric is about. |
| **Where it comes from** | The literature it is taken from. |
| **Computed here** | How *this project* calculates it, and over what. |
| **Impact on `ML`** | Whether it feeds the headline score, and with what weight. |
| **Bands** | The traffic-light ranges the terminal paints. |
| **Source** | The function in `src/` that produces it. |

The rest of each document follows the same order too: the detail and how to read the value, then
**How it feeds the score**, then **Configuration**, and **Blind spots** where the metric has ones
of its own.

The conceptual basis is **_Software Architecture: The Hard Parts_** (Ford, Richards, Sadalage &
Dehghani, O'Reilly 2021), Chapter 3, "Modularity Drivers". The metrics the book lists for
maintainability map onto these documents:

| Book metric | Implemented as | Document |
|---|---|---|
| Component coupling | `Ca`, `Ce`, `cᵢ`, instability, blast radius | [coupling](coupling.md) · [blast-radius](blast-radius.md) |
| Component cohesion | Structural cohesion, plus LCOM4 per class | [cohesion](cohesion.md) · [lcom4](lcom4.md) |
| Cyclomatic complexity | Cyclomatic **and** cognitive complexity per function | [complexity](complexity.md) |
| Component size | Statements, not lines | [size](size.md) |
| Technical vs domain partitioning | A named heuristic, with an explicit confidence | [partitioning](partitioning.md) |

These are combined into one headline score, which has its own document:

**→ [Maintainability level — how `ML` is calculated](maintainability-level.md)**

Further numbers are measured and reported but deliberately **not** scored — each is a
diagnostic that names something specific to go and fix, or a figure with no bad end, rather than a
judgement folded into a weighted sum:

| Measurement | What it is for | Document |
|---|---|---|
| Blast radius | What lands in the change scope if this module changes | [blast-radius](blast-radius.md) |
| LCOM4 | Which class is secretly several classes | [lcom4](lcom4.md) |
| Instability (`I`) | How volatile this module is, `Ce/(Ca+Ce)` — no end of the range is "good" | [coupling](coupling.md#i--instability) |

All of them are computed over the dependency graph described in
[how the code is read](../how-the-code-is-read.md).

---

## Column reference

Every column of the `analyze` table — its meaning, its traffic-light band and whether it feeds the
score — is in [README § the metrics](../../README.md#2-the-metrics).

---

## Two different notions of "good" and "bad"

They are easy to conflate, and they are not the same thing:

- **The score penalties** — how a metric feeds the headline `ML`. Defined once in
  [`computePenalties`](../../src/scoring/penalties.ts#L15) and documented in
  [maintainability-level](maintainability-level.md).
- **The traffic-light colours** — the green/amber/red the terminal paints on each cell, and the
  ranges printed in the legend under the table. These are a *reading aid only*; they do not affect
  any score. They are defined per column in `COLUMNS` and described by `renderLegend`, both in
  [`src/reporters/table.ts`](../../src/reporters/table.ts). Colour is suppressed for non-TTY
  output (pipes, CI) and by `--no-color` / `NO_COLOR`.

Where a metric is inherently role- or size-dependent — `Ca`, `Ce`, `I` — it is deliberately **left
uncoloured**. Painting it would imply a judgement the number cannot support.

> The colour thresholds for `c_i`, `Coh`, `LCOM4` and `Blast` are constants in the table reporter;
> `CogP90` and `Stmts`'s score-side cutoffs derive from
> [`thresholds`](../../src/config/defaults.ts#L143). If you re-tune the config, the `CogP90` band
> follows automatically; the four constants are edited in
> [`src/reporters/table.ts`](../../src/reporters/table.ts).

---

## See also

- [A worked example](../worked-example.md) — four files, two modules, every number computed by hand.
- [How the code is read](../how-the-code-is-read.md) — the graph and file
  ownership that everything here is computed over.
- [README § configuration](../../README.md#4-configuration) — every default constant in one
  annotated config file, with the reasoning for each.
- [Known blind spots](../blind-spots.md) — what none of these metrics can see.
