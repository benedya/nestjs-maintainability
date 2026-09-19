import { describe, expect, it } from "vitest";
import { computePenalties, maintainabilityLevel } from "../../src/scoring/penalties.js";
import { gradeFor } from "../../src/scoring/grade.js";
import { aggregateScope, rankRefactorCandidates } from "../../src/scoring/aggregate.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type {
  AppPartitioning,
  CohesionMetrics,
  ComplexityMetrics,
  CouplingMetrics,
  ModulePartitioningMetrics,
  ModuleReport,
  Penalties,
  SizeMetrics,
} from "../../src/types.js";

const coupling = (ci: number): CouplingMetrics => ({
  Ca: 0,
  Ce: 0,
  CaFiles: 0,
  CeFiles: 0,
  afferentModules: [],
  efferentModules: [],
  instability: 0,
  ci,
  afferentWeight: 0.7,
  k: 4,
  abstractness: 0,
  distanceFromMainSequence: 0,
});

const cohesion = (structural: number): CohesionMetrics => ({
  structural,
  internalEdges: 0,
  externalEdges: 0,
  lcom4Max: 1,
  lcom4Mean: 1,
  lcom4Classes: [],
});

const complexity = (p90: number): ComplexityMetrics => ({
  functionCount: 1,
  cyclomatic: { mean: 0, p90: 0, max: 0, total: 0 },
  cognitive: { mean: 0, p90, max: p90, total: p90 },
  aboveThreshold: [],
});

const size = (statements: number): SizeMetrics => ({
  statements,
  files: 1,
  meanStatementsPerFile: statements,
  largestFile: null,
});

const partitioning = (domainAlignment: number): ModulePartitioningMetrics => ({
  domainAlignment,
  technicalEdges: 0,
  domainEdges: 0,
  classification: "domain",
  confidence: 0.5,
});

describe("penalties", () => {
  it("charges nothing below the free thresholds", () => {
    // cognitive p90 of 8 is exactly freeComplexity; 800 statements is exactly freeSize.
    const result = computePenalties(
      coupling(0),
      cohesion(1),
      complexity(8),
      size(800),
      partitioning(1),
      DEFAULT_CONFIG,
    );
    expect(result).toEqual({
      coupling: 0,
      cohesion: 0,
      complexity: 0,
      size: 0,
      partitioning: 0,
    });
  });

  it("scales linearly across the span above the free threshold", () => {
    // complexity: (19 - 8) / 22 = 0.5
    // size:       (2400 - 800) / 3200 = 0.5
    const result = computePenalties(
      coupling(0.4),
      cohesion(0.25),
      complexity(19),
      size(2400),
      partitioning(0.3),
      DEFAULT_CONFIG,
    );
    expect(result.complexity).toBe(0.5);
    expect(result.size).toBe(0.5);
    expect(result.coupling).toBe(0.4);
    expect(result.cohesion).toBe(0.75); // 1 - 0.25
    expect(result.partitioning).toBe(0.7); // 1 - 0.3
  });

  it("clamps at 1 past the end of the span", () => {
    const result = computePenalties(
      coupling(0),
      cohesion(1),
      complexity(500),
      size(1_000_000),
      partitioning(1),
      DEFAULT_CONFIG,
    );
    expect(result.complexity).toBe(1);
    expect(result.size).toBe(1);
  });
});

describe("maintainabilityLevel", () => {
  it("is 100 * (1 - sum(weight * penalty))", () => {
    const penalties: Penalties = {
      coupling: 0.4,
      cohesion: 0.75,
      complexity: 0.5,
      size: 0.5,
      partitioning: 0.7,
    };
    // 0.35*0.4 + 0.25*0.75 + 0.20*0.5 + 0.10*0.5 + 0.10*0.7
    // = 0.14 + 0.1875 + 0.10 + 0.05 + 0.07 = 0.5475  ->  45.25
    expect(maintainabilityLevel(penalties, DEFAULT_CONFIG.weights)).toBe(45.25);
  });

  it("is 100 when nothing is penalised and 0 when everything is", () => {
    const none: Penalties = { coupling: 0, cohesion: 0, complexity: 0, size: 0, partitioning: 0 };
    const all: Penalties = { coupling: 1, cohesion: 1, complexity: 1, size: 1, partitioning: 1 };
    expect(maintainabilityLevel(none, DEFAULT_CONFIG.weights)).toBe(100);
    expect(maintainabilityLevel(all, DEFAULT_CONFIG.weights)).toBe(0);
  });
});

describe("grades", () => {
  it("uses the configured bands", () => {
    expect(gradeFor(85, DEFAULT_CONFIG)).toBe("A");
    expect(gradeFor(84.9, DEFAULT_CONFIG)).toBe("B");
    expect(gradeFor(70, DEFAULT_CONFIG)).toBe("B");
    expect(gradeFor(55, DEFAULT_CONFIG)).toBe("C");
    expect(gradeFor(40, DEFAULT_CONFIG)).toBe("D");
    expect(gradeFor(39.9, DEFAULT_CONFIG)).toBe("F");
  });
});

