export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/**
 * Nearest-rank percentile ("p90 is the smallest observed value that is >= 90%
 * of the sample"). Chosen over interpolation because it always returns a value
 * that actually occurs in the data, so the report stays traceable to a real
 * function in a real file.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = clamp(rank - 1, 0, sorted.length - 1);
  return sorted[index] as number;
}

export function max(values: readonly number[]): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** Round to `digits` decimals, avoiding `-0` and float noise in the JSON output. */
export function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
}
