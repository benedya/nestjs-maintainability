# Size — `Stmts`

[← All metrics](README.md)

**How much code is this, and does one module dominate the app?**

| | |
|---|---|
| **The idea** | Size is not a defect by itself, but it bounds how much of a module a person can hold in their head, and it amplifies every other problem — the same coupling in a 4,000-statement module costs far more than in a 200-statement one. |
| **Where it comes from** | "Component size" is one of the book's five maintainability metrics. |
| **Computed here** | **Statements, not lines** — lines punish formatting choices. The column shows `share% (count)` of the whole app. |
| **Impact on `ML`** | `p_size = clamp01((statements − 800) / 3200)`, weight **0.10** — deliberately low, so it does not double-count the metrics it correlates with. It is also the **aggregation weight** for the app-level `ML`. |
| **Bands** | 🟢 < 20% · 🟡 20–40% · 🔴 > 40% (by *share*) |
| **Source** | [`computeSize`](../../src/metrics/size.ts#L11) |

---

## What counts as a statement

**Counted:** executable statements, plus declarations that introduce a unit of behaviour — class,
enum, function, each class member that holds code, and each field with an initialiser.

**Not counted:** imports, re-exports, interfaces, type aliases, blank lines, comments.

The [worked example](../worked-example.md#statements) counts a ten-line service by hand.

---

## The column vs the penalty

The `Stmts` column and the size penalty deliberately ask two different questions, and use two
different numbers to do it.

| | Column | Score penalty |
|---|---|---|
| Shows | `share% (count)` — e.g. `56% (102)` | `clamp01((statements − 800) / 3200)` |
| Based on | Share of the whole application | The **absolute** statement count |
| Asks | "does one module dominate?" | "is this module too big to hold in your head?" |

🟢 < 20% · 🟡 20–40% · 🔴 > 40% — colour is by *share*, flagging a single module that holds a
disproportionate slice of the codebase. The percentage and its colour are applied in the reporter
([`src/reporters/table.ts`](../../src/reporters/table.ts)); the penalty is
[penalties.ts#L29](../../src/scoring/penalties.ts#L29).

A small application where every module is under `freeSize` scores zero size penalty across the
board while still colouring one module red for dominating the tree. That is intended.

---

## How it feeds the score

```
p_size = clamp01( (statements(m) − freeSize) / sizeSpan )
       = clamp01( (statements(m) − 800) / 3200 )          weight 0.10
```

See [maintainability-level](maintainability-level.md).

Size is also the **aggregation weight** for the application score: `ML` is a size-weighted mean of
per-module `ML`, so a 40-file `OrdersModule` and a 2-file `HealthModule` do not get an equal vote.

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `thresholds.freeSize` | `800` | Roughly 15–25 files of ordinary Nest code. Below this, size is not the problem. |
| `thresholds.sizeSpan` | `3200` | Full penalty at 4,000 statements — a module nobody holds in their head. |
| `weights.size` | `0.10` | Share of `ML` this metric carries. |
