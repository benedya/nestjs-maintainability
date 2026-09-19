import type { NestModuleInfo, Warning } from "../types.js";
import { matchesGlob } from "../util/glob.js";
import { cmpStr } from "../util/stable.js";

export interface ModuleExclusions {
  /** Module ids kept out of every figure in the report. */
  readonly ids: Set<string>;
  /** Excluded id -> the `excludeModules` pattern that matched it first. */
  readonly matchedBy: Map<string, string>;
  readonly warnings: Warning[];
}

/**
 * The strings an `excludeModules` pattern is matched against, most specific
 * first. Four spellings of the same module, so a user can write whichever one
 * they already have in front of them:
 *
 *   `AppModule`                       the class name
 *   `src/app.module.ts#AppModule`     the report's module id
 *   `**\/app.module.ts`               the declaring file
 *   `src/common`                      the directory the module owns
 *
 * A synthetic pseudo-module's name carries a trailing slash (`common/`), which
 * nobody types, so the bare form is matched too.
 */
function aliasesOf(module: NestModuleInfo): string[] {
  const aliases = [module.name, module.id, module.dir];
  if (module.file) aliases.push(module.file);
  if (module.name.endsWith("/")) aliases.push(module.name.slice(0, -1));
  return aliases.filter((alias) => alias !== "");
}

/**
 * Resolves `excludeModules` patterns against the discovered modules.
 *
 * A pattern that matches nothing is a warning rather than a silent no-op: the
 * whole point of the option is to change the scores, so a typo that quietly
 * changes nothing is the worst outcome available.
 */
export function selectExcludedModules(
  modules: ReadonlyMap<string, NestModuleInfo>,
  patterns: readonly string[],
  source: string,
): ModuleExclusions {
  const ids = new Set<string>();
  const matchedBy = new Map<string, string>();
  const warnings: Warning[] = [];

  if (patterns.length === 0) return { ids, matchedBy, warnings };

  const sorted = [...modules.values()].sort((a, b) => cmpStr(a.id, b.id));

  for (const pattern of patterns) {
    let hits = 0;
    for (const module of sorted) {
      if (!aliasesOf(module).some((alias) => matchesGlob(pattern, alias))) continue;
      hits++;
      ids.add(module.id);
      if (!matchedBy.has(module.id)) matchedBy.set(module.id, pattern);
    }
    if (hits === 0) {
      warnings.push({
        code: "config",
        message: `excludeModules pattern \`${pattern}\` matched no module; it is compared against each module's name, id, declaring file and directory`,
        file: source,
      });
    }
  }

  return { ids, matchedBy, warnings };
}
