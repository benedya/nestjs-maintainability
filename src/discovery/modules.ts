import type { ExtractResult, RawRef } from "../graph/ast/extract.js";
import type { SymbolResolver } from "./symbols.js";
import type {
  Entrypoint,
  ModuleEdge,
  ModuleImportRef,
  NestModuleInfo,
  ProviderInfo,
  ProviderScope,
  UnresolvedReason,
  Warning,
} from "../types.js";
import { dirOf } from "../util/paths.js";
import { cmpStr, sortStrings } from "../util/stable.js";

export interface DiscoveredModules {
  readonly modules: Map<string, NestModuleInfo>;
  readonly moduleEdges: ModuleEdge[];
  readonly providers: ProviderInfo[];
  readonly entrypoints: Entrypoint[];
  readonly warnings: Warning[];
  /** Declaration file of each module, for ownership resolution. */
  readonly moduleFile: Map<string, string>;
}

export function moduleId(file: string, className: string): string {
  return `${file}#${className}`;
}

export function syntheticModuleId(dir: string): string {
  return `synthetic:${dir}`;
}

/**
 * Discovers every `@Module()` class and resolves its decorator metadata.
 *
 * Anything that cannot be resolved statically - a spread of a computed array,
 * a module built by a helper function - is recorded with an explicit reason and
 * surfaced as a warning rather than dropped. A confidently wrong coupling count
 * is worse than an acknowledged gap.
 */
