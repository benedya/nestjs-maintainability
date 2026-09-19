import type { ExtractResult } from "../graph/ast/extract.js";
import { syntheticModuleId } from "./modules.js";
import type { FileNode, NestModuleInfo, Warning } from "../types.js";
import { dirOf, isUnder } from "../util/paths.js";
import { cmpStr, sortStrings } from "../util/stable.js";

export interface OwnershipResult {
  readonly files: Map<string, FileNode>;
  readonly modules: Map<string, NestModuleInfo>;
  readonly warnings: Warning[];
}

/**
 * Assigns every analysed file to exactly one module (Stage 3).
 *
 * Resolution order:
 *  1. the deepest `@Module` directory containing the file - which implements
 *     "unless that subdirectory has its own module" for free;
 *  2. a module that names the file in `controllers`/`providers` even though the
 *     file lives elsewhere - claimed, and flagged `foreign`;
 *  3. a synthetic pseudo-module named after the folder, for everything left.
 *
 * One refinement over the naive reading of rule 1: a module sitting *at* the
 * source root (the usual `src/app.module.ts`) is a composition root, not a
 * folder owner. If it swallowed the whole tree there would be a single module,
 * every coupling number would be zero, and the report would say nothing. Such a
 * module owns only the files directly beside it; each unclaimed subfolder
 * becomes its own pseudo-module. Those pseudo-modules - `common/`, `entities/` -
 * are usually the highest-Ca nodes in the graph, and they are exactly the kind
 * of cross-cutting dependency the coupling metrics are meant to surface.
 */
