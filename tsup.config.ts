import { defineConfig } from "tsup";

const shared = {
  target: "node20" as const,
  platform: "node" as const,
  splitting: false,
  sourcemap: true,
  shims: true,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    // The bin is only ever executed by node, so one format is enough; shipping
    // a second copy would nearly double the tarball for no one's benefit.
    ...shared,
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
