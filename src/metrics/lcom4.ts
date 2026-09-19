import type {
  ClassInfo,
  Lcom4ClassResult,
  Lcom4Exclusion,
  MemberGraph,
  ResolvedConfig,
} from "../types.js";
import { matchesAnyGlob } from "../util/glob.js";
import { baseName } from "../util/paths.js";
import { cmpStr, sortStrings } from "../util/stable.js";

export const CONSTRUCTOR_MEMBER = "constructor";

/**
 * LCOM4: the number of connected components in a class's method/field graph.
 *
 * 1 means every member is reachable from every other - the class does one
 * thing. N means the class is N classes wearing a trenchcoat, and the
 * components tell you exactly where the seam is. This is the metric that finds
 * the 900-line `UserService`.
 *
 * The constructor is excluded by default: in Nest it takes every collaborator
 * as a parameter property, so counting it would connect all fields and pin
 * every score to 1.
 */
export function computeLcom4(
  members: MemberGraph,
  options: { excludeConstructor: boolean },
): { lcom4: number; components: string[][] } {
  const excluded = new Set<string>(options.excludeConstructor ? [CONSTRUCTOR_MEMBER] : []);

  const nodes = [...members.methods, ...members.fields].filter((name) => !excluded.has(name));
  if (nodes.length === 0) return { lcom4: 1, components: [] };

  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node, new Set());
  for (const [a, b] of members.edges) {
    if (excluded.has(a) || excluded.has(b)) continue;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  const seen = new Set<string>();
  const components: string[][] = [];

  for (const start of [...nodes].sort(cmpStr)) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    components.push(sortStrings(component));
  }

  components.sort((a, b) => cmpStr(a[0] as string, b[0] as string));
  return { lcom4: components.length, components };
}

/**
 * Why this class is not the kind of class LCOM4 measures, or `null` when it is.
 *
 * Entities and repositories are excluded by default. Neither is incoherent when
 * its members do not touch each other: an entity is a bag of columns, and a
 * repository is a fan of independent queries over one table. Left in, they are
 * the loudest classes in every report and none of it is actionable, which is
 * how a real `UsersService` at LCOM4 3 gets lost in the noise.
 *
 * Three axes, because the same class is spelled three ways in the wild: by
 * decorator (`@Entity()`), by name (`UsersRepository`) and by location
 * (`users/repositories/users.repository.ts`).
 */
function classExclusion(info: ClassInfo, config: ResolvedConfig): Lcom4Exclusion | null {
  const { excludeDecorators, excludeClasses, excludeFiles } = config.lcom4;
  const decorators = new Set(excludeDecorators);
  if (info.decorators.some((name) => decorators.has(name))) return "decorator";
  if (matchesAnyGlob(excludeClasses, info.name)) return "class";
  // Patterns are matched against the project-relative path and the bare file
  // name, so `**/*.entity.ts` works whether or not the caller kept the prefix.
  if (matchesAnyGlob(excludeFiles, info.file) || matchesAnyGlob(excludeFiles, baseName(info.file))) {
    return "file";
  }
  return null;
}

/** Per-class LCOM4 for one module's classes, sorted worst first. */
export function computeModuleLcom4(
  classes: readonly ClassInfo[],
  config: ResolvedConfig,
): Lcom4ClassResult[] {
  const results: Lcom4ClassResult[] = [];

  for (const info of classes) {
    const { lcom4, components } = computeLcom4(info.members, {
      excludeConstructor: config.lcom4.excludeConstructor,
    });
    const methodCount = info.members.methods.filter(
      (name) => !(config.lcom4.excludeConstructor && name === CONSTRUCTOR_MEMBER),
    ).length;

    // A DTO has no behaviour to be cohesive about; counting it would make every
    // module with a `dto/` folder look incoherent. Same for the shapes above.
    const excludedBy =
      classExclusion(info, config) ??
      (methodCount < config.lcom4.minMethods ? "minMethods" : null);

    results.push({
      class: info.name,
      file: info.file,
      line: info.line,
      lcom4,
      methodCount,
      fieldCount: info.members.fields.length,
      components,
      counted: excludedBy === null,
      excludedBy,
    });
  }

  return results.sort(
    (a, b) => b.lcom4 - a.lcom4 || cmpStr(a.file, b.file) || cmpStr(a.class, b.class),
  );
}
