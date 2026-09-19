import type { Report } from "../types.js";
import { stableStringify } from "../util/stable.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
}

function location(uri: string, line?: number): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri },
      ...(line && line > 0 ? { region: { startLine: line } } : {}),
    },
  };
}

/**
 * SARIF 2.1.0, so boundary violations and over-complex functions land as
 * inline GitHub PR annotations instead of scrolling past in a log.
 */
export function renderSarif(report: Report): string {
  const nameOf = (id: string): string =>
    report.modules.find((module) => module.id === id)?.name ?? id;

  const results: SarifResult[] = [];

  for (const violation of report.boundaryViolations) {
    results.push({
      ruleId: "boundary-violation",
      level: violation.confidence >= 1 ? "warning" : "note",
      message: {
        text: `${nameOf(violation.fromModule)} depends on ${nameOf(violation.toModule)} (${violation.kind}${violation.typeOnly ? ", type-only" : ""}), but that module is not in its @Module imports and is not @Global().`,
      },
      locations: [location(violation.from, violation.line)],
      partialFingerprints: { violationId: violation.id },
    });
  }

  for (const module of report.modules) {
    for (const fn of module.complexity.aboveThreshold) {
      results.push({
        ruleId: "function-complexity",
        level: "note",
        message: {
          text: `${fn.name} has cyclomatic complexity ${fn.cyclomatic} (threshold ${report.config.thresholds.functionComplexity}) and cognitive complexity ${fn.cognitive}.`,
        },
        locations: [location(fn.file, fn.line)],
        partialFingerprints: { functionId: `${fn.file}#${fn.name}` },
      });
    }
  }

  for (const module of report.modules) {
    if (
      report.config.fail.moduleMaintainabilityBelow !== null &&
      module.maintainabilityLevel < report.config.fail.moduleMaintainabilityBelow
    ) {
      results.push({
        ruleId: "module-maintainability",
        level: "warning",
        message: {
          text: `${module.name} scores ${module.maintainabilityLevel.toFixed(1)} (${module.grade}), below the configured floor of ${report.config.fail.moduleMaintainabilityBelow}.`,
        },
        locations: [location(module.file ?? module.dir, module.file ? 1 : undefined)],
        partialFingerprints: { moduleId: module.id },
      });
    }
  }

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: "https://www.npmjs.com/package/nestjs-maintainability",
            rules: [
              {
                id: "boundary-violation",
                name: "BoundaryViolation",
                shortDescription: { text: "Undeclared cross-module dependency" },
                fullDescription: {
                  text: "A file depends on another module that its own @Module does not import, re-export or receive globally. The dependency is real; the declared architecture does not describe it.",
                },
                defaultConfiguration: { level: "warning" },
              },
              {
                id: "function-complexity",
                name: "FunctionComplexity",
                shortDescription: { text: "Function above the complexity threshold" },
                fullDescription: {
                  text: "Cyclomatic complexity above the configured threshold. Cognitive complexity is reported alongside it as the better guide to how hard the function is to read.",
                },
                defaultConfiguration: { level: "note" },
              },
              {
                id: "module-maintainability",
                name: "ModuleMaintainability",
                shortDescription: { text: "Module below the maintainability floor" },
                fullDescription: {
                  text: "The module's composite maintainability level is below the configured fail threshold.",
                },
                defaultConfiguration: { level: "warning" },
              },
            ],
          },
        },
        results,
      },
    ],
  };

  return stableStringify(sarif, 2);
}
