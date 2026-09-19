import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.js";
import type { ModuleReport, Report } from "../src/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The worked-example doc (doc/worked-example.md) works this fixture through by hand, number by number. If the tool
 * and that documentation ever disagree, one of them is lying to the reader -
 * so this test pins every figure the doc prints.
 *
 * The project:
 *
 *   src/main.ts                        4 statements
 *   src/app.module.ts                  1 statement    imports GreetingModule
 *   src/greeting/greeting.module.ts    1 statement
 *   src/greeting/greeting.service.ts   7 statements
 *
 * AppModule sits at the source root, so it owns `src/*.ts` only; GreetingModule
 * owns `src/greeting/`. k = 2.
 */
describe("worked example (mirrored in doc/worked-example.md)", () => {
  let report: Report;
  let greeting: ModuleReport;
  let app: ModuleReport;

  beforeAll(async () => {
    report = await analyze({
      path: path.join(HERE, "fixtures", "worked-example"),
      cache: { enabled: false },
    });
    greeting = report.modules.find((module) => module.name === "GreetingModule") as ModuleReport;
    app = report.modules.find((module) => module.name === "AppModule") as ModuleReport;
  }, 60_000);

  it("counts statements the way the doc says", () => {
    const byPath = Object.fromEntries(report.files.map((file) => [file.path, file.statements]));
    // class + initialised field + method + if + return + call + return = 7
    expect(byPath["src/greeting/greeting.service.ts"]).toBe(7);
    // the @Module class only
    expect(byPath["src/greeting/greeting.module.ts"]).toBe(1);
    expect(byPath["src/app.module.ts"]).toBe(1);
    // function + const + await listen + void bootstrap() = 4
    expect(byPath["src/main.ts"]).toBe(4);
    expect(report.application.totalStatements).toBe(13);
  });

  it("assigns files to modules the way the doc says", () => {
    expect(app.files).toEqual(["src/app.module.ts", "src/main.ts"]);
    expect(greeting.files).toEqual([
      "src/greeting/greeting.module.ts",
      "src/greeting/greeting.service.ts",
    ]);
    expect(report.application.k).toBe(2);
  });

  it("computes c_i as the doc computes it", () => {
    // GreetingModule: (0.7 * 1 + 0.3 * 0) / (2 - 1) = 0.7
    expect(greeting.coupling.Ca).toBe(1);
    expect(greeting.coupling.Ce).toBe(0);
    expect(greeting.coupling.ci).toBe(0.7);

    // AppModule: (0.7 * 0 + 0.3 * 1) / (2 - 1) = 0.3
    expect(app.coupling.Ca).toBe(0);
    expect(app.coupling.Ce).toBe(1);
    expect(app.coupling.ci).toBe(0.3);
  });

  it("computes cohesion as the doc computes it", () => {
    // Each module has one internal edge and shares one edge across the boundary.
    for (const module of [greeting, app]) {
      expect(module.cohesion.internalEdges).toBe(1);
      expect(module.cohesion.externalEdges).toBe(1);
      expect(module.cohesion.structural).toBe(0.5);
    }
  });

  it("charges nothing for complexity, size or partitioning at this scale", () => {
    // cognitive p90 of 1 is below freeComplexity 8; 8 statements is below
    // freeSize 800; every dependency stays among domain peers.
    expect(greeting.complexity.cognitive.p90).toBe(1);
    expect(greeting.penalties.complexity).toBe(0);
    expect(greeting.penalties.size).toBe(0);
    expect(greeting.penalties.partitioning).toBe(0);
  });

  it("produces the module scores the doc prints", () => {
    // 100 * (1 - (0.35 * 0.7 + 0.25 * 0.5)) = 100 * (1 - 0.37) = 63
    expect(greeting.maintainabilityLevel).toBe(63);
    expect(greeting.grade).toBe("C");

    // 100 * (1 - (0.35 * 0.3 + 0.25 * 0.5)) = 100 * (1 - 0.23) = 77
    expect(app.maintainabilityLevel).toBe(77);
    expect(app.grade).toBe("B");
  });

  it("produces the application figures the doc prints", () => {
    // (0.7 + 0.3) / 2 = 0.5
    expect(report.application.meanCoupling).toBe(0.5);
    // derived views of the same figure, kept in the JSON only
    expect(report.application.rawCouplingSum).toBe(1);
    expect(report.application.couplingIndex).toBe(50);
    // (8/13) * 63 + (5/13) * 77 = 38.769... + 29.615... = 68.38
    expect(report.application.maintainabilityLevel).toBe(68.38);
    expect(report.application.grade).toBe("C");
  });

  it("reports a 100% blast radius for the module the app depends on", () => {
    expect(greeting.blastRadius.moduleCount).toBe(1);
    expect(greeting.blastRadius.ratio).toBe(1);
    expect(app.blastRadius.moduleCount).toBe(0);
  });

  it("finds nothing to complain about in a correct two-module app", () => {
    expect(report.boundaryViolations).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});