function moduleReport(overrides: Partial<ModuleReport> & { id: string }): ModuleReport {
  return {
    name: overrides.id,
    file: null,
    kind: "nest",
    global: false,
    dir: overrides.id,
    files: [],
    coupling: coupling(0),
    blastRadius: { modules: [], moduleCount: 0, ratio: 0, statements: 0, statementRatio: 0 },
    cohesion: cohesion(1),
    complexity: complexity(0),
    size: size(0),
    partitioning: partitioning(1),
    penalties: { coupling: 0, cohesion: 0, complexity: 0, size: 0, partitioning: 0 },
    weights: DEFAULT_CONFIG.weights,
    maintainabilityLevel: 100,
    grade: "A",
    ...overrides,
  } as ModuleReport;
}

const NO_PARTITIONING: AppPartitioning = {
  verdict: "mixed",
  confidence: 0,
  technicalRatio: 0,
  topLevelDirs: [],
  note: "",
};

describe("application aggregation", () => {
  it("weights the mean by size, so a two-file module does not outvote a forty-file one", () => {
    const modules = [
      moduleReport({ id: "big", size: size(900), maintainabilityLevel: 40, coupling: coupling(0.5) }),
      moduleReport({ id: "small", size: size(100), maintainabilityLevel: 90, coupling: coupling(0.1) }),
    ];

    const scope = aggregateScope("all", null, null, modules, NO_PARTITIONING, DEFAULT_CONFIG);

    // weighted: 0.9 * 40 + 0.1 * 90 = 36 + 9 = 45.
    // The unweighted mean would have been 65 - the weighting is the point.
    expect(scope.maintainabilityLevel).toBe(45);
  });

  it("reports meanCoupling as the mean of the modules' c_i", () => {
    const modules = [
      moduleReport({ id: "a", size: size(100), coupling: coupling(0.5), maintainabilityLevel: 50 }),
      moduleReport({ id: "b", size: size(100), coupling: coupling(0.3), maintainabilityLevel: 50 }),
      moduleReport({ id: "c", size: size(100), coupling: coupling(0.2), maintainabilityLevel: 50 }),
    ];

    const scope = aggregateScope("all", null, null, modules, NO_PARTITIONING, DEFAULT_CONFIG);

    // sum(c_i) = 1.0, k = 3
    expect(scope.meanCoupling).toBeCloseTo(1 / 3, 4);
  });

  it("emits rawCouplingSum and couplingIndex as exact rescalings of meanCoupling", () => {
    const modules = [
      moduleReport({ id: "a", size: size(100), coupling: coupling(0.5), maintainabilityLevel: 50 }),
      moduleReport({ id: "b", size: size(100), coupling: coupling(0.3), maintainabilityLevel: 50 }),
      moduleReport({ id: "c", size: size(100), coupling: coupling(0.2), maintainabilityLevel: 50 }),
    ];

    const scope = aggregateScope("all", null, null, modules, NO_PARTITIONING, DEFAULT_CONFIG);

    // Both are derived views of the same quantity, so they must stay pinned to
    // it - if they ever drift apart the report is showing two different numbers
    // for one measurement, which is the confusion these fields caused before.
    expect(scope.rawCouplingSum).toBeCloseTo(scope.meanCoupling * scope.k, 3);
    expect(scope.couplingIndex).toBeCloseTo(100 * (1 - scope.meanCoupling), 2);
    expect(scope.rawCouplingSum).toBe(1);
    expect(scope.couplingIndex).toBe(66.67);
  });

  it("falls back to the unweighted mean when nothing has any statements", () => {
    const modules = [
      moduleReport({ id: "a", maintainabilityLevel: 60 }),
      moduleReport({ id: "b", maintainabilityLevel: 80 }),
    ];
    const scope = aggregateScope("all", null, null, modules, NO_PARTITIONING, DEFAULT_CONFIG);
    expect(scope.maintainabilityLevel).toBe(70);
  });

  it("handles an empty scope without producing NaN", () => {
    const scope = aggregateScope("all", null, null, [], NO_PARTITIONING, DEFAULT_CONFIG);
    expect(scope.k).toBe(0);
    expect(scope.meanCoupling).toBe(0);
    expect(scope.couplingIndex).toBe(100);
    expect(scope.maintainabilityLevel).toBe(0);
  });
});

describe("refactor ranking", () => {
  it("ranks by the product, so a big-but-isolated module loses to a coupled one", () => {
    const isolated = moduleReport({
      id: "isolated",
      size: size(1000),
      coupling: coupling(0.05),
      blastRadius: { modules: [], moduleCount: 0, ratio: 0.05, statements: 0, statementRatio: 0 },
    });
    const coupled = moduleReport({
      id: "coupled",
      size: size(600),
      coupling: coupling(0.8),
      blastRadius: { modules: [], moduleCount: 3, ratio: 0.8, statements: 0, statementRatio: 0 },
    });

    const ranked = rankRefactorCandidates([isolated, coupled], 10);
    expect(ranked[0]?.moduleId).toBe("coupled");
    expect(ranked[0]?.reason).toContain("changes reach 3 module(s)");
  });

  it("orders equally sized modules by coupling alone", () => {
    const a = moduleReport({ id: "a", size: size(100), coupling: coupling(0.5) });
    const b = moduleReport({ id: "b", size: size(100), coupling: coupling(0.2) });
    const ranked = rankRefactorCandidates([a, b], 10);
    expect(ranked.map((entry) => entry.moduleId)).toEqual(["a", "b"]);
    expect(ranked[0]?.couplingFactor).toBe(0.5);
  });
});
