import type { Grade, ModuleReport, Report } from "../types.js";
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  padEnd,
  padStart,
  red,
  visibleWidth,
  yellow,
} from "../util/ansi.js";
import { cmpStr } from "../util/stable.js";

const GRADE_COLOUR: Record<Grade, (s: string) => string> = {
  A: green,
  B: green,
  C: yellow,
  D: red,
  F: red,
};

type Band = "good" | "watch" | "bad";
type Thresholds = Report["config"]["thresholds"];

/** App-wide figures a cell may need to render a value relative to the whole. */
interface CellContext {
  thresholds: Thresholds;
  totalStatements: number;
}

const BAND_COLOUR: Record<Band, (s: string) => string> = {
  good: green,
  watch: yellow,
  bad: red,
};

/**
 * Coupling bands, shared by the `c_i` column and the application summary line
 * so a module's coupling and the application's mean are read on one scale.
 */
const couplingBand = (ci: number): Band => (ci < 0.3 ? "good" : ci <= 0.6 ? "watch" : "bad");

/** The three band ranges for the legend, each painted in its own colour. */
function bandKey(good: string, watch: string, bad: string): string {
  return `${green(good)}  ${yellow(watch)}  ${red(bad)}`;
}

// Complexity has no hard "bad" line, so we treat the half-way point of the
// penalty ramp (where the penalty reaches 0.5) as red. It is derived from the
// same config the score uses, so the colours follow any threshold override.
const cogBad = (t: Thresholds): number => t.freeComplexity + Math.round(t.complexitySpan / 2);

interface Column {
  header: string;
  align: "left" | "right";
  value: (module: ModuleReport, ctx: CellContext) => string;
  /** Explicit colour. ML/Grade colour by letter grade; overrides `band`. */
  colour?: (module: ModuleReport, text: string) => string;
  /** Traffic-light band for the cell. Skipped for role-dependent metrics. */
  band?: (module: ModuleReport, ctx: CellContext) => Band | undefined;
  /** One-line description shown in the legend below the table. */
  legend?: string;
  /** The band ranges, shown after the description in the legend. */
  range?: (thresholds: Thresholds) => string;
}

