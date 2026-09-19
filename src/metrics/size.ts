import type { FileNode, SizeMetrics } from "../types.js";
import { cmpStr } from "../util/stable.js";
import { round } from "../util/stats.js";

/**
 * Size in statements rather than lines - a count of executable statements, not
 * formatting. `largestFile` is reported alongside the total because a 3,000
 * statement module spread over 40 files is a different problem from the same
 * count in three.
 */
export function computeSize(files: readonly FileNode[]): SizeMetrics {
  let statements = 0;
  let largest: { path: string; statements: number } | null = null;

  for (const file of [...files].sort((a, b) => cmpStr(a.path, b.path))) {
    statements += file.statements;
    if (!largest || file.statements > largest.statements) {
      largest = { path: file.path, statements: file.statements };
    }
  }

  return {
    statements,
    files: files.length,
    meanStatementsPerFile: files.length === 0 ? 0 : round(statements / files.length, 2),
    largestFile: largest,
  };
}
