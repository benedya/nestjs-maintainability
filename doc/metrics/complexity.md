# Complexity — `CogP90`

[← All metrics](README.md)

**How hard is a typically hard function in this module to read?**

| | |
|---|---|
| **The idea** | Coupling and cohesion describe how code is arranged; complexity describes how hard a single function is to follow. Branches, loops and nesting each add a thing the reader must hold in their head, and that cost is paid on every future change. |
| **Where it comes from** | Cyclomatic complexity (McCabe, 1976) counts independent paths — the book's listed metric. Cognitive complexity (G. Ann Campbell / SonarSource) weights *readability* instead, and is what this tool scores. |
| **Computed here** | Both numbers per function; the module reports the **90th percentile** of cognitive complexity (`CogP90`). |
| **Impact on `ML`** | `p_complexity = clamp01((CogP90 − 8) / 22)`, weight **0.20**. Below 8 costs nothing. |
| **Bands** | 🟢 ≤ 8 · 🟡 9–18 · 🔴 ≥ 19 |
| **Source** | [`computeComplexity`](../../src/metrics/complexity.ts#L22) |

It is weighted below coupling and cohesion on purpose: a complex function is real, but **local** —
it can be fixed without moving anything.

---

## Cyclomatic

Per function: 1, plus one for each `if`, `for`, `for..of`, `for..in`, `while`, `do`, `case`,
`catch`, `&&`, `||`, `??`, ternary and optional-chaining short circuit.

Functions over `thresholds.functionComplexity` (10, cyclomatic) are listed individually below the
table and emitted in SARIF. That list is the only thing cyclomatic is used for.

## Cognitive

G. Ann Campbell's specification, as SonarSource implements it: nesting-weighted, `else`/`else if`
charged flat, and runs of the same boolean operator charged once. It correlates far better with
how hard code actually is to read.

Two deliberate deviations: **recursion is not charged**, and `!(a && b)` is **not
De Morgan-normalised** before counting operator runs.

A callback inside a method is charged to that method rather than counted as its own function.
Otherwise a module full of one-line `.map()` arrows would look simpler than it is.

---

## `CogP90` — the module-level number

Of all functions in the module, the cognitive complexity at the **90th percentile** — "how hard is
a *typically hard* function here to read?".

P90 rather than mean, so a module full of trivial getters cannot hide two monsters. Nearest-rank
([`percentile`](../../src/util/stats.ts#L23)), so the value is one a real function actually has.

🟢 ≤ 8 · 🟡 9–18 · 🔴 ≥ 19

The red line (p90 ≥ 19) is the half-way point of the score's penalty ramp
(`freeComplexity + complexitySpan/2`), so it moves with those config values.

---

## How it feeds the score

```
p_complexity = clamp01( (cognitiveP90(m) − freeComplexity) / complexitySpan )
             = clamp01( (cognitiveP90(m) − 8) / 22 )          weight 0.20
```

([penalties.ts#L28](../../src/scoring/penalties.ts#L28)). Below a p90 of 8 the penalty is zero;
the **full** penalty is not reached until a p90 of 30. See
[maintainability-level](maintainability-level.md).

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `thresholds.freeComplexity` | `8` | Cognitive p90 that costs nothing — a method with a couple of branches. |
| `thresholds.complexitySpan` | `22` | Full penalty at a p90 of 30, which is code most reviewers would refuse. |
| `thresholds.functionComplexity` | `10` | Cyclomatic cutoff for the "functions above threshold" list and SARIF. |
| `weights.complexity` | `0.20` | Share of `ML` this metric carries. |
