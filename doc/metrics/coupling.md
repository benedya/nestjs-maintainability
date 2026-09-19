# Coupling — `c_i`, `Ca`, `Ce`, `I`, `A`, `D`

[← All metrics](README.md)

**How much of the rest of the application is entangled with this module.**

| | |
|---|---|
| **The idea** | Two modules are coupled when one has to know about the other. Change propagates along those edges: the more modules depend on you, the more code a change to you can break. Maintainability is therefore mostly a coupling problem. |
| **Where it comes from** | Robert C. Martin's afferent/efferent package metrics (`Ca`, `Ce`, `I`, `A`, `D`), which *The Hard Parts* ch. 3 adopts — with the emphasis on **incoming** coupling. |
| **Computed here** | Per module, over cross-module edges of the reconciled graph: `c_i = clamp01( (0.7·Ca + 0.3·Ce) / (k−1) )`. |
| **Impact on `ML`** | Largest single weight: `p_coupling = c_i`, **0.35**. |
| **Bands** | 🟢 < 0.30 · 🟡 0.30–0.60 · 🔴 > 0.60 |
| **Source** | [`computeCoupling`](../../src/metrics/coupling.ts#L20), over [the graph](../how-the-code-is-read.md) |

---

## The measurements

### `Ca` — afferent coupling

The count of distinct *other modules* that depend on this one (incoming). `CaFiles` counts the
distinct files as well, because one module hammering another from forty files is not one import.

**Not colour-graded:** high `Ca` on a shared kernel (`AuthModule`, `entities/`) is correct and
healthy; high `Ca` on a leaf feature is a smell. The number cannot tell these apart, so it is
reported plain. It *is* the incoming side of `cᵢ`, and it drives
[blast radius](blast-radius.md).

[`computeCoupling`](../../src/metrics/coupling.ts#L38)

### `Ce` — efferent coupling

The count of distinct other modules this one depends on (outgoing). **Not colour-graded**, for the
same reason as `Ca`: a composition root legitimately depends on everything.

[`computeCoupling`](../../src/metrics/coupling.ts#L39)

### `cᵢ` — coupling level

The per-component coupling term, normalised to 0–1:

```
c_i = clamp01( (α·Ca + (1 − α)·Ce) / (k − 1) )
```

`k` is the total module count including pseudo-modules, and `k − 1` is "every other module", so
`cᵢ` reads as *the fraction of the rest of the app this module is entangled with*. `k = 1 ⇒
cᵢ = 0`.

`α` (`coupling.afferentWeight`) defaults to **0.7**, so incoming coupling dominates. The asymmetry
is deliberate: what you depend on is your problem, what depends on you is everyone else's.

Because it is normalised against `k` it is best compared *between your own modules*, not against a
fixed line.

🟢 < 0.30 · 🟡 0.30–0.60 · 🔴 > 0.60

[`computeCoupling`](../../src/metrics/coupling.ts#L49). It is the coupling penalty verbatim
([penalties.ts#L26](../../src/scoring/penalties.ts#L26)) and the term averaged into the
application's `meanCoupling`.

### `I` — instability

Martin's `Ce / (Ca + Ce)`, 0–1: the share of a module's coupling that points outward. 0 =
maximally stable (much depends on it, it depends on nothing); 1 = maximally unstable (depends on
others, nothing depends on it); an isolated module is defined as 0.

**Not colour-graded because neither end is bad** — stability is correct for a foundation and
instability is correct for a top-level module.

[`computeCoupling`](../../src/metrics/coupling.ts#L50)

### `A` and `D` — abstractness and distance from the main sequence

`A` is abstractness (interfaces + type aliases + abstract classes, against concrete classes)
([coupling.ts#L56](../../src/metrics/coupling.ts#L56)). What *is* judgeable, unlike `I` alone, is
the distance from Martin's main sequence:

```
D = |A + I − 1| / √2
```

([coupling.ts#L57](../../src/metrics/coupling.ts#L57)). Both are surfaced in the HTML scatter,
with the main sequence drawn on it, rather than in the terminal table. Neither is scored.

---

## The application-level figures

The book prints the maintainability level as

```
ML = 100 * Σ(i=1..k) c_i
```

where `k` is the number of logical components and `cᵢ` is the coupling level of component `i`.

**That equation is illustrative, not operational, and implementing it literally would produce a
number that is worse than useless.** Taken at face value it is unbounded and *increases*
monotonically with coupling, so it cannot yield a 0–100 figure where higher is better: an
application with twenty tightly coupled modules would score `2000` and look twenty times more
maintainable than a clean one. The authors say as much — "putting aside complicated
mathematics" — and immediately pivot to the list of practical metrics that the rest of the
chapter is actually about.

So this package reports **two independent figures**:

| Field | Formula | Range | Direction |
|---|---|---|---|
| `meanCoupling` | `(1/k) × Σ cᵢ` | `0 … 1` | lower = better |
| `maintainabilityLevel` | `Σ (statementsₘ / total) × MLₘ` | `0 … 100` | higher = better |

- **`meanCoupling`** is the application's coupling, and it is deliberately the *same unit and the
  same direction* as the per-module `cᵢ` in the table — it is literally that column's mean. A
  reader who has learned to read `cᵢ` (`< 0.30` ok, `0.30–0.60` watch, `> 0.60` high) can read
  the application figure the same way, against the same thresholds. It is **coupling only** — it
  says nothing about cohesion, complexity, size or partitioning.
- **`maintainabilityLevel`** is the headline number, and the one you should track. It is a
  weighted composite of the book metrics, size-weighted across modules. See
  [maintainability level](maintainability-level.md).

Both come out of [`aggregateScope`](../../src/scoring/aggregate.ts#L30).

### `couplingIndex` and `rawCouplingSum`

The JSON also carries two **rescalings of `meanCoupling`**. They are not additional
measurements — each is an exact transform of the same quantity, and no ranking or comparison can
change between them:

| Field | Formula | Equivalently | Range | Direction |
|---|---|---|---|---|
| `rawCouplingSum` | `Σ cᵢ` | `meanCoupling × k` | `0 … k` | higher = worse |
| `couplingIndex` | `100 × (1 − (1/k) × Σ cᵢ)` | `100 × (1 − meanCoupling)` | `0 … 100` | higher = better |

`rawCouplingSum` is the book's expression exactly as printed, kept for transparency: if you have
the book open, this is the term you are looking at. `couplingIndex` inverts it onto a 0–100
"higher is better" scale, and exists for backwards compatibility with baselines and dashboards
written against earlier versions.

**Neither is printed by the reporters any more.** Showing `couplingIndex` next to the `cᵢ` column
meant the same underlying quantity appeared twice in opposite directions, under a name
(*coupling* index) that rises as coupling falls. The terminal, HTML and Markdown reports now show
`meanCoupling` alone.

One consequence worth stating plainly: **`meanCoupling` is sensitive to `k`.** The same
application split into four modules and into eight modules will produce different figures,
because `cᵢ` is normalised against `k − 1`. That is inherent in the formula's shape, and it is
one of several reasons cross-project comparison is meaningless — see
[README § how to read these numbers](../../README.md#3-how-to-read-these-numbers).

The same applies to [`excludeModules`](../../README.md#4-configuration), which lowers `k`
by dropping a module from the analysis. Every remaining `cᵢ` is renormalised against the smaller
`k − 1`, so excluding a hub such as `AppModule` removes real edges and can still push
`meanCoupling` up. Change the list in the same commit as `nest-ml baseline write`.

---

## How it feeds the score

```
p_coupling = c_i          weight 0.35
```

Straight through, no transform. See [maintainability-level](maintainability-level.md).

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `coupling.afferentWeight` (α) | `0.7` | How much incoming coupling dominates `cᵢ`. |
| `weights.coupling` | `0.35` | Share of `ML` this metric carries. |
| `graph.includeTypeOnlyImports` | `true` | Whether type-only imports create edges at all. |
| `graph.typeOnlyEdgeWeight` | `1.0` | Weight of a type-only edge. |

---

## Blind spots

Coupling that leaves the process is invisible: message brokers, HTTP calls, unresolvable string
DI tokens, `ModuleRef` dynamic lookup, `useFactory` bodies. Each resolvable gap produces a
`report.warnings[]` entry with a file and line. Full list in
[known blind spots](../blind-spots.md).
