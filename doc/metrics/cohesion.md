# Structural cohesion — `Coh`

[← All metrics](README.md)

**Do this module's dependencies stay inside it, or leak out?**

| | |
|---|---|
| **The idea** | A cohesive module is one whose parts belong together — it does one job, so a change to that job stays in one place. An incohesive module is a folder: its contents are unrelated, and every change reaches outside it. Cohesion is coupling's partner; the book lists them as the two primary metrics. |
| **Where it comes from** | Structured design (Constantine & Yourdon), via *The Hard Parts* ch. 3, "component cohesion". |
| **Computed here** | Of every dependency edge with at least one end inside the module, the weighted fraction that stays inside. 0–1, higher is better. |
| **Impact on `ML`** | `p_cohesion = 1 − cohesion`, weight **0.25** — the second largest. |
| **Bands** | 🟢 ≥ 0.70 · 🟡 0.40–0.69 · 🔴 < 0.40 |
| **Source** | [`computeCohesion`](../../src/metrics/cohesion.ts#L21) |

---

## How it is calculated

```
cohesion(m) = internal / (internal + external)
```

Both terms are weighted sums — a type-only edge counts `graph.typeOnlyEdgeWeight`, an inferred
edge counts its confidence — and **both are reported**, so the division can be checked by hand.

A module with no dependencies at all scores **1**. A single self-contained file is perfectly
cohesive, and scoring it 0 would punish exactly the thing the metric rewards.

---

## Cohesion at two scales

`Coh` is *structural*: it looks at edges between files, and asks whether a module's dependencies
stay home. It says nothing about whether the classes inside those files are individually coherent.
That is [`LCOM4`](lcom4.md)'s job — the same word, a different scale, and only `Coh` feeds the
score.

---

## How it feeds the score

```
p_cohesion = 1 − cohesion(m)          weight 0.25
```

([penalties.ts#L27](../../src/scoring/penalties.ts#L27)) — a direct inversion, no free zone. See
[maintainability-level](maintainability-level.md).

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `weights.cohesion` | `0.25` | Share of `ML` this metric carries. |
| `graph.typeOnlyEdgeWeight` | `1.0` | Weight of a type-only edge in both terms. |
| `graph.includeTypeOnlyImports` | `true` | Whether type-only imports count at all. |

---

## Worked example

Both modules in the [worked example](../worked-example.md#cohesion) score `0.50`, and the three
edges that produce it are enumerated there.
