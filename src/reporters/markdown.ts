import type { Report } from "../types.js";
import { cmpStr } from "../util/stable.js";

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapePipes).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** A report that reads well in a PR comment or a wiki page. */
export function renderMarkdown(report: Report): string {
  const app = report.application;
  const out: string[] = [];

  out.push(`# Maintainability report`);
  out.push("");
  out.push(`\`${report.tool.name}\` v${report.tool.version} - ${report.project.fileCount} files, ${app.k} modules`);
  out.push("");

  out.push(
    table(
      ["Figure", "Value", "Meaning"],
      [
        [
          "**maintainabilityLevel**",
          `**${app.maintainabilityLevel.toFixed(1)} (${app.grade})**`,
          "Size-weighted mean of per-module ML. 0-100, higher is better.",
        ],
        [
          "meanCoupling",
          app.meanCoupling.toFixed(2),
          "Mean `c_i` across the modules. 0-1, lower is better.",
        ],
        [
          "partitioning",
          `${app.partitioning.verdict} (confidence ${app.partitioning.confidence.toFixed(2)})`,
          "Heuristic, see below.",
        ],
      ],
    ),
  );
  out.push("");

  if (report.excludedModules.length > 0) {
    const names = report.excludedModules
      .map((module) => `\`${module.name}\` (${module.statements} statements)`)
      .join(", ");
    out.push(
      `> Excluded by \`excludeModules\`, and absent from every figure above: ${names}.`,
    );
    out.push("");
  }

  if (report.applications.length > 1) {
    out.push(`## Applications`);
    out.push("");
    out.push(
      table(
        ["Application", "Entrypoint", "ML", "Grade", "k"],
        report.applications.map((scope) => [
          scope.name,
          scope.entrypoint ?? "-",
          scope.maintainabilityLevel.toFixed(1),
          scope.grade,
          String(scope.k),
        ]),
      ),
    );
    out.push("");
  }

  out.push(`## Modules`);
  out.push("");
  out.push("Sorted worst first.");
  out.push("");
  out.push(
    table(
      ["Module", "ML", "Grade", "c_i", "Ca", "Ce", "I", "Cohesion", "LCOM4", "CogP90", "Stmts", "Blast"],
      report.modules.map((module) => [
        module.file ? `\`${module.name}\`` : `\`${module.name}\` *(synthetic)*`,
        module.maintainabilityLevel.toFixed(0),
        module.grade,
        module.coupling.ci.toFixed(2),
        String(module.coupling.Ca),
        String(module.coupling.Ce),
        module.coupling.instability.toFixed(2),
        module.cohesion.structural.toFixed(2),
        String(module.cohesion.lcom4Max),
        String(module.complexity.cognitive.p90),
        String(module.size.statements),
        `${Math.round(module.blastRadius.ratio * 100)}%`,
      ]),
    ),
  );
  out.push("");

  if (report.boundaryViolations.length > 0) {
    out.push(`## Boundary violations (${report.boundaryViolations.length})`);
    out.push("");
    out.push("A dependency that crosses a module boundary no `@Module({ imports })` declares.");
    out.push("");
    out.push(
      table(
        ["From", "To", "Where", "Kind"],
        report.boundaryViolations
          .slice(0, 50)
          .map((violation) => [
            nameOf(report, violation.fromModule),
            nameOf(report, violation.toModule),
            `\`${violation.from}:${violation.line}\``,
            violation.typeOnly ? `${violation.kind} (type-only)` : violation.kind,
          ]),
      ),
    );
    out.push("");
  }

  if (report.refactorCandidates.length > 0) {
    out.push(`## Highest-leverage refactors`);
    out.push("");
    out.push("Ranked by coupling x size.");
    out.push("");
    out.push(
      table(
        ["Module", "Score", "ML", "Why"],
        report.refactorCandidates.map((candidate) => [
          candidate.name,
          candidate.score.toFixed(3),
          candidate.maintainabilityLevel.toFixed(0),
          candidate.reason,
        ]),
      ),
    );
    out.push("");
  }

  const complex = report.modules
    .flatMap((module) => module.complexity.aboveThreshold)
    .sort((a, b) => b.cyclomatic - a.cyclomatic || cmpStr(a.file, b.file));
  if (complex.length > 0) {
    out.push(`## Functions above cyclomatic ${report.config.thresholds.functionComplexity} (${complex.length})`);
    out.push("");
    out.push(
      table(
        ["Function", "Location", "Cyclomatic", "Cognitive"],
        complex.slice(0, 40).map((fn) => [
          `\`${fn.name}\``,
          `\`${fn.file}:${fn.line}\``,
          String(fn.cyclomatic),
          String(fn.cognitive),
        ]),
      ),
    );
    out.push("");
  }

  if (report.warnings.length > 0) {
    out.push(`## Warnings (${report.warnings.length})`);
    out.push("");
    out.push("Things the analysis could not resolve. Coupling that is invisible here still exists in the running app.");
    out.push("");
    for (const warning of report.warnings.slice(0, 60)) {
      const location = warning.file ? ` \`${warning.file}${warning.line ? `:${warning.line}` : ""}\`` : "";
      out.push(`- **${warning.code}**${location} - ${warning.message}`);
    }
    out.push("");
  }

  out.push(`---`);
  out.push("");
  out.push(
    "The absolute score is weakly meaningful and cross-project comparison is meaningless. The trend within one project is where the value is.",
  );
  out.push("");

  return out.join("\n");
}

function nameOf(report: Report, id: string): string {
  return report.modules.find((module) => module.id === id)?.name ?? id;
}
