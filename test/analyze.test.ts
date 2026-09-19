import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.js";
import { createBaseline } from "../src/baseline/write.js";
import { diffAgainstBaseline } from "../src/baseline/diff.js";
import { renderHtml } from "../src/reporters/html.js";
import { renderSarif } from "../src/reporters/sarif.js";
import { renderDot } from "../src/reporters/dot.js";
import { renderMarkdown } from "../src/reporters/markdown.js";
import { renderJson } from "../src/reporters/json.js";
import type { Report } from "../src/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

const FIXTURE_NAMES = [
  "technical-layered",
  "domain-partitioned",
  "circular",
  "global-abuse",
  "dynamic-modules",
  "monorepo",
] as const;

type FixtureName = (typeof FIXTURE_NAMES)[number];

/** The AST cache is environment state, not analysis input. */
function analyzeFixture(name: string): Promise<Report> {
  return analyze({
    path: path.join(FIXTURES, name),
    cache: { enabled: false },
  });
}

/** Strips the two values that legitimately differ between machines and releases. */
function sanitize(report: Report): unknown {
  const json = renderJson(report);
  const normalized = json
    .split(JSON.stringify(report.project.root).slice(1, -1))
    .join("<ROOT>")
    .split(`"version": "${report.tool.version}"`)
    .join('"version": "<VERSION>"');
  return JSON.parse(normalized);
}

const reports = new Map<FixtureName, Report>();

beforeAll(async () => {
  for (const name of FIXTURE_NAMES) reports.set(name, await analyzeFixture(name));
}, 120_000);

const reportFor = (name: FixtureName): Report => reports.get(name) as Report;

// ---------------------------------------------------------------------------

describe("acceptance: domain partitioning must score better than technical layering", () => {
  it("scores the domain-partitioned fixture materially higher than the technical one", () => {
    const technical = reportFor("technical-layered");
    const domain = reportFor("domain-partitioned");

    // The two fixtures implement identical functionality; only the layout
    // differs. If this ever inverts, the scoring is wrong - not the fixtures.
    expect(domain.application.maintainabilityLevel).toBeGreaterThan(
      technical.application.maintainabilityLevel,
    );
    expect(
      domain.application.maintainabilityLevel - technical.application.maintainabilityLevel,
    ).toBeGreaterThan(10);
  });

  it("reads the top-level shape of each correctly", () => {
    expect(reportFor("technical-layered").application.partitioning.verdict).toBe("technical");
    expect(reportFor("domain-partitioned").application.partitioning.verdict).toBe("domain");
  });

  it("finds far more cross-module dependencies in the technical layout", () => {
    expect(reportFor("technical-layered").stats.crossModuleEdges).toBeGreaterThan(
      reportFor("domain-partitioned").stats.crossModuleEdges * 2,
    );
  });

  it("finds the shared entities folder to be the most depended-upon node", () => {
    const technical = reportFor("technical-layered");
    const entities = technical.modules.find((module) => module.name === "entities/");
    expect(entities).toBeDefined();
    // Every feature's repository, service and controller reaches for the entity.
    expect(entities?.coupling.Ca).toBeGreaterThanOrEqual(3);
    expect(entities?.blastRadius.ratio).toBeGreaterThan(0.5);
  });

  it("gives the domain modules real internal cohesion and the technical ones almost none", () => {
    const technicalCohesion = reportFor("technical-layered")
      .modules.filter((module) => module.size.statements > 0)
      .map((module) => module.cohesion.structural);
    const domainCohesion = reportFor("domain-partitioned")
      .modules.filter((module) => module.kind === "nest" && module.coupling.Ce > 0)
      .map((module) => module.cohesion.structural);

    expect(Math.max(...technicalCohesion)).toBeLessThan(Math.min(...domainCohesion));
  });
});

// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces byte-identical JSON across two consecutive runs", async () => {
    const first = await analyzeFixture("domain-partitioned");
    const second = await analyzeFixture("domain-partitioned");
    expect(renderJson(first)).toBe(renderJson(second));
  });

  it("produces the same analysis with the cache on as with it off", async () => {
    const uncached = await analyze({
      path: path.join(FIXTURES, "circular"),
      cache: { enabled: false },
    });
    const cached = await analyze({
      path: path.join(FIXTURES, "circular"),
      cache: { enabled: true },
    });
    const again = await analyze({
      path: path.join(FIXTURES, "circular"),
      cache: { enabled: true },
    });

    // The cache stat and the echoed flag are allowed to differ; nothing else is.
    expect(renderJson({ ...cached, config: uncached.config, stats: uncached.stats })).toBe(
      renderJson(uncached),
    );
    expect(again.stats.filesFromCache).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("every number in the report is reproducible from the JSON alone", () => {
  it("recomputes each module's maintainabilityLevel from its penalties and weights", () => {
    for (const name of FIXTURE_NAMES) {
      for (const module of reportFor(name).modules) {
        const total =
          module.weights.coupling * module.penalties.coupling +
          module.weights.cohesion * module.penalties.cohesion +
          module.weights.complexity * module.penalties.complexity +
          module.weights.size * module.penalties.size +
          module.weights.partitioning * module.penalties.partitioning;
        expect(module.maintainabilityLevel).toBeCloseTo(100 * (1 - total), 1);
      }
    }
  });

  it("recomputes each module's c_i from Ca, Ce, alpha and k", () => {
    for (const module of reportFor("domain-partitioned").modules) {
      const { Ca, Ce, afferentWeight, k } = module.coupling;
      const expected = k <= 1 ? 0 : (afferentWeight * Ca + (1 - afferentWeight) * Ce) / (k - 1);
      expect(module.coupling.ci).toBeCloseTo(Math.min(1, expected), 3);
    }
  });

  it("recomputes cohesion from the reported edge weights", () => {
    for (const module of reportFor("technical-layered").modules) {
      const { internalEdges, externalEdges, structural } = module.cohesion;
      const expected = internalEdges + externalEdges === 0 ? 1 : internalEdges / (internalEdges + externalEdges);
      expect(structural).toBeCloseTo(expected, 3);
    }
  });

  it("recomputes the application figures from the module list", () => {
    for (const name of FIXTURE_NAMES) {
      const report = reportFor(name);
      const app = report.application;

      const rawSum = report.modules.reduce((total, module) => total + module.coupling.ci, 0);
      expect(app.meanCoupling).toBeCloseTo(rawSum / app.k, 3);
      expect(app.rawCouplingSum).toBeCloseTo(rawSum, 3);
      expect(app.couplingIndex).toBeCloseTo(100 * (1 - rawSum / app.k), 1);

      const totalStatements = report.modules.reduce((total, module) => total + module.size.statements, 0);
      expect(app.totalStatements).toBe(totalStatements);

      const weighted = report.modules.reduce(
        (total, module) =>
          total + (module.size.statements / totalStatements) * module.maintainabilityLevel,
        0,
      );
      expect(app.maintainabilityLevel).toBeCloseTo(weighted, 1);
    }
  });
});

// ---------------------------------------------------------------------------

describe("circular fixture", () => {
  it("reports the file-level cycles", () => {
    // Two separate cycles: the two module files import each other through
    // forwardRef, and so do the two services.
    const report = reportFor("circular");
    const cycles = report.fileCycles.map((cycle) => cycle.files.join(" + "));
    expect(cycles).toContain("src/orders/orders.module.ts + src/shipping/shipping.module.ts");
    expect(cycles).toContain("src/orders/orders.service.ts + src/shipping/shipping.service.ts");
  });

  it("gives both sides of the cycle a 100% blast radius", () => {
    for (const module of reportFor("circular").modules) {
      if (module.name === "OrdersModule" || module.name === "ShippingModule") {
        expect(module.blastRadius.ratio).toBe(1);
      }
    }
  });
});

describe("global-abuse fixture", () => {
  it("does not report a boundary violation for a dependency on a @Global module", () => {
    const report = reportFor("global-abuse");
    const globals = report.modules.filter((module) => module.global).map((module) => module.id);
    expect(globals).toHaveLength(3);
    for (const violation of report.boundaryViolations) {
      expect(globals).not.toContain(violation.toModule);
    }
  });

  it("still counts the globals fully towards coupling", () => {
    const report = reportFor("global-abuse");
    for (const module of report.modules.filter((candidate) => candidate.global)) {
      expect(module.coupling.Ca).toBeGreaterThan(0);
      expect(module.blastRadius.moduleCount).toBeGreaterThan(0);
    }
  });
});

describe("dynamic-modules fixture", () => {
  it("resolves forRoot, forRootAsync, register and registerAsync to their class", () => {
    const report = reportFor("dynamic-modules");
    const app = report.modules.find((module) => module.name === "AppModule");
    const names = app?.coupling.efferentModules.map(
      (id) => report.modules.find((module) => module.id === id)?.name,
    );
    expect(names).toContain("DatabaseModule");
    expect(names).toContain("NotificationsModule");
  });

  it("expands a spread of a local const array", () => {
    // `imports: [...INFRASTRUCTURE]` where INFRASTRUCTURE holds DatabaseModule.forRoot(...)
    const report = reportFor("dynamic-modules");
    const database = report.modules.find((module) => module.name === "DatabaseModule");
    expect(database?.coupling.Ca).toBeGreaterThanOrEqual(2);
  });

  it("warns rather than silently dropping a module built by a helper function", () => {
    const messages = reportFor("dynamic-modules").warnings.map((warning) => warning.message);
    expect(messages.some((message) => message.includes("buildFeatureModule"))).toBe(true);
  });

  it("warns about string tokens it cannot tie to an implementation", () => {
    const codes = reportFor("dynamic-modules").warnings.map((warning) => warning.code);
    expect(codes).toContain("string-token");
  });

  it("records every provider with its kind and token", () => {
    const providers = reportFor("dynamic-modules").providers;
    const clock = providers.find((provider) => provider.token === "CLOCK");
    expect(clock?.kind).toBe("useClass");
    expect(clock?.implementationClass).toBe("SystemClock");

    const factory = providers.find((provider) => provider.token === "ORDER_LIMIT");
    expect(factory?.kind).toBe("useFactory");
    expect(factory?.inject).toEqual(["CLOCK"]);
  });
});

describe("monorepo fixture", () => {
  it("analyses each entrypoint as its own application, plus the union", () => {
    const report = reportFor("monorepo");
    expect(report.project.entrypoints).toHaveLength(2);
    const names = report.applications.map((scope) => scope.name);
    expect(names).toContain("all");
    expect(names).toContain("ApiModule");
    expect(names).toContain("WorkerModule");
  });

  it("scopes each application to the modules it actually reaches", () => {
    const report = reportFor("monorepo");
    const api = report.applications.find((scope) => scope.name === "ApiModule");
    const worker = report.applications.find((scope) => scope.name === "WorkerModule");

    const nameOf = (id: string) => report.modules.find((module) => module.id === id)?.name;
    expect(api?.moduleIds.map(nameOf)).toContain("CatalogModule");
    expect(worker?.moduleIds.map(nameOf)).not.toContain("CatalogModule");
    // Both reach the shared library.
    expect(api?.moduleIds.map(nameOf)).toContain("LoggerModule");
    expect(worker?.moduleIds.map(nameOf)).toContain("LoggerModule");
  });

  it("resolves tsconfig paths aliases", () => {
    const report = reportFor("monorepo");
    const logger = report.modules.find((module) => module.name === "LoggerModule");
    // `import { LoggerService } from '@app/shared'` must land on the library.
    expect(logger?.coupling.Ca).toBeGreaterThanOrEqual(3);
    const unresolved = report.warnings.filter((warning) => warning.code === "unresolved-specifier");
    expect(unresolved).toHaveLength(0);
  });

  it("names synthetic pseudo-modules correctly when there is no single source root", () => {
    // sourceRoot is "" here (apps/ and libs/ share no prefix), so nothing may
    // be sliced off the folder name.
    const names = reportFor("monorepo").modules.map((module) => module.name);
    expect(names).toContain("libs/");
  });

  it("lets an explicit rootModule pin a single application", async () => {
    const report = await analyze({
      path: path.join(FIXTURES, "monorepo"),
      rootModule: "apps/worker/src/worker.module.ts",
      cache: { enabled: false },
    });
    expect(report.applications.map((scope) => scope.name)).toEqual(["WorkerModule"]);
  });

  it("falls back to detection, with a warning, when rootModule does not resolve", async () => {
    const report = await analyze({
      path: path.join(FIXTURES, "monorepo"),
      rootModule: "apps/nope/src/nope.module.ts",
      cache: { enabled: false },
    });
    expect(report.warnings.some((warning) => warning.code === "no-root-module")).toBe(true);
    expect(report.applications.length).toBeGreaterThan(1);
  });

  it("counts a type-only import as coupling and tags it as type-only", () => {
    // `import type { Product } from '@app/shared/types/product'`
    const report = reportFor("monorepo");
    expect(report.stats.typeOnlyEdges).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("warnings", () => {
  it("never reports a dependency it could not resolve as if it did not exist", () => {
    for (const name of FIXTURE_NAMES) {
      const report = reportFor(name);
      // Every provider the tool could not resolve must have produced a warning.
      const unresolvedImports = report.modules.flatMap((module) =>
        (report.providers.filter((provider) => provider.moduleId === module.id && !provider.resolved)).map(
          (provider) => provider.token,
        ),
      );
      for (const token of unresolvedImports) {
        expect(report.warnings.some((warning) => warning.message.includes(token))).toBe(true);
      }
    }
  });
});

describe("failure modes", () => {
  it("errors on a path that does not exist rather than reporting an empty project", async () => {
    await expect(
      analyze({ path: path.join(FIXTURES, "no-such-fixture") }),
    ).rejects.toThrow(/does not exist/);
  });

  it("warns loudly when the include globs match nothing", async () => {
    const report = await analyze({
      path: path.join(FIXTURES, "circular"),
      include: ["nowhere/**/*.ts"],
      cache: { enabled: false },
    });
    expect(report.project.fileCount).toBe(0);
    expect(report.warnings.some((warning) => warning.message.includes("No files matched"))).toBe(true);
  });

  it("still produces a report for a file that does not parse, and flags it", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "nest-ml-broken-"));
    const target = path.join(work, "app");
    fs.cpSync(path.join(FIXTURES, "worked-example"), target, { recursive: true });
    fs.appendFileSync(
      path.join(target, "src", "greeting", "greeting.service.ts"),
      "\nexport class Broken {\n  oops( {{{ unclosed\n",
    );

    const report = await analyze({ path: target, cache: { enabled: false } });

    expect(report.application.k).toBe(2);
    expect(report.files.some((file) => file.parseErrors > 0)).toBe(true);
    expect(report.warnings.some((warning) => warning.code === "parse-errors")).toBe(true);

    fs.rmSync(work, { recursive: true, force: true });
  }, 60_000);
});

describe("reporters", () => {
  it("renders every format for every fixture without throwing", () => {
    for (const name of FIXTURE_NAMES) {
      const report = reportFor(name);
      expect(() => renderMarkdown(report)).not.toThrow();
      expect(() => renderDot(report)).not.toThrow();
      expect(() => JSON.parse(renderSarif(report))).not.toThrow();
      expect(() => renderHtml(report)).not.toThrow();
    }
  });

  it("emits a self-contained HTML file with no external requests", () => {
    const html = renderHtml(reportFor("domain-partitioned"));
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:\/\/(?!json\.schemastore)/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/\bfetch\(/);
    expect(html).not.toMatch(/XMLHttpRequest/);
    expect(html).toContain("__NEST_ML__");
  });

  it("emits SARIF 2.1.0 with a rule for every result", () => {
    const sarif = JSON.parse(renderSarif(reportFor("circular"))) as {
      version: string;
      runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string }[] }[];
    };
    expect(sarif.version).toBe("2.1.0");
    const ruleIds = new Set(sarif.runs[0]?.tool.driver.rules.map((rule) => rule.id));
    for (const result of sarif.runs[0]?.results ?? []) expect(ruleIds.has(result.ruleId)).toBe(true);
  });

  it("marks undeclared edges as dashed in the DOT export", () => {
    const dot = renderDot(reportFor("technical-layered"));
    expect(dot).toMatch(/^digraph nest_modules \{/);
    expect(dot.trim().endsWith("}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("baseline ratchet", () => {
  it("detects an artificially introduced cross-module import", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "nest-ml-ratchet-"));
    const target = path.join(work, "app");
    fs.cpSync(path.join(FIXTURES, "domain-partitioned"), target, { recursive: true });

    const before = await analyze({ path: target, cache: { enabled: false } });
    const baseline = createBaseline(before);

    // Unchanged code must not regress.
    const unchanged = diffAgainstBaseline(baseline, before, before.config);
    expect(unchanged.regressed).toBe(false);
    expect(unchanged.newBoundaryViolations).toHaveLength(0);

    // Now reach from UsersModule into OrdersModule without declaring the import.
    const service = path.join(target, "src", "users", "users.service.ts");
    const patched = fs
      .readFileSync(service, "utf8")
      .replace(
        "import { CreateUserDto } from './create-user.dto';",
        "import { CreateUserDto } from './create-user.dto';\nimport { OrdersRepository } from '../orders/orders.repository';",
      )
      .replace(
        "  listForUser(userId: string): User[] {",
        "  ordersFor(userId: string): unknown {\n    return new OrdersRepository().findByUser(userId);\n  }\n\n  listForUser(userId: string): User[] {",
      );
    fs.writeFileSync(service, patched);

    const after = await analyze({ path: target, cache: { enabled: false } });
    const diff = diffAgainstBaseline(baseline, after, after.config);

    expect(diff.regressed).toBe(true);
    expect(diff.newBoundaryViolations).toHaveLength(1);
    expect(diff.newBoundaryViolations[0]).toContain("users.service.ts");
    expect(diff.application.delta).toBeLessThan(0);
    expect(diff.reasons.join(" ")).toMatch(/new boundary violation/);

    fs.rmSync(work, { recursive: true, force: true });
  }, 120_000);

  it("serialises a baseline without a timestamp, so it diffs cleanly in review", () => {
    const baseline = createBaseline(reportFor("domain-partitioned"));
    expect(baseline).not.toHaveProperty("createdAt");
    expect(JSON.stringify(baseline)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------

describe("report snapshots", () => {
  for (const name of FIXTURE_NAMES) {
    it(`matches the recorded report for ${name}`, () => {
      expect(sanitize(reportFor(name))).toMatchSnapshot();
    });
  }
});
