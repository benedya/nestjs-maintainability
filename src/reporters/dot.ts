import type { ModuleReport, Report } from "../types.js";
import { cmpStr } from "../util/stable.js";

function escapeLabel(text: string): string {
  return text.replace(/["\\]/g, "\\$&");
}

/** Green through red by maintainability level, readable on a white background. */
function colourFor(module: ModuleReport): string {
  const ml = module.maintainabilityLevel;
  if (ml >= 85) return "#2f855a";
  if (ml >= 70) return "#68a04a";
  if (ml >= 55) return "#d69e2e";
  if (ml >= 40) return "#dd6b20";
  return "#c53030";
}

/** Node size tracks statements, so the big modules look big. */
function sizeFor(module: ModuleReport, maxStatements: number): number {
  const ratio = maxStatements === 0 ? 0 : module.size.statements / maxStatements;
  return Number((0.5 + 1.6 * Math.sqrt(ratio)).toFixed(2));
}

/**
 * Graphviz export. Solid edges are declared `@Module` imports, dashed edges are
 * dependencies that exist in the code but not in any imports array.
 */
export function renderDot(report: Report): string {
  const maxStatements = Math.max(1, ...report.modules.map((module) => module.size.statements));

  const lines: string[] = [];
  lines.push("digraph nest_modules {");
  lines.push('  rankdir="LR";');
  lines.push('  graph [fontname="Helvetica", splines=true, overlap=false];');
  lines.push('  node [fontname="Helvetica", shape=ellipse, style="filled", fontcolor="white"];');
  lines.push('  edge [fontname="Helvetica", color="#718096"];');
  lines.push("");

  for (const module of [...report.modules].sort((a, b) => cmpStr(a.id, b.id))) {
    const label = [
      escapeLabel(module.name),
      `ML ${module.maintainabilityLevel.toFixed(0)} (${module.grade})`,
      `Ca ${module.coupling.Ca} / Ce ${module.coupling.Ce}`,
      `${module.size.statements} stmts`,
    ].join("\\n");
    const shape = module.kind === "synthetic" ? "box" : "ellipse";
    lines.push(
      `  "${escapeLabel(module.id)}" [label="${label}", fillcolor="${colourFor(module)}", shape=${shape}, width=${sizeFor(module, maxStatements)}, height=${sizeFor(module, maxStatements)}];`,
    );
  }

  lines.push("");

  const violationPairs = new Set(
    report.boundaryViolations.map((violation) => `${violation.fromModule} ${violation.toModule}`),
  );
  const emitted = new Set<string>();

  for (const module of [...report.modules].sort((a, b) => cmpStr(a.id, b.id))) {
    for (const target of module.coupling.efferentModules) {
      const key = `${module.id} ${target}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      const undeclared = violationPairs.has(key);
      const style = undeclared ? ' [style=dashed, color="#c53030"]' : "";
      lines.push(`  "${escapeLabel(module.id)}" -> "${escapeLabel(target)}"${style};`);
    }
  }

  lines.push("");
  lines.push(
    `  labelloc="t"; label="${escapeLabel(report.tool.name)} - ML ${report.application.maintainabilityLevel.toFixed(1)} (${report.application.grade}), k=${report.application.k}\\nDashed red edges are dependencies no @Module imports declares.";`,
  );
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
