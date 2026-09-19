import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}
