import { describe, expect, it } from "vitest";
import {
  classifyModule,
  classifyName,
  computeAppPartitioning,
  computeModulePartitioning,
} from "../../src/metrics/partitioning.js";
import { computeSize } from "../../src/metrics/size.js";
import { DEFAULT_CONFIG, DEFAULT_TECHNICAL_NAMES } from "../../src/config/defaults.js";
import { buildFixture } from "../helpers/graph.js";
import type { FileNode } from "../../src/types.js";

const TECHNICAL = new Set(DEFAULT_TECHNICAL_NAMES);

describe("name classification", () => {
  it("recognises technical-layer names in either spelling", () => {
    expect(classifyName("services", TECHNICAL)).toBe("technical");
    expect(classifyName("service", TECHNICAL)).toBe("technical");
    expect(classifyName("Repositories", TECHNICAL)).toBe("technical");
  });

  it("treats anything else as a domain name", () => {
    expect(classifyName("orders", TECHNICAL)).toBe("domain");
    expect(classifyName("wishlist", TECHNICAL)).toBe("domain");
  });

  it("classifies a module by its folder or its bare class name", () => {
    const fixture = buildFixture({
      modules: {
        CommonModule: { dir: "src/common" },
        OrdersModule: { dir: "src/orders" },
      },
    });
    expect(classifyModule(fixture.modules.get("CommonModule")!, TECHNICAL)).toBe("technical");
    expect(classifyModule(fixture.modules.get("OrdersModule")!, TECHNICAL)).toBe("domain");
  });
});

describe("application partitioning", () => {
  it("calls an all-technical top level technical, with high confidence", () => {
    const result = computeAppPartitioning(
      ["controllers", "services", "repositories", "entities", "dtos"],
      DEFAULT_CONFIG,
    );
    expect(result.verdict).toBe("technical");
    expect(result.technicalRatio).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("calls a domain top level domain", () => {
    // 1 technical of 4 = 0.25, which is exactly the domainVerdictBelow boundary.
    const result = computeAppPartitioning(["orders", "billing", "wishlist", "common"], DEFAULT_CONFIG);
    expect(result.verdict).toBe("domain");
    expect(result.technicalRatio).toBe(0.25);
  });

  it("calls an even split mixed", () => {
    const result = computeAppPartitioning(["orders", "billing", "services", "utils"], DEFAULT_CONFIG);
    expect(result.verdict).toBe("mixed");
  });

  it("never claims certainty, and scales confidence down on a small sample", () => {
    const tiny = computeAppPartitioning(["services"], DEFAULT_CONFIG);
    const large = computeAppPartitioning(
      ["services", "controllers", "dtos", "entities", "utils", "guards"],
      DEFAULT_CONFIG,
    );
    expect(tiny.confidence).toBeLessThan(large.confidence);
    expect(large.confidence).toBeLessThanOrEqual(0.95);
  });

  it("says so rather than guessing when there is nothing to judge", () => {
    const result = computeAppPartitioning([], DEFAULT_CONFIG);
    expect(result.confidence).toBe(0);
    expect(result.note).toMatch(/could not be judged/);
  });
});

describe("module domain alignment", () => {
  it("is 1 when every dependency lands on a domain peer", () => {
    const fixture = buildFixture({
      modules: {
        orders: { files: { "a.ts": 1 } },
        users: { files: { "a.ts": 1 } },
      },
      deps: ["orders/a.ts -> users/a.ts"],
    });

    const result = computeModulePartitioning("orders", fixture.graph, () => "domain", fixture.scope);
    expect(result.domainAlignment).toBe(1);
    expect(result.domainEdges).toBe(1);
    expect(result.technicalEdges).toBe(0);
  });

  it("falls to 0 when a module's behaviour is smeared across layers", () => {
    const fixture = buildFixture({
      modules: {
        controllers: { files: { "a.ts": 1 } },
        services: { files: { "a.ts": 1 } },
        dtos: { files: { "a.ts": 1 } },
      },
      deps: ["controllers/a.ts -> services/a.ts", "controllers/a.ts -> dtos/a.ts"],
    });

    const result = computeModulePartitioning(
      "controllers",
      fixture.graph,
      () => "technical",
      fixture.scope,
    );
    expect(result.domainAlignment).toBe(0);
    expect(result.technicalEdges).toBe(2);
  });

  it("gives a module with no outgoing edges the benefit of the doubt", () => {
    const fixture = buildFixture({ modules: { alone: { files: { "a.ts": 1 } } } });
    const result = computeModulePartitioning("alone", fixture.graph, () => "domain", fixture.scope);
    expect(result.domainAlignment).toBe(1);
    // ...but with the lowest confidence, since there was no evidence either way.
    expect(result.confidence).toBe(0.4);
  });
});

describe("size", () => {
  const file = (path: string, statements: number): FileNode => ({
    path,
    moduleId: "m",
    foreign: false,
    statements,
    classes: [],
    abstractions: 0,
    concretions: 1,
    parseErrors: 0,
  });

  it("totals statements and names the largest file", () => {
    const result = computeSize([file("a.ts", 10), file("b.ts", 40), file("c.ts", 25)]);
    expect(result.statements).toBe(75);
    expect(result.files).toBe(3);
    expect(result.meanStatementsPerFile).toBe(25);
    expect(result.largestFile).toEqual({ path: "b.ts", statements: 40 });
  });

  it("handles an empty module without dividing by zero", () => {
    const result = computeSize([]);
    expect(result).toEqual({ statements: 0, files: 0, meanStatementsPerFile: 0, largestFile: null });
  });
});
