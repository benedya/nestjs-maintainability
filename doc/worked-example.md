# A worked example

Four files, two modules, every number computed by hand. This project lives at
[`test/fixtures/worked-example`](../test/fixtures/worked-example), and
[`test/worked-example.test.ts`](../test/worked-example.test.ts) fails if the tool and this
document ever disagree.

Each metric it exercises is defined in full under [`doc/metrics/`](metrics/README.md); this
document shows the arithmetic end to end on a project small enough to check.

```
src/main.ts
src/app.module.ts
src/greeting/greeting.module.ts
src/greeting/greeting.service.ts
```

The ten-line module under the microscope:

```ts
// src/greeting/greeting.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class GreetingService {
  private readonly seen = new Set<string>();

  greet(name: string): string {
    if (this.seen.has(name)) {
      return 'Welcome back, ' + name;
    }
    this.seen.add(name);
    return 'Hello, ' + name;
  }
}
```

## Statements

Imports and type-only declarations are not counted. The class, an initialised field, the method
and its four body statements are:

| | |
|---|---|
| `export class GreetingService` | 1 |
| `private readonly seen = new Set()` (has an initialiser) | 1 |
| `greet(...)` | 1 |
| `if (...)` | 1 |
| `return 'Welcome back, ' + name` | 1 |
| `this.seen.add(name)` | 1 |
| `return 'Hello, ' + name` | 1 |
| **greeting.service.ts** | **7** |

The other files come to `greeting.module.ts` 1, `app.module.ts` 1, `main.ts` 4 — **13 statements**
in total.

## Ownership

`AppModule` sits at the source root, so it is treated as a composition root and owns only the
files beside it (`app.module.ts`, `main.ts`). `GreetingModule` owns `src/greeting/`. So `k = 2`.

## Coupling

`app.module.ts` imports `greeting.module.ts`; nothing goes the other way.

```
GreetingModule:  Ca = 1, Ce = 0   c_i = (0.7 × 1 + 0.3 × 0) / (2 − 1) = 0.70
AppModule:       Ca = 0, Ce = 1   c_i = (0.7 × 0 + 0.3 × 1) / (2 − 1) = 0.30
```

## Cohesion

Three dependency edges exist: `main → app.module` (inside AppModule),
`greeting.module → greeting.service` (inside GreetingModule), and `app.module → greeting.module`
(crossing the boundary, so it counts as external for **both** modules).

```
GreetingModule:  1 / (1 + 1) = 0.50
AppModule:       1 / (1 + 1) = 0.50
```

## Complexity, size, partitioning

`greet` has one `if`, so its cognitive complexity is 1. The module's cognitive p90 is 1, well
below `freeComplexity` (8), so the complexity penalty is **0**. Eight statements is far below
`freeSize` (800), so the size penalty is **0**.

`domainAlignment` is 1 for both modules, so the partitioning penalty is **0** as well — but for
two different reasons. `GreetingModule` has no outgoing cross-module edges at all, and a module
with nothing to misdirect is [defined as 1](metrics/partitioning.md#signal-2--per-module-leakage-the-scored-number).
`AppModule`'s one outgoing edge lands on `GreetingModule`, whose folder name is not in
`partitioning.technicalNames`, so it counts as a domain peer.

Note that the `Stmts` column shows `share% (count)`, not the raw count: the penalty uses the
absolute number, the column asks whether one module dominates the app. Both are [in
size](metrics/size.md#the-column-vs-the-penalty).

## Putting it together

```
ML_m = 100 × (1 − Σ w_j × p_j)

GreetingModule
  coupling      0.70 × 0.35 = 0.2450
  cohesion      0.50 × 0.25 = 0.1250
  complexity    0.00 × 0.20 = 0
  size          0.00 × 0.10 = 0
  partitioning  0.00 × 0.10 = 0
                              ------
                              0.3700   →   100 × (1 − 0.37) = 63.0   (C)

AppModule
  coupling      0.30 × 0.35 = 0.1050
  cohesion      0.50 × 0.25 = 0.1250
                              ------
                              0.2300   →   100 × (1 − 0.23) = 77.0   (B)
```

Application level:

```
meanCoupling         = (0.70 + 0.30) / 2              = 0.500
maintainabilityLevel = (8/13) × 63 + (5/13) × 77      = 68.38   (C)
```

And what the tool prints:

```
$ nest-ml analyze test/fixtures/worked-example

  Maintainability   68.4 (C)    size-weighted mean of module ML
  Coupling          0.50        mean c_i across 2 modules; lower is better
  Modules (k)       2           4 files, 13 statements
  Partitioning      domain      confidence 0.25 (heuristic)

  Module          ML  Grade   c_i  Ca  Ce     I   Coh  LCOM4  CogP90    Stmts  Blast
  ----------------------------------------------------------------------------------
  GreetingModule  63  C      0.70   1   0  0.00  0.50      1       1  62% (8)   100%
  AppModule       77  B      0.30   0   1  1.00  0.50      1       0  38% (5)     0%
```

Note that the size-weighted mean (68.38) sits below the plain mean (70), because the worse
module is the bigger one. That is the whole point of weighting it.
