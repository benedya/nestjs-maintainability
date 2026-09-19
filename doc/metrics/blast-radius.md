# Blast radius — `Blast`

[← All metrics](README.md)

**If I change this module, what proportion of the app is in scope?**

| | |
|---|---|
| **The idea** | Change impact ripples: your direct dependents have their own dependents. The real cost of touching a module is its whole transitive incoming closure, not the modules that import it directly. |
| **Where it comes from** | Change-impact analysis, applied to the book's component-coupling metric — the practical question `Ca` alone cannot answer. |
| **Computed here** | The transitive closure of *incoming* dependencies, as a percentage of the other `k − 1` modules. |
| **Impact on `ML`** | **None — risk indicator only.** Its inputs are already scored through [`cᵢ`](coupling.md#cᵢ--coupling-level); counting the closure again would double-charge the same coupling. |
| **Bands** | 🟢 < 20% · 🟡 20–50% · 🔴 > 50% — lower is safer to change. |
| **Source** | [`computeBlastRadius`](../../src/metrics/blast-radius.ts#L15) |

For most teams this is the most actionable number in the report, because unlike a score it names
the modules.

---

## Blast radius vs `Ca`

[`Ca`](coupling.md#ca--afferent-coupling) counts *direct* dependents only. `Blast` follows the
chain all the way out, so a module with a small `Ca` can still have a large blast radius if its
few dependents are themselves widely used. That gap is the point of reporting both.

---

## Naming the modules

```bash
nest-ml analyze --what-if OrdersModule
```

lists every module in the closure, rather than just the percentage.

---

## How it feeds the score

It does not. Its inputs are already scored through [`cᵢ`](coupling.md#cᵢ--coupling-level), and
counting the transitive closure again would charge the same coupling twice. `Blast` is a **risk
indicator**: it tells you how expensive a change to this module is likely to be, not how badly
written it is. See [maintainability-level](maintainability-level.md).

---

## Configuration

No knobs of its own. It is computed over the same reconciled graph as
[coupling](coupling.md), so the `graph.*` options that change edges change `Blast` with them.
