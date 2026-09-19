import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { analyze } from "./analyze.js";
import { NestMaintainabilityError } from "./errors.js";
import {
  FORMATS,
  findModule,
  render,
  renderDiff,
  renderJsonSummary,
  renderModuleDetail,
  renderWhatIf,
  renderDot,
  type Format,
} from "./reporters/index.js";
import { BASELINE_FILENAME, createBaseline, serializeBaseline } from "./baseline/write.js";
import { diffAgainstBaseline } from "./baseline/diff.js";
import { VERSION } from "./version.js";
import { detectColor, dim, red, setColorEnabled } from "./util/ansi.js";
import { stableStringify } from "./util/stable.js";
import type { AnalyzeOptions, Baseline, Report, UserConfig } from "./types.js";

const EXIT_FAILED_GATE = 1;
const EXIT_ERROR = 2;

interface CommonOptions {
  config?: string;
  tsconfig?: string;
  rootModule?: string;
  include?: string[];
  exclude?: string[];
  excludeModule?: string[];
  cache: boolean;
  typeOnly: boolean;
  inferEvents?: boolean;
  inferCqrs?: boolean;
  inferHttp?: boolean;
  inferEntities: boolean;
  color: boolean;
  quiet?: boolean;
}

function toAnalyzeOptions(target: string, options: CommonOptions): AnalyzeOptions {
  const graph: NonNullable<UserConfig["graph"]> = {
    includeTypeOnlyImports: options.typeOnly,
    inferEntityRelations: options.inferEntities,
    ...(options.inferEvents ? { inferEventCoupling: true } : {}),
    ...(options.inferCqrs ? { inferCqrs: true } : {}),
    ...(options.inferHttp ? { inferHttp: true } : {}),
  };

  return {
    path: target,
    configFile: options.config ?? null,
    ...(options.tsconfig ? { tsconfig: options.tsconfig } : {}),
    ...(options.rootModule ? { rootModule: options.rootModule } : {}),
    ...(options.include && options.include.length > 0 ? { include: options.include } : {}),
    ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
    ...(options.excludeModule && options.excludeModule.length > 0
      ? { excludeModules: options.excludeModule }
      : {}),
    graph,
    cache: { enabled: options.cache },
    onProgress: options.quiet
      ? undefined
      : (stage, detail) => {
          process.stderr.write(dim(`  ${stage}${detail ? `: ${detail}` : ""}\n`));
        },
  };
}

function addCommonOptions(command: Command): Command {
  return command
    .option("-c, --config <path>", "path to a config file (skips upward discovery)")
    .option("--tsconfig <path>", "tsconfig to load the project from")
    .option("--root-module <path>", "override root module detection")
    .option("--include <glob...>", "override include globs")
    .option("--exclude <glob...>", "override exclude globs")
    .option(
      "--exclude-module <pattern...>",
      "drop modules from the scoring entirely, by name, id, file or directory (e.g. AppModule)",
    )
    .option("--no-cache", "skip the per-file AST cache under node_modules/.cache")
    .option("--no-type-only", "exclude type-only imports from the graph")
    .option("--no-infer-entities", "do not infer coupling from TypeORM relations")
    .option("--infer-events", "infer coupling from EventEmitter2 emit/@OnEvent name matches")
    .option("--infer-cqrs", "infer coupling from @nestjs/cqrs handler pairing")
    .option("--infer-http", "infer coupling from HttpService calls to known controller routes")
    .option("--no-color", "disable coloured output")
    .option("-q, --quiet", "suppress progress output on stderr");
}

function writeOutput(content: string, out: string | undefined): void {
  if (!out) {
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return;
  }
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
  process.stderr.write(dim(`  wrote ${path.relative(process.cwd(), target)}\n`));
}

function applyColor(options: { color: boolean }, out: string | undefined): void {
  setColorEnabled(options.color && out === undefined && detectColor(process.stdout));
}