const COLUMNS: Column[] = [
  { header: "Module", align: "left", value: (m) => m.name },
  {
    header: "ML",
    align: "right",
    value: (m) => m.maintainabilityLevel.toFixed(0),
    colour: (m, text) => GRADE_COLOUR[m.grade](text),
    legend: "maintainability level, 0-100 (higher is better) - the headline score",
    range: () => bandKey("A/B >=70", "C 55-69", "D/F <55"),
  },
  {
    header: "Grade",
    align: "left",
    value: (m) => m.grade,
    colour: (m, text) => GRADE_COLOUR[m.grade](text),
    legend: "letter grade for ML (A best, F worst)",
  },
  {
    header: "c_i",
    align: "right",
    value: (m) => m.coupling.ci.toFixed(2),
    band: (m) => couplingBand(m.coupling.ci),
    legend: "coupling level, 0-1 (fraction of the rest of the app entangled with this module; lower is better)",
    range: () => `${bandKey("ok <0.30", "watch 0.30-0.60", "high >0.60")}  ${dim("(relative to app size)")}`,
  },
  {
    header: "Ca",
    align: "right",
    value: (m) => String(m.coupling.Ca),
    legend: "afferent coupling: how many modules depend on this one (incoming); role-dependent, not colour-graded",
  },
  {
    header: "Ce",
    align: "right",
    value: (m) => String(m.coupling.Ce),
    legend: "efferent coupling: how many modules this one depends on (outgoing); role-dependent, not colour-graded",
  },
  {
    header: "I",
    align: "right",
    value: (m) => m.coupling.instability.toFixed(2),
    legend: "instability, Ce/(Ca+Ce), 0-1 (0 = stable, 1 = unstable); neither end is bad, so not colour-graded",
  },
  {
    header: "Coh",
    align: "right",
    value: (m) => m.cohesion.structural.toFixed(2),
    band: (m) =>
      m.cohesion.structural >= 0.7 ? "good" : m.cohesion.structural >= 0.4 ? "watch" : "bad",
    legend: "structural cohesion, 0-1 (fraction of dependencies kept inside the module; higher is better)",
    range: () => bandKey("ok >=0.70", "watch 0.40-0.69", "low <0.40"),
  },
  {
    header: "LCOM4",
    align: "right",
    value: (m) => String(m.cohesion.lcom4Max),
    band: (m) => (m.cohesion.lcom4Max <= 1 ? "good" : m.cohesion.lcom4Max === 2 ? "watch" : "bad"),
    legend: "lack of cohesion: separate responsibility clusters in the module's worst class (1 = cohesive)",
    range: () => bandKey("ok 1", "watch 2", "bad >=3"),
  },
  {
    header: "CogP90",
    align: "right",
    value: (m) => String(m.complexity.cognitive.p90),
    band: (m, { thresholds: t }) =>
      m.complexity.cognitive.p90 <= t.freeComplexity
        ? "good"
        : m.complexity.cognitive.p90 < cogBad(t)
          ? "watch"
          : "bad",
    legend: "90th-percentile cognitive complexity of functions (how hard the harder functions are to read; lower is better)",
    range: (t) =>
      bandKey(`ok <=${t.freeComplexity}`, `watch ${t.freeComplexity + 1}-${cogBad(t) - 1}`, `high >=${cogBad(t)}`),
  },
  {
    header: "Stmts",
    align: "right",
    value: (m, ctx) => {
      const pct = ctx.totalStatements > 0 ? Math.round((m.size.statements / ctx.totalStatements) * 100) : 0;
      return `${pct}% (${m.size.statements})`;
    },
    band: (m, ctx) => {
      const share = ctx.totalStatements > 0 ? m.size.statements / ctx.totalStatements : 0;
      return share < 0.2 ? "good" : share <= 0.4 ? "watch" : "bad";
    },
    legend: "size as a share of the app's statements, with the raw statement count in parentheses (colour is by share)",
    range: () => bandKey("ok <20%", "watch 20-40%", "large >40%"),
  },
  {
    header: "Blast",
    align: "right",
    value: (m) => `${Math.round(m.blastRadius.ratio * 100)}%`,
    band: (m) => (m.blastRadius.ratio < 0.2 ? "good" : m.blastRadius.ratio <= 0.5 ? "watch" : "bad"),
    legend: "blast radius: share of the other modules pulled into the change scope if this one changes (lower is safer)",
    range: () => `${bandKey("ok <20%", "watch 20-50%", "high >50%")}  ${dim("(relative to app size)")}`,
  },
];

function renderTable(modules: readonly ModuleReport[], ctx: CellContext): string[] {
  const rows = modules.map((module) => COLUMNS.map((column) => column.value(module, ctx)));
  const widths = COLUMNS.map((column, index) =>
    Math.max(column.header.length, ...rows.map((row) => (row[index] as string).length)),
  );

  const header = COLUMNS.map((column, index) =>
    column.align === "left"
      ? padEnd(column.header, widths[index] as number)
      : padStart(column.header, widths[index] as number),
  ).join("  ");

  const lines = [bold(header), dim("-".repeat(header.length))];

  modules.forEach((module, rowIndex) => {
    const cells = COLUMNS.map((column, index) => {
      const raw = (rows[rowIndex] as string[])[index] as string;
      const padded =
        column.align === "left"
          ? padEnd(raw, widths[index] as number)
          : padStart(raw, widths[index] as number);
      if (column.colour) return column.colour(module, padded);
      const band = column.band?.(module, ctx);
      return band ? BAND_COLOUR[band](padded) : padded;
    });
    lines.push(cells.join("  "));
  });

  return lines;
}

