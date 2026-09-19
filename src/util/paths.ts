import path from "node:path";

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Project-relative POSIX path. The primary key for files everywhere in the report. */
export function relPath(root: string, absolute: string): string {
  return toPosix(path.relative(root, absolute));
}

export function dirOf(relative: string): string {
  const idx = relative.lastIndexOf("/");
  return idx === -1 ? "" : relative.slice(0, idx);
}

export function baseName(relative: string): string {
  const idx = relative.lastIndexOf("/");
  return idx === -1 ? relative : relative.slice(idx + 1);
}

/** True when `child` is `parent` or lives underneath it. */
export function isUnder(parent: string, child: string): boolean {
  if (parent === "") return true;
  return child === parent || child.startsWith(parent + "/");
}

/**
 * First path segment below `sourceRoot`: `src/orders/dto/x.ts` -> `orders` for
 * sourceRoot `src`. Returns "" for files sitting directly in the source root.
 */
export function topLevelSegment(sourceRoot: string, relative: string): string {
  const rest =
    sourceRoot && isUnder(sourceRoot, relative) ? relative.slice(sourceRoot.length + 1) : relative;
  const idx = rest.indexOf("/");
  return idx === -1 ? "" : rest.slice(0, idx);
}

/** Longest common directory prefix of a set of relative file paths. */
export function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  let prefix = (paths[0] as string).split("/").slice(0, -1);
  for (const p of paths.slice(1)) {
    const parts = p.split("/").slice(0, -1);
    let i = 0;
    while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix.join("/");
}
