import type { DiffResult, Report } from "../types.js";
import { bold, dim, green, red, padEnd, padStart, yellow } from "../util/ansi.js";

/** Human-readable ratchet output: what moved, which way, and why it matters. */
export function renderDiff(diff: DiffResult, report: Report): string {
  const out: string[] = [];
  const arrow = (delta: number): string =>
    delta > 0 ? green(`+${delta.toFixed(2)}`) : delta < 0 ? red(delta.toFixed(2)) : dim("0.00");

  out.push("");
  out.push(
    `  ${bold("Application")}  ${diff.application.before.toFixed(2)} ${dim("->")} ${diff.application.after.toFixed(2)}  ${arrow(diff.application.delta)}`,
  );
  out.push("");

  const changed = diff.modules.filter((entry) => entry.delta !== 0 || entry.before === null || entry.after === null);
  if (changed.length === 0) {
    out.push(dim("  No module changed score."));
  } else {
    out.push(bold("  Modules"));
    for (const entry of changed) {
      if (entry.before === null) {
        out.push(`    ${padEnd(entry.name, 32)} ${green("new")} ${dim("at")} ${(entry.after as number).toFixed(2)}`);
      } else if (entry.after === null) {
        out.push(`    ${padEnd(entry.name, 32)} ${dim("removed")} (was ${entry.before.toFixed(2)})`);
      } else {
        out.push(
          `    ${padEnd(entry.name, 32)} ${padStart(entry.before.toFixed(2), 6)} ${dim("->")} ${padStart(entry.after.toFixed(2), 6)}  ${arrow(entry.delta)}`,
        );
      }
    }
  }
  out.push("");

  if (diff.newBoundaryViolations.length > 0) {
    out.push(red(`  ${diff.newBoundaryViolations.length} new boundary violation(s)`));
    for (const id of diff.newBoundaryViolations.slice(0, 20)) {
      const violation = report.boundaryViolations.find((candidate) => candidate.id === id);
      if (!violation) {
        out.push(`    ${id}`);
        continue;
      }
      const nameOf = (moduleId: string): string =>
        report.modules.find((module) => module.id === moduleId)?.name ?? moduleId;
      out.push(
        `    ${nameOf(violation.fromModule)} ${dim("->")} ${nameOf(violation.toModule)}  ${dim(`${violation.from}:${violation.line}`)}`,
      );
    }
    out.push("");
  }
  if (diff.fixedBoundaryViolations.length > 0) {
    out.push(green(`  ${diff.fixedBoundaryViolations.length} boundary violation(s) fixed`));
    out.push("");
  }

  if (diff.regressed) {
    out.push(red(bold("  REGRESSION")));
    for (const reason of diff.reasons) out.push(red(`    - ${reason}`));
  } else {
    out.push(green(bold("  No regression.")));
    if (diff.application.delta > 0) {
      out.push(dim("    Run `nest-ml baseline write` to lock in the improvement."));
    }
  }
  out.push("");

  if (report.warnings.length > 0) {
    out.push(yellow(`  ${report.warnings.length} warning(s) in this run.`));
    out.push("");
  }

  return out.join("\n");
}
