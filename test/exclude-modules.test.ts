import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.js";
import { ConfigError } from "../src/config/schema.js";
import { selectExcludedModules } from "../src/discovery/exclusions.js";
import type { NestModuleInfo, Report } from "../src/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

function run(fixture: string, excludeModules?: string[]): Promise<Report> {
  return analyze({
    path: path.join(FIXTURES, fixture),
    cache: { enabled: false },
    ...(excludeModules ? { excludeModules } : {}),
  });
}

const names = (report: Report): string[] => report.modules.map((module) => module.name);

function fakeModule(overrides: Partial<NestModuleInfo> & { id: string }): NestModuleInfo {
  return {
    name: "X",
    file: null,
    line: 1,
    kind: "nest",
    global: false,
    dir: "src",
    imports: [],
    exportedModules: [],
    controllers: [],
    providers: [],
    exports: [],
    files: [],
    ...overrides,
  };
}

describe("excludeModules pattern matching", () => {
  const modules = new Map<string, NestModuleInfo>([
    [
      "src/app.module.ts#AppModule",
      fakeModule({ id: "src/app.module.ts#AppModule", name: "AppModule", file: "src/app.module.ts", dir: "src" }),
    ],
    [
      "src/orders/orders.module.ts#OrdersModule",
      fakeModule({
        id: "src/orders/orders.module.ts#OrdersModule",
        name: "OrdersModule",
        file: "src/orders/orders.module.ts",
        dir: "src/orders",
      }),
    ],
    [
      "synthetic:src/common",
      fakeModule({ id: "synthetic:src/common", name: "common/", kind: "synthetic", dir: "src/common" }),
    ],
  ]);

  const match = (pattern: string): string[] =>
    [...selectExcludedModules(modules, [pattern], "test").ids].sort();

  it("matches a module by class name", () => {
    expect(match("AppModule")).toEqual(["src/app.module.ts#AppModule"]);
  });

  it("matches by report id, declaring file and owned directory", () => {
    expect(match("src/app.module.ts#AppModule")).toEqual(["src/app.module.ts#AppModule"]);
    expect(match("**/app.module.ts")).toEqual(["src/app.module.ts#AppModule"]);
    expect(match("src/orders")).toEqual(["src/orders/orders.module.ts#OrdersModule"]);
  });

  it("matches a synthetic pseudo-module with or without its trailing slash", () => {
    expect(match("common/")).toEqual(["synthetic:src/common"]);
    expect(match("common")).toEqual(["synthetic:src/common"]);
  });

  it("matches case-insensitively and supports globs", () => {
    expect(match("appmodule")).toEqual(["src/app.module.ts#AppModule"]);
    expect(match("*Module")).toEqual([
      "src/app.module.ts#AppModule",
      "src/orders/orders.module.ts#OrdersModule",
    ]);
  });

  it("records which pattern claimed each module", () => {
    const { matchedBy } = selectExcludedModules(modules, ["AppModule", "*Module"], "test");
    expect(matchedBy.get("src/app.module.ts#AppModule")).toBe("AppModule");
    expect(matchedBy.get("src/orders/orders.module.ts#OrdersModule")).toBe("*Module");
  });

  it("warns rather than silently doing nothing when a pattern matches no module", () => {
    const { ids, warnings } = selectExcludedModules(modules, ["NopeModule"], "test");
    expect(ids.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("config");
    expect(warnings[0]?.message).toContain("NopeModule");
  });
});

describe("excludeModules end to end", () => {
  it("drops the module, its files and its statements from every figure", async () => {
    const before = await run("domain-partitioned");
    const after = await run("domain-partitioned", ["AppModule"]);

    expect(names(before)).toContain("AppModule");
    expect(names(after)).not.toContain("AppModule");

    const app = before.modules.find((module) => module.name === "AppModule");
    expect(app).toBeDefined();

    expect(after.application.k).toBe(before.application.k - 1);
    expect(after.project.fileCount).toBe(before.project.fileCount - (app?.files.length ?? 0));
    expect(after.application.totalStatements).toBe(
      before.application.totalStatements - (app?.size.statements ?? 0),
    );
    for (const file of after.files) expect(app?.files).not.toContain(file.path);
  });

  it("reports what it left out, with the pattern that did it", async () => {
    const report = await run("domain-partitioned", ["AppModule"]);
    expect(report.excludedModules).toHaveLength(1);
    const [excluded] = report.excludedModules;
    expect(excluded?.name).toBe("AppModule");
    expect(excluded?.pattern).toBe("AppModule");
    expect(excluded?.file).toBe("src/app.module.ts");
    expect(excluded?.statements).toBeGreaterThan(0);
    expect(report.config.excludeModules).toEqual(["AppModule"]);
  });

  it("removes the excluded module from every other module's coupling", async () => {
    const before = await run("domain-partitioned");
    const after = await run("domain-partitioned", ["AppModule"]);
    const appId = before.modules.find((module) => module.name === "AppModule")?.id as string;

    const orders = {
      before: before.modules.find((module) => module.name === "OrdersModule"),
      after: after.modules.find((module) => module.name === "OrdersModule"),
    };
    // The root module imports every feature, so it is afferent to all of them.
    expect(orders.before?.coupling.afferentModules).toContain(appId);
    expect(orders.after?.coupling.afferentModules).not.toContain(appId);
    expect(orders.after?.coupling.Ca).toBe((orders.before?.coupling.Ca ?? 0) - 1);

    for (const module of after.modules) {
      expect(module.coupling.afferentModules).not.toContain(appId);
      expect(module.coupling.efferentModules).not.toContain(appId);
      expect(module.blastRadius.modules).not.toContain(appId);
      expect(module.coupling.k).toBe(after.application.k);
    }
    for (const violation of after.boundaryViolations) {
      expect(violation.fromModule).not.toBe(appId);
      expect(violation.toModule).not.toBe(appId);
    }
  });

  it("keeps the application scopes intact when the excluded module is the root", async () => {
    // AppModule is what wires every feature together. Walking the graph without
    // it must not empty the application it composes.
    const before = await run("domain-partitioned");
    const after = await run("domain-partitioned", ["AppModule"]);

    const scopeBefore = before.applications[0]?.moduleIds ?? [];
    const scopeAfter = after.applications[0]?.moduleIds ?? [];
    const appId = before.modules.find((module) => module.name === "AppModule")?.id as string;

    expect(after.applications).toHaveLength(1);
    expect([...scopeAfter].sort()).toEqual([...scopeBefore].filter((id) => id !== appId).sort());
  });

  it("scopes each entrypoint correctly in a monorepo with both roots excluded", async () => {
    const report = await run("monorepo", ["ApiModule", "WorkerModule"]);
    const nameOf = (id: string) => report.modules.find((module) => module.id === id)?.name;

    expect(names(report)).not.toContain("ApiModule");
    expect(names(report)).not.toContain("WorkerModule");

    const api = report.applications.find((scope) => scope.name === "ApiModule");
    const worker = report.applications.find((scope) => scope.name === "WorkerModule");
    expect(api?.moduleIds.map(nameOf)).toContain("CatalogModule");
    expect(worker?.moduleIds.map(nameOf)).not.toContain("CatalogModule");
    // Both still reach the shared library through the excluded roots.
    expect(api?.moduleIds.map(nameOf)).toContain("LoggerModule");
    expect(worker?.moduleIds.map(nameOf)).toContain("LoggerModule");
  });

  it("excludes a synthetic pseudo-module by folder name", async () => {
    const before = await run("technical-layered");
    const after = await run("technical-layered", ["entities"]);

    expect(names(before)).toContain("entities/");
    expect(names(after)).not.toContain("entities/");

    // The shared entity folder was the most depended-upon node, so every
    // module that reached for it loses an outgoing edge.
    const repos = {
      before: before.modules.find((module) => module.name === "repositories/"),
      after: after.modules.find((module) => module.name === "repositories/"),
    };
    expect(repos.before?.coupling.Ce).toBe(1);
    expect(repos.after?.coupling.Ce).toBe(0);
    expect(after.application.maintainabilityLevel).toBeGreaterThan(
      before.application.maintainabilityLevel,
    );
  });

  it("still renormalises c_i against the smaller k, as the metric defines it", async () => {
    // Worth pinning: `c_i` is a fraction of `k - 1`, so removing a module can
    // raise the remaining coupling levels even though real edges went away.
    // Two runs with different `excludeModules` are not comparable figures.
    const before = await run("technical-layered");
    const after = await run("technical-layered", ["entities"]);
    expect(after.application.k).toBe(before.application.k - 1);
    for (const module of after.modules) expect(module.coupling.k).toBe(after.application.k);
  });

  it("leaves the report untouched when the list is empty", async () => {
    const plain = await run("circular");
    const empty = await run("circular", []);
    expect(empty.excludedModules).toEqual([]);
    expect(empty.application).toEqual(plain.application);
  });

  it("surfaces a typo as a warning instead of quietly scoring everything", async () => {
    const report = await run("circular", ["NoSuchModule"]);
    expect(report.excludedModules).toEqual([]);
    expect(
      report.warnings.some(
        (warning) => warning.code === "config" && warning.message.includes("NoSuchModule"),
      ),
    ).toBe(true);
  });

  it("refuses to produce a report with nothing left in it", async () => {
    await expect(run("circular", ["*"])).rejects.toThrow(ConfigError);
    await expect(run("circular", ["*"])).rejects.toThrow(/leaving nothing to score/);
  });

  it("stays deterministic", async () => {
    const first = await run("technical-layered", ["AppModule", "entities"]);
    const second = await run("technical-layered", ["entities", "AppModule"]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