/** A key to the table's column headers, so the metrics can be read at a glance. */
function renderLegend(thresholds: Thresholds): string[] {
  const entries = COLUMNS.filter((column) => column.legend);
  const width = Math.max(...entries.map((column) => column.header.length));
  const lines = [
    bold("Legend") +
      dim("  (cells are coloured ") +
      green("ok") +
      dim(" / ") +
      yellow("watch") +
      dim(" / ") +
      red("bad") +
      dim(")"),
  ];
  for (const column of entries) {
    lines.push(`  ${padEnd(column.header, width)}  ${dim(column.legend as string)}`);
    if (column.range) lines.push(`  ${padEnd("", width)}  ${column.range(thresholds)}`);
  }
  return lines;
}

function gradeLabel(grade: Grade, value: number): string {
  return GRADE_COLOUR[grade](`${value.toFixed(1)} (${grade})`);
}

/**
 * The default output. The application summary comes first, then modules sorted
 * ascending by ML so the module most in need of attention is the first thing on
 * screen rather than the last.
 */
export function renderTableReport(report: Report, options: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  const app = report.application;

  out.push("");
  out.push(bold(`  ${report.tool.name} v${report.tool.version}  ${dim(report.project.root)}`));
  out.push("");
  // A value wider than the column (a long module name) would otherwise run
  // straight into the note, so overflow still gets a two-space separator.
  const summary = (label: string, value: string, note: string): string => {
    const gap = visibleWidth(value) >= 12 ? "  " : "";
    return `  ${padEnd(bold(label), 18)}${padEnd(value, 12)}${gap}${note ? dim(note) : ""}`;
  };

  out.push(
    summary(
      "Maintainability",
      gradeLabel(app.grade, app.maintainabilityLevel),
      "size-weighted mean of module ML",
    ),
  );
  out.push(
    summary(
      "Coupling",
      BAND_COLOUR[couplingBand(app.meanCoupling)](app.meanCoupling.toFixed(2)),
      `mean c_i across ${app.k} module${app.k === 1 ? "" : "s"}; lower is better`,
    ),
  );
  out.push(
    summary("Modules (k)", String(app.k), `${app.totalFiles} files, ${app.totalStatements} statements`),
  );
  out.push(
    summary(
      "Partitioning",
      app.partitioning.verdict,
      `confidence ${app.partitioning.confidence.toFixed(2)} (heuristic)`,
    ),
  );

  // Every figure above is computed over a smaller codebase than the one on
  // disk, so say which part is missing before anyone compares two runs.
  if (report.excludedModules.length > 0) {
    const dropped = report.excludedModules;
    const statements = dropped.reduce((total, module) => total + module.statements, 0);
    out.push(
      summary(
        "Excluded",
        String(dropped.length),
        `${dropped.map((module) => module.name).join(", ")} (${statements} statements, excludeModules)`,
      ),
    );
  }
  out.push("");

  if (report.applications.length > 1) {
    out.push(bold("  Applications"));
    for (const scope of report.applications) {
      out.push(
        `    ${padEnd(scope.name, 28)} ${gradeLabel(scope.grade, scope.maintainabilityLevel)}  ${dim(`k=${scope.k}${scope.entrypoint ? `, ${scope.entrypoint}` : ""}`)}`,
      );
    }
    out.push("");
  }

  const cellContext: CellContext = {
    thresholds: report.config.thresholds,
    totalStatements: app.totalStatements,
  };
  for (const line of renderTable(report.modules, cellContext)) out.push(`  ${line}`);
  out.push("");

  for (const line of renderLegend(report.config.thresholds)) out.push(`  ${line}`);
  out.push("");

  const violations = report.boundaryViolations;
  if (violations.length > 0) {
    out.push(bold(`  Boundary violations (${violations.length})`));
    out.push(dim("  A dependency crossing a module boundary that no @Module imports declares."));
    const shown = options.verbose ? violations : violations.slice(0, 10);
    for (const violation of shown) {
      const fromName = moduleName(report, violation.fromModule);
      const toName = moduleName(report, violation.toModule);
      out.push(
        `    ${red("x")} ${fromName} ${dim("->")} ${toName}  ${dim(`${violation.from}:${violation.line}`)}  ${gray(`[${violation.kind}${violation.typeOnly ? ", type-only" : ""}]`)}`,
      );
    }
    if (shown.length < violations.length) {
      out.push(dim(`    ... ${violations.length - shown.length} more (use --verbose or --format json)`));
    }
    out.push("");
  }

  if (report.refactorCandidates.length > 0) {
    out.push(bold("  Highest-leverage refactors"));
    out.push(dim("  Ranked by coupling x size: where the same work buys the most."));
    for (const candidate of report.refactorCandidates.slice(0, options.verbose ? 15 : 5)) {
      out.push(`    ${cyan(candidate.name)} ${dim(`score ${candidate.score.toFixed(3)}`)}`);
      out.push(dim(`      ${candidate.reason}`));
    }
    out.push("");
  }

  const worstFunctions = report.modules
    .flatMap((module) => module.complexity.aboveThreshold)
    .sort((a, b) => b.cyclomatic - a.cyclomatic || cmpStr(a.file, b.file))
    .slice(0, options.verbose ? 15 : 5);
  if (worstFunctions.length > 0) {
    out.push(
      bold(`  Functions above complexity ${report.config.thresholds.functionComplexity}`),
    );
    for (const fn of worstFunctions) {
      out.push(
        `    ${fn.name} ${dim(`${fn.file}:${fn.line}`)}  cyclomatic ${fn.cyclomatic}, cognitive ${fn.cognitive}`,
      );
    }
    out.push("");
  }

  if (report.warnings.length > 0) {
    out.push(
      yellow(`  ${report.warnings.length} warning(s)`) +
        dim(" - unresolved imports, dynamic modules or ambiguous ownership."),
    );
    const shown = options.verbose ? report.warnings : report.warnings.slice(0, 5);
    for (const warning of shown) {
      const location = warning.file ? `${warning.file}${warning.line ? `:${warning.line}` : ""} ` : "";
      out.push(dim(`    [${warning.code}] ${location}${warning.message}`));
    }
    if (shown.length < report.warnings.length) {
      out.push(dim(`    ... ${report.warnings.length - shown.length} more (use --verbose)`));
    }
    out.push("");
  }

  out.push(
    dim(
      `  ${report.stats.importEdges} import edges (${report.stats.typeOnlyEdges} type-only), ${report.stats.diEdges} DI edges, ${report.stats.inferredEdges} inferred, ${report.stats.crossModuleEdges} crossing a module boundary.`,
    ),
  );
  out.push(
    dim(
      "  The absolute number matters far less than its trend. Use `nest-ml baseline write` and `nest-ml diff`.",
    ),
  );
  out.push("");

  return out.join("\n");
}