export function discoverModules(
  extracted: ReadonlyMap<string, ExtractResult>,
  resolver: SymbolResolver,
): DiscoveredModules {
  const modules = new Map<string, NestModuleInfo>();
  const moduleFile = new Map<string, string>();
  const warnings: Warning[] = [];

  // Pass 1: create a node for every @Module class.
  const declByFile = new Map<string, { id: string; className: string }[]>();
  for (const [file, entry] of [...extracted].sort((a, b) => cmpStr(a[0], b[0]))) {
    const decl = entry.file.moduleDecl;
    if (!decl) continue;
    const id = moduleId(file, decl.className);
    moduleFile.set(id, file);
    const list = declByFile.get(file) ?? [];
    list.push({ id, className: decl.className });
    declByFile.set(file, list);

    modules.set(id, {
      id,
      name: decl.className,
      file,
      line: decl.line,
      kind: "nest",
      global: decl.global,
      dir: dirOf(file),
      imports: [],
      exportedModules: [],
      controllers: [],
      providers: [],
      exports: [],
      files: [],
    });

    for (const ref of entry.unresolvedModuleEntries) {
      warnings.push({
        code: ref.unresolvedReason === "spread" ? "spread-element" : "unresolved-module-import",
        message: `Could not statically resolve module metadata entry \`${truncate(ref.text)}\`; it is excluded from the module graph`,
        file,
        line: ref.line,
      });
    }
  }

  const moduleForFileAndName = (file: string, className: string | null): string | null => {
    const declared = declByFile.get(file);
    if (!declared || declared.length === 0) return null;
    if (className) {
      const match = declared.find((d) => d.className === className);
      if (match) return match.id;
    }
    return declared.length === 1 ? (declared[0] as { id: string }).id : null;
  };

  const resolveModuleRef = (fromFile: string, ref: RawRef): string | null => {
    if (!ref.identifier) return null;
    const targetFile = resolver.resolveIdentifier(fromFile, ref.identifier);
    if (!targetFile) return null;
    return moduleForFileAndName(targetFile, ref.identifier);
  };

  const moduleEdges: ModuleEdge[] = [];
  const providers: ProviderInfo[] = [];

  // Pass 2: resolve decorator metadata now that every module node exists.
  for (const [file, entry] of [...extracted].sort((a, b) => cmpStr(a[0], b[0]))) {
    const decl = entry.file.moduleDecl;
    if (!decl) continue;
    const id = moduleId(file, decl.className);
    const node = modules.get(id) as NestModuleInfo;

    const imports: ModuleImportRef[] = [];
    for (const ref of decl.imports) {
      const targetId = resolveModuleRef(file, ref);
      const unresolvedReason: UnresolvedReason | undefined = targetId
        ? undefined
        : (ref.unresolvedReason ?? (ref.identifier ? "external-package" : "dynamic-expression"));

      imports.push({
        moduleId: targetId,
        text: ref.text,
        forwardRef: ref.forwardRef,
        dynamicCall: ref.dynamicCall,
        line: ref.line,
        ...(unresolvedReason ? { unresolvedReason } : {}),
      });

      if (targetId) {
        moduleEdges.push({ from: id, to: targetId, forwardRef: ref.forwardRef, line: ref.line });
      } else if (unresolvedReason !== "external-package") {
        warnings.push({
          code: ref.dynamicCall ? "dynamic-module" : "unresolved-module-import",
          message: `\`${truncate(ref.text)}\` in ${decl.className}.imports could not be resolved to a module in this project (${unresolvedReason})`,
          file,
          line: ref.line,
        });
      }
    }

    const resolveRefsToFiles = (refs: readonly RawRef[], label: string): string[] => {
      const out: string[] = [];
      for (const ref of refs) {
        const target = resolver.resolveIdentifier(file, ref.identifier);
        if (target) out.push(target);
        else if (ref.identifier === null) {
          warnings.push({
            code: "unresolved-provider",
            message: `\`${truncate(ref.text)}\` in ${decl.className}.${label} is not a static reference and was skipped`,
            file,
            line: ref.line,
          });
        }
      }
      return sortStrings(new Set(out));
    };

    const controllers = resolveRefsToFiles(decl.controllers, "controllers");

    const providerFiles: string[] = [];
    for (const entryRef of decl.providers) {
      const implementationFile = resolver.resolveIdentifier(file, entryRef.identifier);
      if (implementationFile) providerFiles.push(implementationFile);

      const isStringToken = entryRef.identifier === null && entryRef.kind !== "class";
      const resolved = implementationFile !== null || entryRef.kind === "useValue";

      providers.push({
        id: `${id}::${entryRef.token}`,
        token: entryRef.token,
        kind: entryRef.kind,
        implementationFile,
        implementationClass: entryRef.identifier,
        inject: [...entryRef.inject],
        moduleId: id,
        exported: false, // filled in below
        file,
        line: entryRef.line,
        scope: entryRef.scope as ProviderScope,
        resolved,
      });

      if (!resolved) {
        warnings.push({
          code: isStringToken ? "string-token" : "unresolved-provider",
          message: `Provider \`${truncate(entryRef.token)}\` in ${decl.className} could not be tied to an implementation file (${entryRef.kind}); dependencies on it are invisible to this tool`,
          file,
          line: entryRef.line,
        });
      }
    }

    // `exports` holds a mix of provider tokens and re-exported modules.
    const exportedModules: string[] = [];
    const exportedTokens: string[] = [];
    for (const ref of decl.exports) {
      const targetId = resolveModuleRef(file, ref);
      if (targetId) exportedModules.push(targetId);
      else if (ref.identifier) exportedTokens.push(ref.identifier);
      else exportedTokens.push(ref.text);
    }

    const exportedSet = new Set(exportedTokens);
    for (const provider of providers) {
      if (provider.moduleId === id && exportedSet.has(provider.token)) {
        (provider as { exported: boolean }).exported = true;
      }
    }

    modules.set(id, {
      ...node,
      imports,
      exportedModules: sortStrings(new Set(exportedModules)),
      controllers,
      providers: sortStrings(new Set(providerFiles)),
      exports: sortStrings(new Set([...exportedTokens, ...exportedModules])),
    });
  }

  // Entrypoints: whatever is handed to NestFactory.
  const entrypoints: Entrypoint[] = [];
  for (const [file, entry] of [...extracted].sort((a, b) => cmpStr(a[0], b[0]))) {
    for (const raw of entry.file.entrypoints) {
      const targetFile = resolver.resolveIdentifier(file, raw.identifier);
      const rootModuleId = targetFile ? moduleForFileAndName(targetFile, raw.identifier) : null;
      entrypoints.push({
        file,
        rootModuleId,
        rootModuleName: raw.identifier ?? raw.text,
        line: raw.line,
      });
      if (!rootModuleId) {
        warnings.push({
          code: "no-root-module",
          message: `NestFactory call references \`${truncate(raw.text)}\`, which did not resolve to an @Module class in this project`,
          file,
          line: raw.line,
        });
      }
    }
  }

  moduleEdges.sort(
    (a, b) => cmpStr(a.from, b.from) || cmpStr(a.to, b.to) || a.line - b.line,
  );
  providers.sort((a, b) => cmpStr(a.moduleId, b.moduleId) || cmpStr(a.token, b.token) || a.line - b.line);
  entrypoints.sort((a, b) => cmpStr(a.file, b.file) || a.line - b.line);

  return { modules, moduleEdges, providers, entrypoints, warnings, moduleFile };
}

function truncate(text: string, length = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}...`;
}