/** Non-zero when a configured gate fails, so CI can rely on the exit code. */
function evaluateGates(report: Report, failUnder: number | undefined): string[] {
  const failures: string[] = [];
  const configured = report.config.fail;

  const floor = failUnder ?? configured.appMaintainabilityBelow;
  if (floor !== null && floor !== undefined && report.application.maintainabilityLevel < floor) {
    failures.push(
      `application maintainability ${report.application.maintainabilityLevel.toFixed(2)} is below the floor of ${floor}`,
    );
  }

  if (configured.moduleMaintainabilityBelow !== null) {
    for (const module of report.modules) {
      if (module.maintainabilityLevel < configured.moduleMaintainabilityBelow) {
        failures.push(
          `${module.name} scores ${module.maintainabilityLevel.toFixed(2)}, below the module floor of ${configured.moduleMaintainabilityBelow}`,
        );
      }
    }
  }

  if (configured.warningsAbove !== null && report.warnings.length > configured.warningsAbove) {
    failures.push(
      `${report.warnings.length} warnings, above the configured limit of ${configured.warningsAbove}`,
    );
  }

  return failures;
}

function fail(message: string): never {
  process.stderr.write(red(`\n  ${message}\n\n`));
  process.exit(EXIT_ERROR);
}

const program = new Command();

program
  .name("nest-ml")
  .description(
    "Maintainability and coupling metrics for NestJS codebases.\n" +
      "Reports two application figures - maintainabilityLevel (0-100, higher is better)\n" +
      "and meanCoupling (0-1, lower is better, the same scale as each module's c_i).\n" +
      "See the README for details.",
  )
  .version(VERSION, "-v, --version");

// --------------------------------------------------------------------------
// analyze
// --------------------------------------------------------------------------
const analyzeCommand = addCommonOptions(
  new Command("analyze")
    .description("analyse a NestJS project and report maintainability")
    .argument("[path]", "project root", "."),
)
  .addOption(
    new Option("-f, --format <format>", "output format").choices([...FORMATS]).default("table"),
  )
  .option("-o, --out <file>", "write output to a file instead of stdout")
  .option("-m, --module <name>", "drill into a single module")
  .option("--what-if <name>", "blast-radius simulation for one module")
  .option("--fail-under <n>", "exit non-zero when application maintainability is below n", Number)
  .option("--json-summary", "print a single-line CI-friendly summary to stdout")
  .option("--verbose", "show every violation and warning rather than the top few")
  .action(async (target: string, options: CommonOptions & {
    format: Format;
    out?: string;
    module?: string;
    whatIf?: string;
    failUnder?: number;
    jsonSummary?: boolean;
    verbose?: boolean;
  }) => {
    applyColor(options, options.out);
    const report = await analyze(toAnalyzeOptions(target, options));

    if (report.project.fileCount === 0) {
      fail(
        `No files to analyse in ${report.project.root}.\n` +
          `  include: ${JSON.stringify(report.config.include)}\n` +
          `  exclude: ${JSON.stringify(report.config.exclude)}\n` +
          "  Point --include at your sources, or run from the project root.",
      );
    }

    if (options.jsonSummary) {
      process.stdout.write(`${renderJsonSummary(report)}\n`);
    } else if (options.whatIf) {
      const module = findModule(report, options.whatIf);
      if (!module) fail(`No module matches "${options.whatIf}".`);
      writeOutput(renderWhatIf(report, module), options.out);
    } else if (options.module) {
      const module = findModule(report, options.module);
      if (!module) fail(`No module matches "${options.module}".`);
      // `--module` means "this module", in whatever format was asked for.
      writeOutput(
        options.format === "json"
          ? stableStringify(module, 2)
          : options.format === "table"
            ? renderModuleDetail(report, module)
            : render(report, options.format, options),
        options.out,
      );
    } else {
      writeOutput(render(report, options.format, options), options.out);
    }

    const failures = evaluateGates(report, options.failUnder);
    if (failures.length > 0) {
      process.stderr.write(red("\n  Failed:\n"));
      for (const failure of failures) process.stderr.write(red(`    - ${failure}\n`));
      process.stderr.write("\n");
      process.exit(EXIT_FAILED_GATE);
    }
  });

