/**
 * Minimal ANSI helpers, no dependency. Colour is a presentation concern only:
 * the JSON reporter never sees it, so determinism of the machine-readable
 * output holds regardless of TTY state.
 */
const ESC = String.fromCharCode(27);
const CSI = ESC + "[";
const ANSI_RE = new RegExp(ESC + "\\[[0-9;]*m", "g");

let enabled = false;

export function setColorEnabled(value: boolean): void {
  enabled = value;
}

export function isColorEnabled(): boolean {
  return enabled;
}

export function detectColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true") return true;
  return Boolean(stream.isTTY);
}

function wrap(open: number, close: number) {
  return (s: string): string => (enabled ? `${CSI}${open}m${s}${CSI}${close}m` : s);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Display width ignoring escape sequences, so columns line up when coloured. */
export function visibleWidth(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function padEnd(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

export function padStart(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? " ".repeat(pad) + s : s;
}
