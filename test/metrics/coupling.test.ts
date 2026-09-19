import { describe, expect, it } from "vitest";
import { computeCoupling } from "../../src/metrics/coupling.js";
import { computeBlastRadius } from "../../src/metrics/blast-radius.js";
import { buildFixture } from "../helpers/graph.js";

/**
 * A fixed four-module shape used by most of the assertions below:
 *
 *   web -> core, api -> core, api -> web, jobs -> core
 *
 * so core has Ca 3 / Ce 0, web has Ca 1 / Ce 1, api has Ca 0 / Ce 2,
 * jobs has Ca 0 / Ce 1. k = 4.
 */
function fourModules() {
  return buildFixture({
    modules: {
      core: { files: { "a.ts": 10, "b.ts": 20 } },
      web: { files: { "a.ts": 5 } },
      api: { files: { "a.ts": 7 } },
      jobs: { files: { "a.ts": 3 } },
    },
    deps: ["web/a.ts -> core/a.ts", "api/a.ts -> core/b.ts", "api/a.ts -> web/a.ts", "jobs/a.ts -> core/a.ts"],
  });
}

describe("computeCoupling", () => {
  it("counts distinct modules, not distinct edges", () => {
    const fixture = fourModules();
    const core = computeCoupling(
      "core",
      fixture.graph,
      fixture.scope,
      fixture.filesOf,
      { abstractions: 0, concretions: 3 },
      fixture.config,
    );

    // web, api and jobs all depend on core; core depends on nothing.
    expect(core.Ca).toBe(3);
    expect(core.Ce).toBe(0);
    expect(core.afferentModules).toEqual(["api", "jobs", "web"]);
    expect(core.efferentModules).toEqual([]);
  });

  it("computes c_i as (alpha * Ca + (1 - alpha) * Ce) / (k - 1)", () => {
    const fixture = fourModules();

    // core: (0.7 * 3 + 0.3 * 0) / (4 - 1) = 2.1 / 3 = 0.7
    const core = computeCoupling("core", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(core.ci).toBe(0.7);

    // web: (0.7 * 1 + 0.3 * 1) / 3 = 1.0 / 3 = 0.3333
    const web = computeCoupling("web", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(web.ci).toBe(0.3333);

    // api: (0.7 * 0 + 0.3 * 2) / 3 = 0.6 / 3 = 0.2
    const api = computeCoupling("api", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(api.ci).toBe(0.2);
  });

  it("returns c_i = 0 when k = 1, because there is nothing to be coupled to", () => {
    const fixture = buildFixture({ modules: { only: { files: { "a.ts": 5 } } } });
    const result = computeCoupling(
      "only",
      fixture.graph,
      fixture.scope,
      fixture.filesOf,
      { abstractions: 0, concretions: 1 },
      fixture.config,
    );
    expect(result.k).toBe(1);
    expect(result.ci).toBe(0);
  });

  it("clamps c_i to 1 when afferentWeight pushes the numerator past k - 1", () => {
    const fixture = buildFixture({
      modules: {
        core: { files: { "a.ts": 1 } },
        one: { files: { "a.ts": 1 } },
        two: { files: { "a.ts": 1 } },
      },
      deps: ["one/a.ts -> core/a.ts", "two/a.ts -> core/a.ts"],
      config: { coupling: { afferentWeight: 1 } },
    });

    // (1 * 2 + 0 * 0) / (3 - 1) = 1.0 exactly, and never above it.
    const core = computeCoupling("core", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(core.ci).toBe(1);
  });

  it("counts CaFiles separately, because 40 imports is not one import", () => {
    const fixture = buildFixture({
      modules: {
        core: { files: { "a.ts": 1 } },
        web: { files: { "a.ts": 1, "b.ts": 1, "c.ts": 1 } },
      },
      deps: ["web/a.ts -> core/a.ts", "web/b.ts -> core/a.ts", "web/c.ts -> core/a.ts"],
    });

    const core = computeCoupling("core", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(core.Ca).toBe(1); // one module
    expect(core.CaFiles).toBe(3); // hammering it from three files
  });

  it("computes instability as Ce / (Ca + Ce), and 0 for an isolated module", () => {
    const fixture = fourModules();
    const web = computeCoupling("web", fixture.graph, fixture.scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(web.instability).toBe(0.5); // 1 / (1 + 1)

    const isolated = buildFixture({ modules: { a: {}, b: {} } });
    const result = computeCoupling("a", isolated.graph, isolated.scope, isolated.filesOf, { abstractions: 0, concretions: 1 }, isolated.config);
    expect(result.instability).toBe(0);
  });

  it("computes abstractness and distance from the main sequence", () => {
    const fixture = fourModules();
    // core: A = 3 / (3 + 1) = 0.75, I = 0. D = |0.75 + 0 - 1| / sqrt(2) = 0.1768
    const core = computeCoupling(
      "core",
      fixture.graph,
      fixture.scope,
      fixture.filesOf,
      { abstractions: 3, concretions: 1 },
      fixture.config,
    );
    expect(core.abstractness).toBe(0.75);
    expect(core.distanceFromMainSequence).toBeCloseTo(0.1768, 4);
  });

  it("restricts every count to the given scope", () => {
    const fixture = fourModules();
    // Only core and web are in scope, so api's and jobs' edges must not count.
    const scope = new Set(["core", "web"]);
    const core = computeCoupling("core", fixture.graph, scope, fixture.filesOf, { abstractions: 0, concretions: 1 }, fixture.config);
    expect(core.Ca).toBe(1);
    expect(core.k).toBe(2);
    // (0.7 * 1 + 0.3 * 0) / (2 - 1) = 0.7
    expect(core.ci).toBe(0.7);
  });
});

describe("computeBlastRadius", () => {
  it("follows incoming edges transitively", () => {
    // a <- b <- c, plus an unrelated d. Changing `a` reaches b and c.
    const fixture = buildFixture({
      modules: {
        a: { files: { "f.ts": 10 } },
        b: { files: { "f.ts": 20 } },
        c: { files: { "f.ts": 30 } },
        d: { files: { "f.ts": 40 } },
      },
      deps: ["b/f.ts -> a/f.ts", "c/f.ts -> b/f.ts"],
    });

    const blast = computeBlastRadius(
      "a",
      fixture.graph,
      fixture.scope,
      fixture.statementsOf,
      fixture.totalStatements,
    );

    expect(blast.modules).toEqual(["b", "c"]);
    expect(blast.moduleCount).toBe(2);
    expect(blast.ratio).toBeCloseTo(2 / 3, 4); // 2 of the 3 other modules
    expect(blast.statements).toBe(50); // 20 + 30
    expect(blast.statementRatio).toBeCloseTo(50 / 90, 4); // total 100, minus a's 10
  });

  it("is empty for a leaf nothing depends on", () => {
    const fixture = buildFixture({
      modules: { a: { files: { "f.ts": 1 } }, b: { files: { "f.ts": 1 } } },
      deps: ["a/f.ts -> b/f.ts"],
    });
    const blast = computeBlastRadius("a", fixture.graph, fixture.scope, fixture.statementsOf, 2);
    expect(blast.moduleCount).toBe(0);
    expect(blast.ratio).toBe(0);
  });

  it("terminates on a cycle", () => {
    const fixture = buildFixture({
      modules: { a: { files: { "f.ts": 1 } }, b: { files: { "f.ts": 1 } } },
      deps: ["a/f.ts -> b/f.ts", "b/f.ts -> a/f.ts"],
    });
    const blast = computeBlastRadius("a", fixture.graph, fixture.scope, fixture.statementsOf, 2);
    expect(blast.modules).toEqual(["b"]);
  });
});
