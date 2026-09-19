# LCOM4 — lack of cohesion of methods

[← All metrics](README.md)

**Is this class secretly several classes?**

| | |
|---|---|
| **The idea** | If a class is one thing, its methods and fields form one connected web — methods share state. If two clusters of methods never touch the same field, they are two classes sharing a filename, and the single-responsibility principle says to split them. |
| **Where it comes from** | The LCOM family (Chidamber & Kemerer, 1994); the LCOM4 variant counts connected components (Hitz & Montazeri, 1995). It is the *class-level* reading of the book's "component cohesion". |
| **Computed here** | Per class, the number of connected components in its method/field graph. `1` = does one thing, `N` = N classes wearing a trenchcoat. The column reports the module's **worst** class (`lcom4Max`). |
| **Impact on `ML`** | **None — diagnostic only.** It names one class to split instead of moving a decimal. |
| **Bands** | 🟢 1 · 🟡 2 · 🔴 ≥ 3 |
| **Source** | [`computeLcom4`](../../src/metrics/lcom4.ts#L26), rolled up by [`computeModuleLcom4`](../../src/metrics/lcom4.ts#L94) |

This is the metric that finds the 900-line `UserService`, and the report prints the components so
you can see the seam:

```
UsersService src/users/users.service.ts:13 splits into 2:
  {activate, build, create, findById, listForUser, repository}
  {describe}
```

---

## The exclusions, and why each is necessary

**The constructor is excluded** (`lcom4.excludeConstructor`, default `true`). A Nest constructor
takes every collaborator as a parameter property, so counting it would connect every field and pin
every provider's score to 1 — the metric would report nothing at all.

**Classes with fewer than `lcom4.minMethods` (2) methods** are reported but excluded from the
module aggregate. A DTO has no behaviour to be cohesive about.

**Entities and repositories are excluded by default.** Neither is incoherent when its members do
not touch each other. An entity is a bag of columns: LCOM4 over it counts columns. A repository is
a fan of independent queries over one table: LCOM4 over it counts queries. Left in, they are the
loudest classes in every report and none of it is actionable — which is how a real `UsersService`
at LCOM4 3 gets lost in the noise.

They are matched on three axes, because the same class is spelled three ways in the wild:

| Axis | Key | Default | Matched against |
|---|---|---|---|
| Decorator | `lcom4.excludeDecorators` | `Entity`, `ViewEntity`, `ChildEntity`, `Schema`, `ObjectType`, `InputType`, `EntityRepository` | Exact class-decorator names |
| Class name | `lcom4.excludeClasses` | `*Entity`, `*Repository` | The class name, as a glob |
| File | `lcom4.excludeFiles` | `**/*.entity.ts`, `**/*.repository.ts`, `**/entities/**`, `**/repositories/**` | The project-relative path, as a glob |

Globs are case-insensitive; `**` spans directories, `*` stops at `/`. Matching is on the class as
written, not on its base class, so a repository that neither carries a repository decorator, nor is
named `*Repository`, nor lives in a repository file is still measured.

An excluded class is still **reported** with its LCOM4 and its components — it is left out of
`lcom4Max` and `lcom4Mean` only, and `excludedBy` in the JSON says which rule caught it
(`"decorator"`, `"class"`, `"file"` or `"minMethods"`).

Lists **replace** the defaults rather than adding to them, so `"excludeClasses": []` opts back in
to every repository, and if you want to add a shape you list the defaults alongside it:

```json
{
  "lcom4": {
    "excludeClasses": ["*Entity", "*Repository", "*Dto", "*Mapper"]
  }
}
```

---

## How it feeds the score

It does not. Only [`Coh`](cohesion.md) feeds the cohesion penalty. `LCOM4` is a **diagnostic**
that points at one specific class to split, which is more useful than another decimal in a
weighted sum.

---

## Configuration

| Key | Default | Effect |
|---|---|---|
| `lcom4.excludeConstructor` | `true` | Ignore the constructor when linking fields to methods. |
| `lcom4.minMethods` | `2` | Below this, a class is reported but not aggregated. |
| `lcom4.excludeDecorators` | entity/schema decorators | Classes carrying one of these decorators are reported but not aggregated. |
| `lcom4.excludeClasses` | `["*Entity", "*Repository"]` | Class-name globs excluded from the aggregate. |
| `lcom4.excludeFiles` | `["**/*.entity.ts", "**/*.repository.ts", "**/entities/**", "**/repositories/**"]` | File globs excluded from the aggregate. |
