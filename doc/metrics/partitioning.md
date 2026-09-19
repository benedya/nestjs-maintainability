# Technical vs domain partitioning — `domainAlignment`

[← All metrics](README.md)

**Is this app split by layer, or by feature?**

| | |
|---|---|
| **The idea** | A *technically* partitioned app groups code by type (`controllers/`, `services/`, `repositories/`), so one feature change touches every folder. A *domain* partitioned app groups by feature, so the change stays in one place. Same code, very different cost of change. |
| **Where it comes from** | The technical-vs-domain partitioning discussion in *The Hard Parts* ch. 3 — the fifth book metric, and the only one that cannot be computed exactly. |
| **Computed here** | Two signals: a **name-matching heuristic** over top-level folders gives the app verdict `technical \| domain \| mixed` with an explicit `confidence` < 1; per module, `domainAlignment` = the share of outgoing cross-module edges landing on a domain peer. |
| **Impact on `ML`** | `p_partitioning = 1 − domainAlignment`, weight **0.10** — low precisely because it is the heuristic one. |
| **Bands** | No column and no colour; the verdict prints above the table. |
| **Source** | [`computeAppPartitioning`](../../src/metrics/partitioning.ts#L50), [`computeModulePartitioning`](../../src/metrics/partitioning.ts#L114) |

---

## Signal 1 — top-level shape (application verdict)

The directories directly under the source root are matched against a configurable list of
technical-layer names (`controllers`, `services`, `repositories`, `dtos`, `entities`, `common`, …).

The output is `technical | domain | mixed`, plus a confidence that falls towards the middle of the
range and falls further when there are too few directories to draw a conclusion from. It is
printed above the module table:

```
  Partitioning      technical   confidence 0.95 (heuristic)
```

| Key | Default | Meaning |
|---|---|---|
| `partitioning.technicalVerdictAbove` | `0.6` | A clear majority of technical folder names before calling an app technically partitioned. |
| `partitioning.domainVerdictBelow` | `0.25` | Most real apps have one or two shared folders; that is not technical partitioning. |

## Signal 2 — per-module leakage (the scored number)

For each module, the fraction of its outgoing cross-module edges landing on a domain peer rather
than a technical pseudo-module:

```
domainAlignment(m) = domainEdges / (domainEdges + technicalEdges)
```

A module with no outgoing cross-module edges is defined as 1
([partitioning.ts#L130](../../src/metrics/partitioning.ts#L130)).

**1** means every dependency stays among domain peers. Low values mean the module's behaviour is
smeared across layers — one feature has to touch the controller, the service, the repository and a
shared entity folder.

This has no column of its own in the table; it reaches the report through the score and the
per-module drill-down.

---

## How it feeds the score

```
p_partitioning = 1 − domainAlignment(m)          weight 0.10
```

See [maintainability-level](maintainability-level.md).

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `partitioning.technicalNames` | `["controllers", "services", "repositories", "dtos", "entities", …]` | The names treated as technical layers. |
| `partitioning.technicalVerdictAbove` | `0.6` | Verdict cutoff for `technical`. |
| `partitioning.domainVerdictBelow` | `0.25` | Verdict cutoff for `domain`. |
| `weights.partitioning` | `0.10` | Share of `ML` this metric carries. |

---

## Blind spots

**It is name matching.** A domain folder called `models` is read as a technical layer, and a
technical folder with a domain-sounding name is not. Adjust `partitioning.technicalNames` for your
codebase — that is what the option is for. This is why the confidence is always below 1 and the
weight is low.