export function resolveOwnership(
  extracted: ReadonlyMap<string, ExtractResult>,
  nestModules: ReadonlyMap<string, NestModuleInfo>,
  sourceRoot: string,
): OwnershipResult {
  const warnings: Warning[] = [];
  const modules = new Map<string, NestModuleInfo>(nestModules);

  // --- index module directories --------------------------------------------
  const byDir = new Map<string, string[]>();
  for (const module of [...nestModules.values()].sort((a, b) => cmpStr(a.id, b.id))) {
    const list = byDir.get(module.dir) ?? [];
    list.push(module.id);
    byDir.set(module.dir, list);
  }

  const dirOwner = new Map<string, string>();
  for (const [dir, ids] of byDir) {
    const sorted = [...ids].sort(cmpStr);
    dirOwner.set(dir, sorted[0] as string);
    if (sorted.length > 1) {
      for (const extra of sorted.slice(1)) {
        warnings.push({
          code: "ambiguous-ownership",
          message: `${sorted.length} modules declared in ${dir}; files there are attributed to ${modules.get(sorted[0] as string)?.name ?? sorted[0]} and ${modules.get(extra)?.name ?? extra} owns only what it names explicitly`,
          file: modules.get(extra)?.file ?? dir,
          line: modules.get(extra)?.line,
        });
      }
    }
  }

  /** A module at or above the source root composes the app; it does not own the tree. */
  const isRootLevel = (dir: string): boolean => dir === sourceRoot || isUnder(dir, sourceRoot);

  const ownerDirs = [...dirOwner.keys()].sort((a, b) => b.length - a.length || cmpStr(a, b));

  const findDirectoryOwner = (fileDir: string): string | null => {
    for (const dir of ownerDirs) {
      if (!isUnder(dir, fileDir)) continue;
      if (isRootLevel(dir) && fileDir !== dir) continue; // root module owns only its own folder
      return dirOwner.get(dir) as string;
    }
    return null;
  };

  /** Deepest module directory (or the source root) that encloses `fileDir`. */
  const findAnchor = (fileDir: string): string => {
    for (const dir of ownerDirs) {
      if (isUnder(dir, fileDir)) return dir;
    }
    return isUnder(sourceRoot, fileDir) ? sourceRoot : "";
  };

  const syntheticDirFor = (fileDir: string): string => {
    const anchor = findAnchor(fileDir);
    if (fileDir === anchor) return anchor;
    const rest = anchor === "" ? fileDir : fileDir.slice(anchor.length + 1);
    const segment = rest.split("/")[0] as string;
    return anchor === "" ? segment : `${anchor}/${segment}`;
  };

  const syntheticName = (dir: string): string => {
    // An empty source root (a monorepo with several roots) has no prefix to
    // strip; slicing anyway would eat the first character of the folder name.
    const strip = sourceRoot !== "" && dir !== sourceRoot && isUnder(sourceRoot, dir);
    const rest = strip ? dir.slice(sourceRoot.length + 1) : dir;
    return `${rest === "" ? "." : rest}/`;
  };

  // --- assign every file ----------------------------------------------------
  const files = new Map<string, FileNode>();
  const owned = new Map<string, string[]>();

  for (const path of [...extracted.keys()].sort(cmpStr)) {
    const entry = extracted.get(path) as ExtractResult;
    const fileDir = dirOf(path);

    let ownerId = findDirectoryOwner(fileDir);
    if (!ownerId) {
      const dir = syntheticDirFor(fileDir);
      ownerId = syntheticModuleId(dir);
      if (!modules.has(ownerId)) {
        modules.set(ownerId, {
          id: ownerId,
          name: syntheticName(dir),
          file: null,
          line: 0,
          kind: "synthetic",
          global: false,
          dir,
          imports: [],
          exportedModules: [],
          controllers: [],
          providers: [],
          exports: [],
          files: [],
        });
      }
    }

    files.set(path, {
      path,
      moduleId: ownerId,
      foreign: false,
      statements: entry.file.statements,
      classes: entry.file.classes,
      abstractions: entry.file.abstractions,
      concretions: entry.file.concretions,
      parseErrors: entry.file.parseErrors,
    });
    const list = owned.get(ownerId) ?? [];
    list.push(path);
    owned.set(ownerId, list);
  }

  // --- rule 2: a module reaching outside its folder for its own providers ----
  for (const module of [...nestModules.values()].sort((a, b) => cmpStr(a.id, b.id))) {
    const claimed = sortStrings(new Set([...module.controllers, ...module.providers]));
    // A composition root registering the whole application is the technically
    // partitioned pattern, not a module overreaching. Letting it claim every
    // file would collapse such an app to one module, and every coupling number
    // in the report would come out as zero.
    const composesTheApp = isRootLevel(module.dir);

    if (composesTheApp) {
      const outside = claimed.filter((path) => {
        const node = files.get(path);
        return node !== undefined && node.moduleId !== module.id;
      });
      if (outside.length > 0) {
        warnings.push({
          code: "foreign-provider",
          message: `${module.name} composes the application from ${outside.length} file(s) outside ${module.dir || "the source root"}; those files stay with the folder pseudo-modules they live in, so the layering shows up in the coupling numbers`,
          file: module.file ?? module.dir,
          line: module.line,
        });
      }
      continue;
    }

    for (const path of claimed) {
      const node = files.get(path);
      if (!node || node.moduleId === module.id) continue;

      const currentOwner = modules.get(node.moduleId);
      if (currentOwner && currentOwner.kind === "synthetic") {
        // Unclaimed shared code: the declaring module takes it, and we say so.
        const previous = owned.get(node.moduleId) ?? [];
        owned.set(
          node.moduleId,
          previous.filter((p) => p !== path),
        );
        node.moduleId = module.id;
        node.foreign = true;
        const list = owned.get(module.id) ?? [];
        list.push(path);
        owned.set(module.id, list);
        warnings.push({
          code: "foreign-provider",
          message: `${module.name} declares ${path}, which lives outside ${module.dir || "its folder"}; ownership was moved to ${module.name} and the file is marked foreign`,
          file: module.file ?? path,
          line: module.line,
        });
      } else if (currentOwner) {
        warnings.push({
          code: "ambiguous-ownership",
          message: `${module.name} declares ${path}, but that file sits inside ${currentOwner.name}; it stays with ${currentOwner.name} and this cross-module provider is reported as a boundary issue`,
          file: module.file ?? path,
          line: module.line,
        });
      }
    }
  }

  // --- drop pseudo-modules that ended up empty ------------------------------
  for (const [id, module] of [...modules]) {
    const list = sortStrings(owned.get(id) ?? []);
    if (module.kind === "synthetic" && list.length === 0) {
      modules.delete(id);
      continue;
    }
    modules.set(id, { ...module, files: list });
  }

  return { files, modules, warnings };
}
