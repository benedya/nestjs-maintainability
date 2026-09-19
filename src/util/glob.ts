/**
 * Minimal glob matching for config patterns that are checked in-process rather
 * than handed to ts-morph: `**` spans directories, `*` stops at `/`, `?` is one
 * character. Deliberately not a glob library - the tool has no runtime
 * dependency on one, and config patterns here are simple by design.
 *
 * Matching is case-insensitive: `*Repository` should catch `UsersRepository`
 * whatever the local spelling habit, and file paths are compared the same way
 * so a case-insensitive filesystem does not change a score.
 */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        // `**/` may match nothing at all, so `**/x.ts` also matches `x.ts`.
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, "i");
}

const cache = new Map<string, RegExp>();

export function matchesGlob(pattern: string, value: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    cache.set(pattern, re);
  }
  return re.test(value);
}

export function matchesAnyGlob(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, value));
}
