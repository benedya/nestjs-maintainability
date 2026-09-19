/**
 * Determinism helpers. Identical input must produce byte-identical output, so
 * every collection that reaches a reporter is sorted through one of these.
 */

/** `JSON.stringify` with object keys sorted recursively. Arrays keep their order. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, sortedReplacer(), indent);
}

function sortedReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  return function replacer(_key, value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(source).sort()) out[k] = source[k];
    return out;
  };
}

/** Locale-independent string compare. `localeCompare` is not deterministic across hosts. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort(cmpStr);
}

/** Stable sort by a list of key extractors. */
export function sortBy<T>(
  items: readonly T[],
  ...keys: readonly ((item: T) => string | number)[]
): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      if (typeof ka === "number" && typeof kb === "number") {
        if (ka !== kb) return ka - kb;
      } else {
        const c = cmpStr(String(ka), String(kb));
        if (c !== 0) return c;
      }
    }
    return 0;
  });
}

/** Deduplicate while keeping first-seen order (callers sort explicitly afterwards). */
export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}
