import type { ExtractResult } from "../graph/ast/extract.js";

const MAX_REEXPORT_DEPTH = 8;

/**
 * Maps an identifier used in one file to the file that declares it.
 *
 * Purely syntactic: it follows import statements and barrel re-exports rather
 * than asking the type checker. That is deliberate - it is an order of
 * magnitude faster on large projects, it is deterministic, and it keeps working
 * on a codebase that does not typecheck.
 */
export class SymbolResolver {
  private readonly memo = new Map<string, string | null>();

  constructor(
    private readonly extracted: ReadonlyMap<string, ExtractResult>,
    private readonly resolveSpecifier: (specifier: string, containingFile: string) => string | null,
  ) {}

  /** The project-relative file that declares `identifier`, as seen from `fromFile`. */
  resolveIdentifier(fromFile: string, identifier: string | null): string | null {
    if (!identifier) return null;
    const memoKey = `${fromFile} ${identifier}`;
    const cached = this.memo.get(memoKey);
    if (cached !== undefined) return cached;

    const result = this.resolveFrom(fromFile, identifier, 0, new Set());
    this.memo.set(memoKey, result);
    return result;
  }

  /** Resolves a bare specifier, e.g. for import-edge construction. */
  resolveFile(specifier: string, containingFile: string): string | null {
    return this.resolveSpecifier(specifier, containingFile);
  }

  private resolveFrom(
    file: string,
    identifier: string,
    depth: number,
    seen: Set<string>,
  ): string | null {
    if (depth > MAX_REEXPORT_DEPTH || seen.has(`${file} ${identifier}`)) return null;
    seen.add(`${file} ${identifier}`);

    const entry = this.extracted.get(file);
    if (!entry) return null;

    if (entry.file.localDeclarations.includes(identifier)) return file;

    for (const record of entry.file.imports) {
      if (!record.bindings.includes(identifier)) continue;
      const target = this.resolveSpecifier(record.specifier, file);
      if (!target) continue;
      if (!this.extracted.has(target)) return target;
      const followed = this.resolveFrom(target, identifier, depth + 1, seen);
      if (followed) return followed;
      return target;
    }

    // `export * from './x'` barrels: try each star re-export in turn.
    for (const record of entry.file.imports) {
      if (record.kind !== "export-from" || record.bindings.length > 0) continue;
      const target = this.resolveSpecifier(record.specifier, file);
      if (!target || !this.extracted.has(target)) continue;
      const followed = this.resolveFrom(target, identifier, depth + 1, seen);
      if (followed) return followed;
    }

    return null;
  }
}
