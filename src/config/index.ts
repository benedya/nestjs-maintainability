export {
  DEFAULT_CONFIG,
  DEFAULT_TECHNICAL_NAMES,
  DEFAULT_EXCLUDE,
  DEFAULT_LCOM4_EXCLUDE_DECORATORS,
  DEFAULT_LCOM4_EXCLUDE_CLASSES,
  DEFAULT_LCOM4_EXCLUDE_FILES,
} from "./defaults.js";
export { configSchema, resolveConfig, validate, deepMerge, ConfigError } from "./schema.js";
export { loadConfig, findConfigFile } from "./load.js";
export type { LoadedConfig } from "./load.js";
