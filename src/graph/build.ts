import type { ExtractResult } from "./ast/extract.js";
import type { SymbolResolver } from "../discovery/symbols.js";
import type { Edge, FileNode, ProviderInfo, ResolvedConfig, Warning } from "../types.js";
import { cmpStr } from "../util/stable.js";

/** Confidence attached to each inferred edge kind. Never presented as fact. */
export const INFERRED_CONFIDENCE = {
  entity: 0.8,
  cqrs: 0.6,
  event: 0.5,
  http: 0.4,
} as const;

export interface BuiltEdges {
  readonly importEdges: Edge[];
  readonly diEdges: Edge[];
  readonly inferredEdges: Edge[];
  readonly warnings: Warning[];
}

function sortEdges(edges: Edge[]): Edge[] {
  return edges.sort(
    (a, b) =>
      cmpStr(a.from, b.from) ||
      cmpStr(a.to, b.to) ||
      cmpStr(a.kind, b.kind) ||
      a.line - b.line ||
      cmpStr(a.detail ?? "", b.detail ?? ""),
  );
}

/**
 * Builds the file import graph (a) and the DI graph (c), plus the optional
 * inferred overlays. Graph (b), the declared `@Module` edges, comes straight
 * from module discovery.
 */
export function buildEdges(
  extracted: ReadonlyMap<string, ExtractResult>,
  files: ReadonlyMap<string, FileNode>,
  providers: readonly ProviderInfo[],
  resolver: SymbolResolver,
  config: ResolvedConfig,
): BuiltEdges {
  const warnings: Warning[] = [];
  const importEdges: Edge[] = [];
  const diEdges: Edge[] = [];
  const inferredEdges: Edge[] = [];

  const paths = [...extracted.keys()].sort(cmpStr);

  // --- (a) file import graph ------------------------------------------------
  for (const from of paths) {
    const entry = extracted.get(from) as ExtractResult;
    for (const record of entry.file.imports) {
      if (record.typeOnly && !config.graph.includeTypeOnlyImports) continue;
      if (record.kind === "dynamic" && !config.graph.includeDynamicImports) continue;

      const to = resolver.resolveFile(record.specifier, from);
      if (!to) {
        // Package imports are expected and uninteresting; a relative specifier
        // that does not resolve is a real gap and gets reported.
        if (record.specifier.startsWith(".")) {
          warnings.push({
            code: "unresolved-specifier",
            message: `Could not resolve \`${record.specifier}\`; the dependency it represents is missing from the graph`,
            file: from,
            line: record.line,
          });
        }
        continue;
      }
      if (!files.has(to) || to === from) continue;

      importEdges.push({
        from,
        to,
        kind: "import",
        typeOnly: record.typeOnly,
        confidence: 1,
        line: record.line,
        detail: record.specifier,
      });
    }
  }

  // --- (c) DI graph ---------------------------------------------------------
  const providerByToken = new Map<string, ProviderInfo>();
  for (const provider of providers) {
    if (!providerByToken.has(provider.token) && provider.implementationFile) {
      providerByToken.set(provider.token, provider);
    }
  }

  const reportedTokens = new Set<string>();

  for (const from of paths) {
    const entry = extracted.get(from) as ExtractResult;
    for (const injection of entry.file.injections) {
      let to = resolver.resolveIdentifier(from, injection.identifier);

      if (!to && injection.token) {
        const provider = providerByToken.get(injection.token);
        to = provider?.implementationFile ?? null;
        if (!to && !injection.optional && !reportedTokens.has(injection.token)) {
          reportedTokens.add(injection.token);
          warnings.push({
            code: "string-token",
            message: `${injection.ownerClass} injects \`${injection.token}\`, which is not tied to any provider implementation in this project; the dependency is invisible to this tool`,
            file: from,
            line: injection.line,
          });
        }
      }

      if (!to || !files.has(to) || to === from) continue;

      diEdges.push({
        from,
        to,
        kind: "di",
        typeOnly: false,
        confidence: 1,
        line: injection.line,
        detail: `${injection.ownerClass} <- ${injection.token ?? injection.identifier ?? "?"}`,
      });
    }
  }

  // `useFactory` inject arrays live on the module file, not on a class.
  for (const provider of providers) {
    for (const token of provider.inject) {
      const target = providerByToken.get(token)?.implementationFile ?? null;
      if (!target || !files.has(target) || target === provider.file) continue;
      if (!files.has(provider.file)) continue;
      diEdges.push({
        from: provider.file,
        to: target,
        kind: "di",
        typeOnly: false,
        confidence: 1,
        line: provider.line,
        detail: `${provider.token} useFactory inject ${token}`,
      });
    }
  }

  // --- inferred overlays ----------------------------------------------------
  if (config.graph.inferEntityRelations) {
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const relation of entry.file.relations) {
        const to = resolver.resolveIdentifier(from, relation.identifier);
        if (!to || !files.has(to) || to === from) continue;
        inferredEdges.push({
          from,
          to,
          kind: "entity",
          typeOnly: false,
          confidence: INFERRED_CONFIDENCE.entity,
          line: relation.line,
          detail: `@${relation.decorator} ${relation.ownerClass} -> ${relation.identifier}`,
        });
      }
    }
  }

  if (config.graph.inferEventCoupling) {
    const handlersByEvent = new Map<string, { file: string; line: number }[]>();
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const signal of entry.file.events) {
        if (signal.kind !== "handle") continue;
        const list = handlersByEvent.get(signal.event) ?? [];
        list.push({ file: from, line: signal.line });
        handlersByEvent.set(signal.event, list);
      }
    }
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const signal of entry.file.events) {
        if (signal.kind !== "emit") continue;
        for (const handler of handlersByEvent.get(signal.event) ?? []) {
          if (handler.file === from) continue;
          inferredEdges.push({
            from,
            to: handler.file,
            kind: "event",
            typeOnly: false,
            confidence: INFERRED_CONFIDENCE.event,
            line: signal.line,
            detail: `emit "${signal.event}"`,
          });
        }
      }
    }
  }

  if (config.graph.inferCqrs) {
    // Handler file keyed by the file that declares the command/query/event class.
    const handlersByMessage = new Map<string, { file: string; line: number }[]>();
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const signal of entry.file.cqrs) {
        if (signal.kind !== "handle") continue;
        const messageFile = resolver.resolveIdentifier(from, signal.identifier);
        const key = messageFile ? `${messageFile}#${signal.identifier}` : `?#${signal.identifier}`;
        const list = handlersByMessage.get(key) ?? [];
        list.push({ file: from, line: signal.line });
        handlersByMessage.set(key, list);
      }
    }
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const signal of entry.file.cqrs) {
        if (signal.kind !== "dispatch") continue;
        const messageFile = resolver.resolveIdentifier(from, signal.identifier);
        const key = messageFile ? `${messageFile}#${signal.identifier}` : `?#${signal.identifier}`;
        for (const handler of handlersByMessage.get(key) ?? []) {
          if (handler.file === from) continue;
          inferredEdges.push({
            from,
            to: handler.file,
            kind: "cqrs",
            typeOnly: false,
            confidence: INFERRED_CONFIDENCE.cqrs,
            line: signal.line,
            detail: `dispatch ${signal.identifier}`,
          });
        }
      }
    }
  }

  if (config.graph.inferHttp) {
    const routes: { prefix: string; file: string }[] = [];
    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const route of entry.file.routes) {
        const prefix = route.prefix.replace(/^\/+|\/+$/g, "");
        if (prefix) routes.push({ prefix, file: from });
      }
    }
    routes.sort((a, b) => b.prefix.length - a.prefix.length || cmpStr(a.prefix, b.prefix));

    for (const from of paths) {
      const entry = extracted.get(from) as ExtractResult;
      for (const call of entry.file.http) {
        const pathPart = call.url.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
        const match = routes.find(
          (route) => pathPart === route.prefix || pathPart.startsWith(`${route.prefix}/`),
        );
        if (!match || match.file === from || !files.has(match.file)) continue;
        inferredEdges.push({
          from,
          to: match.file,
          kind: "http",
          typeOnly: false,
          confidence: INFERRED_CONFIDENCE.http,
          line: call.line,
          detail: `HTTP ${call.url}`,
        });
      }
    }
  }

  return {
    importEdges: sortEdges(importEdges),
    diEdges: sortEdges(diEdges),
    inferredEdges: sortEdges(inferredEdges),
    warnings,
  };
}