function moduleName(report: Report, id: string): string {
  return report.modules.find((module) => module.id === id)?.name ?? id;
}

export function findModule(report: Report, query: string): ModuleReport | null {
  const lower = query.toLowerCase();
  return (
    report.modules.find((module) => module.id === query) ??
    report.modules.find((module) => module.name.toLowerCase() === lower) ??
    report.modules.find((module) => module.name.toLowerCase().replace(/module$/, "") === lower) ??
    report.modules.find((module) => module.name.toLowerCase().includes(lower)) ??
    null
  );
}

/** `--module <name>`: every number for one module, with its inputs. */
export function renderModuleDetail(report: Report, module: ModuleReport): string {
  const out: string[] = [];
  const w = module.weights;
  const p = module.penalties;

  out.push("");
  out.push(bold(`  ${module.name}`) + dim(`  ${module.file ?? module.dir}`));
  out.push(
    dim(`  ${module.kind === "synthetic" ? "synthetic pseudo-module" : "@Module"}${module.global ? ", @Global()" : ""}, ${module.files.length} files, ${module.size.statements} statements`),
  );
  out.push("");
  out.push(`  ${bold("Maintainability")}  ${gradeLabel(module.grade, module.maintainabilityLevel)}`);
  out.push("");
  out.push(bold("  Score breakdown") + dim("   ML = 100 * (1 - sum(weight * penalty))"));
  const rows: [string, number, number][] = [
    ["coupling", p.coupling, w.coupling],
    ["cohesion", p.cohesion, w.cohesion],
    ["complexity", p.complexity, w.complexity],
    ["size", p.size, w.size],
    ["partitioning", p.partitioning, w.partitioning],
  ];
  let total = 0;
  for (const [name, penalty, weight] of rows) {
    total += penalty * weight;
    out.push(
      `    ${padEnd(name, 14)} penalty ${penalty.toFixed(4)}  x weight ${weight.toFixed(2)}  = ${(penalty * weight).toFixed(4)}`,
    );
  }
  out.push(dim(`    ${padEnd("", 14)} ${padStart("total penalty", 34)} = ${total.toFixed(4)}`));
  out.push("");

  out.push(bold("  Coupling"));
  out.push(
    `    Ca ${module.coupling.Ca} (${module.coupling.CaFiles} files)   Ce ${module.coupling.Ce} (${module.coupling.CeFiles} files)   I ${module.coupling.instability.toFixed(3)}`,
  );
  out.push(
    dim(
      `    c_i = clamp01((${module.coupling.afferentWeight} * ${module.coupling.Ca} + ${(1 - module.coupling.afferentWeight).toFixed(2)} * ${module.coupling.Ce}) / (${module.coupling.k} - 1)) = ${module.coupling.ci.toFixed(4)}`,
    ),
  );
  if (module.coupling.afferentModules.length > 0) {
    out.push(dim(`    depended on by: ${module.coupling.afferentModules.map((id) => moduleName(report, id)).join(", ")}`));
  }
  if (module.coupling.efferentModules.length > 0) {
    out.push(dim(`    depends on:     ${module.coupling.efferentModules.map((id) => moduleName(report, id)).join(", ")}`));
  }
  out.push("");

  out.push(bold("  Blast radius"));
  out.push(
    `    ${module.blastRadius.moduleCount} module(s), ${Math.round(module.blastRadius.ratio * 100)}% of the application, ${module.blastRadius.statements} statements`,
  );
  if (module.blastRadius.modules.length > 0) {
    out.push(dim(`    ${module.blastRadius.modules.map((id) => moduleName(report, id)).join(", ")}`));
  }
  out.push("");

  out.push(bold("  Cohesion"));
  out.push(
    `    structural ${module.cohesion.structural.toFixed(3)} = ${module.cohesion.internalEdges} internal / (${module.cohesion.internalEdges} + ${module.cohesion.externalEdges} external)`,
  );
  const splitClasses = module.cohesion.lcom4Classes.filter((entry) => entry.counted && entry.lcom4 > 1);
  if (splitClasses.length > 0) {
    out.push(`    LCOM4 max ${module.cohesion.lcom4Max}, mean ${module.cohesion.lcom4Mean.toFixed(2)}`);
    for (const entry of splitClasses.slice(0, 5)) {
      out.push(
        `      ${entry.class} ${dim(`${entry.file}:${entry.line}`)} splits into ${entry.lcom4}:`,
      );
      for (const component of entry.components.slice(0, 6)) {
        out.push(dim(`        {${component.join(", ")}}`));
      }
    }
  } else {
    out.push(dim(`    LCOM4 max ${module.cohesion.lcom4Max} - no class splits into separate responsibilities`));
  }
  out.push("");

  out.push(bold("  Complexity"));
  out.push(
    `    cognitive:  mean ${module.complexity.cognitive.mean.toFixed(2)}  p90 ${module.complexity.cognitive.p90}  max ${module.complexity.cognitive.max}`,
  );
  out.push(
    `    cyclomatic: mean ${module.complexity.cyclomatic.mean.toFixed(2)}  p90 ${module.complexity.cyclomatic.p90}  max ${module.complexity.cyclomatic.max}   (${module.complexity.functionCount} functions)`,
  );
  for (const fn of module.complexity.aboveThreshold.slice(0, 8)) {
    out.push(dim(`      ${fn.name} ${fn.file}:${fn.line} - cyclomatic ${fn.cyclomatic}, cognitive ${fn.cognitive}`));
  }
  out.push("");

  out.push(bold("  Size"));
  out.push(
    `    ${module.size.statements} statements across ${module.size.files} files (mean ${module.size.meanStatementsPerFile.toFixed(1)})`,
  );
  if (module.size.largestFile) {
    out.push(dim(`    largest: ${module.size.largestFile.path} (${module.size.largestFile.statements})`));
  }
  out.push("");

  out.push(bold("  Partitioning") + dim("  (heuristic)"));
  out.push(
    `    classified ${module.partitioning.classification}, domain alignment ${module.partitioning.domainAlignment.toFixed(3)} (${module.partitioning.domainEdges} domain / ${module.partitioning.technicalEdges} technical edges), confidence ${module.partitioning.confidence.toFixed(2)}`,
  );
  out.push("");

  const violations = report.boundaryViolations.filter(
    (violation) => violation.fromModule === module.id || violation.toModule === module.id,
  );
  if (violations.length > 0) {
    out.push(bold(`  Boundary violations touching this module (${violations.length})`));
    for (const violation of violations.slice(0, 15)) {
      out.push(
        `    ${moduleName(report, violation.fromModule)} ${dim("->")} ${moduleName(report, violation.toModule)}  ${dim(`${violation.from}:${violation.line}`)}`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}

/** `--what-if <name>`: who is in the change scope if this module changes. */
export function renderWhatIf(report: Report, module: ModuleReport): string {
  const out: string[] = [];
  const dependents = module.blastRadius.modules
    .map((id) => report.modules.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is ModuleReport => candidate !== undefined)
    .sort((a, b) => b.size.statements - a.size.statements || cmpStr(a.name, b.name));

  out.push("");
  out.push(bold(`  What if ${module.name} changes?`));
  out.push("");
  out.push(
    `  ${bold(String(module.blastRadius.moduleCount))} of ${report.application.k - 1} other modules are in the change scope ${dim(`(${Math.round(module.blastRadius.ratio * 100)}%)`)}`,
  );
  out.push(
    `  ${bold(String(module.blastRadius.statements))} statements ${dim(`(${Math.round(module.blastRadius.statementRatio * 100)}% of everything outside this module)`)}`,
  );
  out.push("");

  if (dependents.length === 0) {
    out.push(dim("  Nothing depends on this module. Changes here are contained."));
    out.push("");
    return out.join("\n");
  }

  out.push(bold("  In scope"));
  for (const dependent of dependents) {
    const direct = module.coupling.afferentModules.includes(dependent.id);
    out.push(
      `    ${padEnd(dependent.name, 30)} ${padStart(String(dependent.size.statements), 6)} stmts  ${direct ? cyan("direct") : dim("transitive")}`,
    );
  }
  out.push("");

  const directFiles = report.files.filter(
    (file) =>
      file.crossModuleImports > 0 &&
      report.boundaryViolations.some(
        (violation) => violation.from === file.path && violation.toModule === module.id,
      ),
  );
  if (directFiles.length > 0) {
    out.push(bold("  Undeclared dependencies on it (fix these first)"));
    for (const file of directFiles.slice(0, 10)) out.push(`    ${file.path}`);
    out.push("");
  }

  return out.join("\n");
}
