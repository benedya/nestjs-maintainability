import { describe, expect, it } from "vitest";
import { cycleId, findCycles } from "../../src/graph/cycles.js";
import { visibleModules } from "../../src/graph/module-graph.js";
import { buildFixture } from "../helpers/graph.js";
import type { NestModuleInfo } from "../../src/types.js";

function edges(map: Record<string, string[]>) {
  return (node: string): string[] => map[node] ?? [];
}

describe("findCycles", () => {
  it("finds nothing in an acyclic graph", () => {
    expect(findCycles(["a", "b", "c"], edges({ a: ["b"], b: ["c"] }))).toEqual([]);
  });

  it("finds a two-node cycle", () => {
    expect(findCycles(["a", "b"], edges({ a: ["b"], b: ["a"] }))).toEqual([["a", "b"]]);
  });

  it("finds a longer cycle and excludes the nodes hanging off it", () => {
    const cycles = findCycles(
      ["a", "b", "c", "d"],
      edges({ a: ["b"], b: ["c"], c: ["a"], d: ["a"] }),
    );
    expect(cycles).toEqual([["a", "b", "c"]]);
  });

  it("finds several independent cycles", () => {
    const cycles = findCycles(
      ["a", "b", "c", "d"],
      edges({ a: ["b"], b: ["a"], c: ["d"], d: ["c"] }),
    );
    expect(cycles).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reports a self-edge but not a lone node", () => {
    expect(findCycles(["a"], edges({ a: ["a"] }))).toEqual([["a"]]);
    expect(findCycles(["a"], edges({}))).toEqual([]);
  });

  it("survives a deep chain without blowing the stack", () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) => `n${index}`);
    const map: Record<string, string[]> = {};
    for (let i = 0; i < nodes.length - 1; i++) map[nodes[i] as string] = [nodes[i + 1] as string];
    map[nodes[nodes.length - 1] as string] = [nodes[0] as string]; // close the loop

    const cycles = findCycles(nodes, edges(map));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(20_000);
  });

  it("produces the same id regardless of which member is listed first", () => {
    expect(cycleId("module", ["b", "a"])).toBe(cycleId("module", ["a", "b"]));
  });
});

describe("module visibility", () => {
  const modules = (spec: Record<string, { imports?: string[]; exports?: string[]; global?: boolean }>) => {
    const fixture = buildFixture({
      modules: Object.fromEntries(
        Object.entries(spec).map(([id, value]) => [
          id,
          {
            imports: value.imports ?? [],
            exportedModules: value.exports ?? [],
            global: value.global ?? false,
          },
        ]),
      ),
    });
    return fixture.modules as ReadonlyMap<string, NestModuleInfo>;
  };

  it("includes a module's own declared imports", () => {
    const map = modules({ a: { imports: ["b"] }, b: {} });
    expect([...visibleModules("a", map, true)].sort()).toEqual(["a", "b"]);
  });

  it("follows a re-export chain, because Nest does", () => {
    // a imports b; b re-exports c. `a` may legitimately use c's providers.
    const map = modules({ a: { imports: ["b"] }, b: { exports: ["c"] }, c: {} });
    expect([...visibleModules("a", map, true)].sort()).toEqual(["a", "b", "c"]);
  });

  it("includes every @Global module", () => {
    const map = modules({ a: {}, config: { global: true } });
    expect(visibleModules("a", map, true).has("config")).toBe(true);
  });

  it("can be told to ignore globals", () => {
    const map = modules({ a: {}, config: { global: true } });
    expect(visibleModules("a", map, false).has("config")).toBe(false);
  });

  it("terminates on a re-export cycle", () => {
    const map = modules({ a: { imports: ["b"] }, b: { exports: ["c"] }, c: { exports: ["b"] } });
    expect([...visibleModules("a", map, false)].sort()).toEqual(["a", "b", "c"]);
  });
});
