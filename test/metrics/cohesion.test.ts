import { describe, expect, it } from "vitest";
import { computeCohesion } from "../../src/metrics/cohesion.js";
import { computeLcom4, computeModuleLcom4 } from "../../src/metrics/lcom4.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { resolveConfig } from "../../src/config/schema.js";
import { buildFixture, makeClass } from "../helpers/graph.js";

describe("structural cohesion", () => {
  it("is internal / (internal + external)", () => {
    // orders has two internal edges (a->b, b->c) and one edge out to users.
    // cohesion = 2 / (2 + 1) = 0.6667
    const fixture = buildFixture({
      modules: {
        orders: { files: { "a.ts": 1, "b.ts": 1, "c.ts": 1 } },
        users: { files: { "a.ts": 1 } },
      },
      deps: ["orders/a.ts -> orders/b.ts", "orders/b.ts -> orders/c.ts", "orders/a.ts -> users/a.ts"],
    });

    const cohesion = computeCohesion("orders", fixture.graph, [], fixture.config);
    expect(cohesion.internalEdges).toBe(2);
    expect(cohesion.externalEdges).toBe(1);
    expect(cohesion.structural).toBe(0.6667);
  });

  it("counts an incoming cross-module edge against the target too", () => {
    // users has no internal edges and one edge crossing its boundary (incoming).
    // cohesion = 0 / (0 + 1) = 0
    const fixture = buildFixture({
      modules: { orders: { files: { "a.ts": 1 } }, users: { files: { "a.ts": 1 } } },
      deps: ["orders/a.ts -> users/a.ts"],
    });

    const users = computeCohesion("users", fixture.graph, [], fixture.config);
    expect(users.internalEdges).toBe(0);
    expect(users.externalEdges).toBe(1);
    expect(users.structural).toBe(0);
  });

  it("returns 1 for a module with no dependencies at all", () => {
    // A single self-contained file is perfectly cohesive. Scoring it 0 would
    // punish exactly the thing the metric rewards.
    const fixture = buildFixture({ modules: { alone: { files: { "a.ts": 3 } } } });
    const cohesion = computeCohesion("alone", fixture.graph, [], fixture.config);
    expect(cohesion.structural).toBe(1);
  });

  it("discounts type-only edges by typeOnlyEdgeWeight", () => {
    // One internal value edge (1.0) and one external type-only edge at 0.25.
    // cohesion = 1 / (1 + 0.25) = 0.8
    const fixture = buildFixture({
      modules: {
        orders: { files: { "a.ts": 1, "b.ts": 1 } },
        shared: { files: { "t.ts": 1 } },
      },
      deps: ["orders/a.ts -> orders/b.ts", "orders/a.ts -> shared/t.ts"],
      typeOnly: ["orders/a.ts -> shared/t.ts"],
      config: { graph: { typeOnlyEdgeWeight: 0.25 } },
    });

    const cohesion = computeCohesion("orders", fixture.graph, [], fixture.config);
    expect(cohesion.internalEdges).toBe(1);
    expect(cohesion.externalEdges).toBe(0.25);
    expect(cohesion.structural).toBe(0.8);
  });
});