// --------------------------------------------------------------------------
// baseline
// --------------------------------------------------------------------------
const baselineCommand = new Command("baseline").description("manage the score ratchet");

addCommonOptions(
  baselineCommand
    .command("write")
    .description("snapshot current scores to a committed baseline file")
    .argument("[path]", "project root", "."),
)
  .option("-o, --out <file>", "baseline file to write", BASELINE_FILENAME)
  .action(async (target: string, options: CommonOptions & { out: string }) => {
    applyColor(options, undefined);
    const report = await analyze(toAnalyzeOptions(target, options));
    const baseline = createBaseline(report);
    const file = path.resolve(target, options.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeBaseline(baseline));
    process.stderr.write(
      `\n  Wrote ${path.relative(process.cwd(), file)} at ${baseline.application.maintainabilityLevel.toFixed(2)} (${baseline.application.grade}), ${baseline.modules.length} modules.\n` +
        dim("  Commit it. `nest-ml diff` will fail only when a change makes things worse.\n\n"),
    );
  });

program.addCommand(baselineCommand);

// --------------------------------------------------------------------------
// diff
// --------------------------------------------------------------------------
addCommonOptions(
  program
    .command("diff")
    .description("compare against a baseline; exits non-zero on regression")
    .argument("[baseline]", "baseline file", BASELINE_FILENAME)
    .argument("[path]", "project root", "."),
)
  .option("--tolerance <n>", "ignore drops smaller than this many points", Number)
  .option("--format <format>", "table or json", "table")
  .action(
    async (
      baselineFile: string,
      target: string,
      options: CommonOptions & { tolerance?: number; format: string },
    ) => {
      applyColor(options, undefined);
      const file = path.resolve(target, baselineFile);
      if (!fs.existsSync(file)) {
        fail(`Baseline not found at ${file}. Run \`nest-ml baseline write\` first.`);
      }

      let baseline: Baseline;
      try {
        baseline = JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
      } catch (error) {
        fail(`Could not read baseline ${file}: ${(error as Error).message}`);
      }

      const report = await analyze(toAnalyzeOptions(target, options));
      const result = diffAgainstBaseline(baseline, report, report.config, {
        ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
      });

      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(renderDiff(result, report));
      }

      if (result.regressed) process.exit(EXIT_FAILED_GATE);
    },
  );

// --------------------------------------------------------------------------
// graph
// --------------------------------------------------------------------------
addCommonOptions(
  program
    .command("graph")
    .description("export the module graph in Graphviz DOT format")
    .argument("[path]", "project root", "."),
)
  .option("-o, --out <file>", "write the DOT file here instead of stdout")
  .action(async (target: string, options: CommonOptions & { out?: string }) => {
    applyColor(options, options.out);
    const report = await analyze(toAnalyzeOptions(target, options));
    writeOutput(renderDot(report), options.out);
    if (options.out) {
      process.stderr.write(
        dim(`  Render with: dot -Tsvg ${path.relative(process.cwd(), path.resolve(options.out))} -o graph.svg\n`),
      );
    }
  });

program.addCommand(analyzeCommand, { isDefault: true });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // Expected, actionable problems get one clean line. Anything else is a bug
    // in this tool and deserves its stack trace.
    if (error instanceof NestMaintainabilityError) {
      process.stderr.write(red(`\n  ${error.message}\n\n`));
      process.exit(EXIT_ERROR);
    }
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(red(`\n  ${message}\n\n`));
    process.exit(EXIT_ERROR);
  }
}

void main();

export { program };
