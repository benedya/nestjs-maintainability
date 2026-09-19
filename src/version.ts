import { createRequire } from "node:module";

/**
 * Fallback for when the package metadata cannot be read (bundled into another
 * build, for instance). Kept in sync with package.json by `npm version`.
 */
const FALLBACK_VERSION = "0.1.0";

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const VERSION: string = readVersion();