describe("LCOM4", () => {
  it("is 1 when every member is reachable from every other", () => {
    //   save -> rows, find -> rows  =>  one component {find, rows, save}
    const { lcom4, components } = computeLcom4(
      {
        methods: ["find", "save"],
        fields: ["rows"],
        edges: [
          ["rows", "save"],
          ["find", "rows"],
        ],
      },
      { excludeConstructor: true },
    );
    expect(lcom4).toBe(1);
    expect(components).toEqual([["find", "rows", "save"]]);
  });

  it("counts the disconnected halves of a class doing two jobs", () => {
    //   sendMail -> mailer      component 1
    //   chargeCard -> gateway   component 2
    const { lcom4, components } = computeLcom4(
      {
        methods: ["chargeCard", "sendMail"],
        fields: ["gateway", "mailer"],
        edges: [
          ["mailer", "sendMail"],
          ["chargeCard", "gateway"],
        ],
      },
      { excludeConstructor: true },
    );
    expect(lcom4).toBe(2);
    expect(components).toEqual([
      ["chargeCard", "gateway"],
      ["mailer", "sendMail"],
    ]);
  });

  it("excludes the constructor by default, because Nest wires every field through it", () => {
    const members = {
      methods: ["constructor", "a", "b"],
      fields: ["x", "y"],
      edges: [
        ["constructor", "x"] as [string, string],
        ["constructor", "y"] as [string, string],
        ["a", "x"] as [string, string],
        ["b", "y"] as [string, string],
      ],
    };

    // Including it, everything is joined through the constructor: LCOM4 = 1.
    expect(computeLcom4(members, { excludeConstructor: false }).lcom4).toBe(1);
    // Excluding it, the two real responsibilities separate: LCOM4 = 2.
    expect(computeLcom4(members, { excludeConstructor: true }).lcom4).toBe(2);
  });

  it("treats a class with no members as cohesive rather than as zero components", () => {
    expect(computeLcom4({ methods: [], fields: [], edges: [] }, { excludeConstructor: true }).lcom4).toBe(1);
  });

  it("counts an unused field as its own component", () => {
    const { lcom4 } = computeLcom4(
      { methods: ["run"], fields: ["used", "unused"], edges: [["run", "used"]] },
      { excludeConstructor: true },
    );
    expect(lcom4).toBe(2);
  });

  it("excludes classes below minMethods from the module aggregate", () => {
    const dto = makeClass("CreateOrderDto", { fields: ["a", "b", "c"], methods: [] });
    const service = makeClass("OrdersService", {
      methods: ["one", "two"],
      fields: ["x", "y"],
      edges: [
        ["one", "x"],
        ["two", "y"],
      ],
    });

    const results = computeModuleLcom4([dto, service], DEFAULT_CONFIG);
    const byName = Object.fromEntries(results.map((entry) => [entry.class, entry]));

    // The DTO would score 3 on raw LCOM4 but has no behaviour to be cohesive about.
    expect(byName.CreateOrderDto?.counted).toBe(false);
    expect(byName.OrdersService?.counted).toBe(true);
    expect(byName.OrdersService?.lcom4).toBe(2);
  });

  it("excludes an entity by its decorator, whatever the class is called", () => {
    // A bag of columns has one component per column and nothing to fix.
    const entity = {
      ...makeClass("User", { fields: ["email", "id", "name"], methods: ["a", "b"] }),
      decorators: ["Entity"],
      isEntity: true,
    };

    const [result] = computeModuleLcom4([entity], DEFAULT_CONFIG);
    expect(result?.lcom4).toBe(5);
    expect(result?.counted).toBe(false);
    expect(result?.excludedBy).toBe("decorator");
  });

  it("excludes a repository by class name and by file, not just by decorator", () => {
    // A repository is a fan of independent queries over one table by design.
    const byName = makeClass("UsersRepository", {
      methods: ["findById", "findByEmail"],
      fields: [],
    });
    const byFile = makeClass(
      "UserStore",
      { methods: ["findById", "findByEmail"], fields: [] },
      "src/users/repositories/user.repository.ts",
    );

    const results = computeModuleLcom4([byName, byFile], DEFAULT_CONFIG);
    const seen = Object.fromEntries(results.map((entry) => [entry.class, entry]));
    expect(seen.UsersRepository?.excludedBy).toBe("class");
    expect(seen.UserStore?.excludedBy).toBe("file");
  });

  it("keeps a service that merely lives next to the repositories", () => {
    const service = makeClass(
      "OrdersService",
      { methods: ["one", "two"], fields: ["x", "y"], edges: [["one", "x"], ["two", "y"]] },
      "src/orders/orders.service.ts",
    );

    const [result] = computeModuleLcom4([service], DEFAULT_CONFIG);
    expect(result?.counted).toBe(true);
    expect(result?.excludedBy).toBe(null);
    expect(result?.lcom4).toBe(2);
  });

  it("lets the exclusion lists be replaced from config", () => {
    // Arrays replace wholesale, so an empty list opts back in to everything.
    const { config } = resolveConfig(
      { lcom4: { excludeClasses: [], excludeFiles: [], excludeDecorators: [] } },
      "test",
    );
    const repository = makeClass("UsersRepository", {
      methods: ["findById", "findByEmail"],
      fields: [],
    });

    const [result] = computeModuleLcom4([repository], config);
    expect(result?.counted).toBe(true);
    expect(result?.lcom4).toBe(2);
  });

  it("keeps entities and repositories out of the module aggregate", () => {
    const entity = {
      ...makeClass("Order", { fields: ["id", "total"], methods: ["a", "b"] }),
      decorators: ["Entity"],
      isEntity: true,
    };
    const service = makeClass("OrdersService", {
      methods: ["one", "two"],
      fields: ["x"],
      edges: [
        ["one", "x"],
        ["two", "x"],
      ],
    });

    const fixture = buildFixture({ modules: { orders: { files: { "a.ts": 1 } } } });
    const cohesion = computeCohesion("orders", fixture.graph, [entity, service], fixture.config);
    // Without the exclusion the entity's 4 components would be the headline.
    expect(cohesion.lcom4Max).toBe(1);
    expect(cohesion.lcom4Mean).toBe(1);
  });

  it("reports lcom4Max 1 for a module whose classes are all excluded", () => {
    const dto = makeClass("Dto", { fields: ["a"], methods: [] });
    const fixture = buildFixture({ modules: { m: { files: { "a.ts": 1 } } } });
    const cohesion = computeCohesion("m", fixture.graph, [dto], fixture.config);
    expect(cohesion.lcom4Max).toBe(1);
    expect(cohesion.lcom4Mean).toBe(1);
  });
});
