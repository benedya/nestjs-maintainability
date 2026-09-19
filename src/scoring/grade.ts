import type { Grade, ResolvedConfig } from "../types.js";

/**
 * Letter bands, configurable. The absolute letter matters far less than which
 * way it moved since the last run; see the README's "how to read these
 * numbers".
 */
export function gradeFor(score: number, config: ResolvedConfig): Grade {
  const { A, B, C, D } = config.grades;
  if (score >= A) return "A";
  if (score >= B) return "B";
  if (score >= C) return "C";
  if (score >= D) return "D";
  return "F";
}
