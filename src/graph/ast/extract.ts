import { ts } from "ts-morph";
import {
  decoratorArgs,
  decoratorName,
  extractClasses,
  extractFunctions,
  getDecorators,
  lineOf,
} from "./classes.js";
import { countStatements } from "./statements.js";
import type { ClassInfo, FunctionInfo, ProviderScope, UnresolvedReason } from "../../types.js";
import { cmpStr } from "../../util/stable.js";

/**
 * Bump when the shape or semantics of {@link ExtractedFile} change. It is part
 * of the cache key, so a stale cache can never feed old facts to new code.
 */
export const EXTRACTOR_VERSION = "2";

export type RawImportKind = "import" | "export-from" | "dynamic" | "require" | "import-equals";

export interface RawImport {
  readonly specifier: string;
  readonly line: number;
  /** True when the dependency is erased at compile time, per syntax. */
  readonly typeOnly: boolean;
  readonly kind: RawImportKind;
  /** Local binding names introduced, used to resolve identifiers to files. */
  readonly bindings: readonly string[];
}

export interface RawRef {
  readonly text: string;
  /** Identifier to resolve against imports/local declarations, when determinable. */
  readonly identifier: string | null;
  readonly forwardRef: boolean;
  /** `forRoot`, `registerAsync`, ... when the entry is a dynamic module. */
  readonly dynamicCall: string | null;
  readonly line: number;
  readonly unresolvedReason?: UnresolvedReason;
}

export interface RawProviderEntry {
  readonly token: string;
  readonly identifier: string | null;
  readonly kind: "class" | "useClass" | "useValue" | "useFactory" | "useExisting";
  readonly inject: readonly string[];
  readonly scope: ProviderScope;
  readonly line: number;
  readonly text: string;
  readonly unresolvedReason?: UnresolvedReason;
}

export interface RawModuleDecl {
  readonly className: string;
  readonly line: number;
  readonly global: boolean;
  readonly imports: readonly RawRef[];
  readonly controllers: readonly RawRef[];
  readonly providers: readonly RawProviderEntry[];
  readonly exports: readonly RawRef[];
}

export interface RawInjection {
  readonly ownerClass: string;
  readonly line: number;
  /** Type/class identifier to resolve. */
  readonly identifier: string | null;
  /** Token text when injected by token rather than by type. */
  readonly token: string | null;
  readonly source: "constructor" | "property" | "module-ref" | "factory-inject";
  readonly optional: boolean;
}

export interface RawRelation {
  readonly ownerClass: string;
  readonly identifier: string | null;
  readonly decorator: string;
  readonly line: number;
}

export interface RawEventSignal {
  readonly kind: "emit" | "handle";
  readonly event: string;
  readonly line: number;
}

export interface RawCqrsSignal {
  readonly kind: "dispatch" | "handle";
  readonly identifier: string | null;
  readonly line: number;
}

export interface RawHttpSignal {
  readonly url: string;
  readonly line: number;
}

export interface RawControllerRoute {
  readonly className: string;
  readonly prefix: string;
  readonly line: number;
}

export interface RawEntrypoint {
  readonly identifier: string | null;
  readonly text: string;
  readonly line: number;
}

/**
 * Everything derivable from a single file's text, and nothing else. This is the
 * unit that gets content-hash cached: resolution of identifiers to other files
 * happens later, because it depends on the whole project.
 */
export interface ExtractedFile {
  readonly version: string;
  readonly path: string;
  readonly statements: number;
  readonly parseErrors: number;
  /** Interfaces, type aliases and abstract classes declared in this file. */
  readonly abstractions: number;
  /** Concrete classes declared in this file. */
  readonly concretions: number;
  readonly classes: readonly ClassInfo[];
  readonly functions: readonly FunctionInfo[];
  readonly imports: readonly RawImport[];
  readonly localDeclarations: readonly string[];
  readonly moduleDecl: RawModuleDecl | null;
  readonly injections: readonly RawInjection[];
  readonly relations: readonly RawRelation[];
  readonly events: readonly RawEventSignal[];
  readonly cqrs: readonly RawCqrsSignal[];
  readonly http: readonly RawHttpSignal[];
  readonly routes: readonly RawControllerRoute[];
  readonly entrypoints: readonly RawEntrypoint[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PRIMITIVE_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "void",
  "never",
  "object",
  "symbol",
  "bigint",
  "null",
  "undefined",
  "Date",
  "Array",
  "Promise",
  "Record",
  "Map",
  "Set",
  "Function",
  "RegExp",
  "Buffer",
  "Error",
]);

/** Root identifier of `Foo`, `Foo.Bar`, `Foo<Bar>`. */
function rootIdentifier(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootIdentifier(node.expression);
  if (ts.isTypeReferenceNode(node)) return rootIdentifier(node.typeName);
  if (ts.isQualifiedName(node)) return rootIdentifier(node.left);
  if (ts.isExpressionWithTypeArguments(node)) return rootIdentifier(node.expression);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return rootIdentifier(node.expression);
  }
  return null;
}

function stringLiteralValue(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function tokenText(node: ts.Node): string {
  const literal = stringLiteralValue(node);
  if (literal !== null) return literal;
  const identifier = rootIdentifier(node);
  if (identifier) {
    return ts.isPropertyAccessExpression(node) ? node.getText() : identifier;
  }
  return node.getText();
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
      return property.name;
    }
  }
  return undefined;
}

const DYNAMIC_MODULE_METHODS = new Set([
  "forRoot",
  "forRootAsync",
  "register",
  "registerAsync",
  "forFeature",
  "forFeatureAsync",
  "withConfig",
  "configure",
]);

/**
 * Resolves one entry of a `@Module` array to the class it refers to.
 * Handles `X`, `forwardRef(() => X)`, `X.forRoot(...)` and combinations.
 */
function readModuleRef(sourceFile: ts.SourceFile, node: ts.Node, forwardRef = false): RawRef {
  const line = lineOf(sourceFile, node);
  const text = node.getText();

  if (ts.isIdentifier(node)) {
    return { text, identifier: node.text, forwardRef, dynamicCall: null, line };
  }

  if (ts.isCallExpression(node)) {
    const callee = node.expression;

    if (ts.isIdentifier(callee) && callee.text === "forwardRef") {
      const [arg] = node.arguments;
      if (arg && ts.isArrowFunction(arg) && !ts.isBlock(arg.body)) {
        return { ...readModuleRef(sourceFile, arg.body, true), text, line };
      }
      return {
        text,
        identifier: null,
        forwardRef: true,
        dynamicCall: null,
        line,
        unresolvedReason: "dynamic-expression",
      };
    }

    if (ts.isPropertyAccessExpression(callee)) {
      // `X.forRoot(...)`, `X.registerAsync(...)`: the module is `X`.
      const method = callee.name.text;
      const identifier = rootIdentifier(callee.expression);
      const known = DYNAMIC_MODULE_METHODS.has(method);
      return {
        text,
        identifier,
        forwardRef,
        dynamicCall: method,
        line,
        // A custom static factory still resolves, but says so if it turns out
        // not to point at a module in this project.
        ...(identifier
          ? known
            ? {}
            : { unresolvedReason: "computed" as UnresolvedReason }
          : { unresolvedReason: "dynamic-expression" as UnresolvedReason }),
      };
    }

    return {
      text,
      identifier: null,
      forwardRef,
      dynamicCall: null,
      line,
      unresolvedReason: "dynamic-expression",
    };
  }

  if (ts.isPropertyAccessExpression(node)) {
    return { text, identifier: rootIdentifier(node), forwardRef, dynamicCall: null, line };
  }

  return {
    text,
    identifier: null,
    forwardRef,
    dynamicCall: null,
    line,
    unresolvedReason: "dynamic-expression",
  };
}

/** `[A, B, ...SHARED]` -> element nodes, expanding spreads of local const arrays. */
function arrayElements(
  sourceFile: ts.SourceFile,
  value: ts.Expression | undefined,
  locals: ReadonlyMap<string, ts.Expression>,
): { elements: ts.Expression[]; unresolved: RawRef[] } {
  const elements: ts.Expression[] = [];
  const unresolved: RawRef[] = [];
  if (!value) return { elements, unresolved };

  let array: ts.Expression | undefined = value;
  if (ts.isIdentifier(value)) {
    array = locals.get(value.text);
    if (!array) {
      unresolved.push({
        text: value.getText(),
        identifier: null,
        forwardRef: false,
        dynamicCall: null,
        line: lineOf(sourceFile, value),
        unresolvedReason: "dynamic-expression",
      });
      return { elements, unresolved };
    }
  }

  if (!array || !ts.isArrayLiteralExpression(array)) {
    unresolved.push({
      text: value.getText(),
      identifier: null,
      forwardRef: false,
      dynamicCall: null,
      line: lineOf(sourceFile, value),
      unresolvedReason: "dynamic-expression",
    });
    return { elements, unresolved };
  }

  for (const element of array.elements) {
    if (ts.isSpreadElement(element)) {
      const inner = ts.isIdentifier(element.expression)
        ? locals.get(element.expression.text)
        : element.expression;
      if (inner && ts.isArrayLiteralExpression(inner)) {
        elements.push(...inner.elements);
      } else {
        unresolved.push({
          text: element.getText(),
          identifier: null,
          forwardRef: false,
          dynamicCall: null,
          line: lineOf(sourceFile, element),
          unresolvedReason: "spread",
        });
      }
      continue;
    }
    elements.push(element);
  }

  return { elements, unresolved };
}

function collectLocalArrays(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const locals = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      locals.set(declaration.name.text, declaration.initializer);
    }
  }
  return locals;
}

const SCOPE_BY_NAME: Record<string, ProviderScope> = {
  REQUEST: "request",
  TRANSIENT: "transient",
  DEFAULT: "default",
};

function readProviderEntry(sourceFile: ts.SourceFile, node: ts.Expression): RawProviderEntry {
  const line = lineOf(sourceFile, node);
  const text = node.getText();

  if (ts.isIdentifier(node)) {
    return {
      token: node.text,
      identifier: node.text,
      kind: "class",
      inject: [],
      scope: "default",
      line,
      text,
    };
  }

  if (ts.isObjectLiteralExpression(node)) {
    const provide = objectProperty(node, "provide");
    const token = provide ? tokenText(provide) : text;

    const scopeExpr = objectProperty(node, "scope");
    const scopeName =
      scopeExpr && ts.isPropertyAccessExpression(scopeExpr) ? scopeExpr.name.text : "";
    const scope = SCOPE_BY_NAME[scopeName] ?? "default";

    const injectExpr = objectProperty(node, "inject");
    const inject: string[] = [];
    if (injectExpr && ts.isArrayLiteralExpression(injectExpr)) {
      for (const element of injectExpr.elements) inject.push(tokenText(element));
    }

    for (const kind of ["useClass", "useExisting", "useFactory", "useValue"] as const) {
      const impl = objectProperty(node, kind);
      if (!impl) continue;
      const identifier = kind === "useFactory" ? null : rootIdentifier(impl);
      const entry: RawProviderEntry = {
        token,
        identifier,
        kind,
        inject,
        scope,
        line,
        text,
      };
      return identifier === null && kind !== "useFactory" && kind !== "useValue"
        ? { ...entry, unresolvedReason: "dynamic-expression" }
        : entry;
    }

    return {
      token,
      identifier: null,
      kind: "useValue",
      inject,
      scope,
      line,
      text,
      unresolvedReason: "dynamic-expression",
    };
  }

  return {
    token: text,
    identifier: rootIdentifier(node),
    kind: "class",
    inject: [],
    scope: "default",
    line,
    text,
    unresolvedReason: "dynamic-expression",
  };
}

function readModuleDecl(
  sourceFile: ts.SourceFile,
  node: ts.ClassDeclaration,
  decorator: ts.Decorator,
  locals: ReadonlyMap<string, ts.Expression>,
): { decl: RawModuleDecl; unresolved: RawRef[] } {
  const names = getDecorators(node).map(decoratorName);
  const [arg] = decoratorArgs(decorator);
  const object = arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;

  const unresolved: RawRef[] = [];
  const readList = (key: string): RawRef[] => {
    const { elements, unresolved: bad } = arrayElements(
      sourceFile,
      object ? objectProperty(object, key) : undefined,
      locals,
    );
    unresolved.push(...bad);
    return elements.map((element) => readModuleRef(sourceFile, element));
  };

  const { elements: providerElements, unresolved: badProviders } = arrayElements(
    sourceFile,
    object ? objectProperty(object, "providers") : undefined,
    locals,
  );
  unresolved.push(...badProviders);

  return {
    decl: {
      className: node.name?.text ?? "(anonymous module)",
      line: lineOf(sourceFile, node),
      global: names.includes("Global"),
      imports: readList("imports"),
      controllers: readList("controllers"),
      exports: readList("exports"),
      providers: providerElements.map((element) => readProviderEntry(sourceFile, element)),
    },
    unresolved,
  };
}

// ---------------------------------------------------------------------------
// imports
// ---------------------------------------------------------------------------

function importBindings(clause: ts.ImportClause | undefined): string[] {
  const names: string[] = [];
  if (!clause) return names;
  if (clause.name) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (!bindings) return names;
  if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  else for (const element of bindings.elements) names.push(element.name.text);
  return names;
}

/**
 * True when nothing this import brings in survives compilation: either the
 * whole clause is `import type`, or every named binding is inline `type`.
 */
function isTypeOnlyImport(declaration: ts.ImportDeclaration): boolean {
  const clause = declaration.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (clause.name === undefined && bindings && ts.isNamedImports(bindings)) {
    return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
  }
  return false;
}

function extractImports(sourceFile: ts.SourceFile): RawImport[] {
  const imports: RawImport[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(sourceFile, statement),
        typeOnly: isTypeOnlyImport(statement),
        kind: "import",
        bindings: importBindings(statement.importClause),
      });
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const bindings =
        clause && ts.isNamedExports(clause) ? clause.elements.map((e) => e.name.text) : [];
      imports.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(sourceFile, statement),
        typeOnly: statement.isTypeOnly,
        kind: "export-from",
        bindings,
      });
      continue;
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      imports.push({
        specifier: statement.moduleReference.expression.text,
        line: lineOf(sourceFile, statement),
        typeOnly: statement.isTypeOnly,
        kind: "import-equals",
        bindings: [statement.name.text],
      });
    }
  }

  // Dynamic `import()` and `require()` anywhere in the file.
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      const specifier = first ? stringLiteralValue(first) : null;
      if (specifier !== null) {
        if (callee.kind === ts.SyntaxKind.ImportKeyword) {
          imports.push({
            specifier,
            line: lineOf(sourceFile, node),
            typeOnly: false,
            kind: "dynamic",
            bindings: [],
          });
        } else if (ts.isIdentifier(callee) && callee.text === "require") {
          imports.push({
            specifier,
            line: lineOf(sourceFile, node),
            typeOnly: false,
            kind: "require",
            bindings: [],
          });
        }
      }
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return imports;
}

/**
 * The abstract surface of a file, for Martin's abstractness: interfaces, type
 * aliases and abstract classes on one side, concrete classes on the other.
 */
function countAbstractness(sourceFile: ts.SourceFile): { abstractions: number; concretions: number } {
  let abstractions = 0;
  let concretions = 0;

  const walk = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      abstractions++;
    } else if (ts.isClassDeclaration(node)) {
      const isAbstract =
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      if (isAbstract) abstractions++;
      else concretions++;
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return { abstractions, concretions };
}

function extractLocalDeclarations(sourceFile: ts.SourceFile): string[] {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return [...names].sort(cmpStr);
}

// ---------------------------------------------------------------------------
// dependency injection
// ---------------------------------------------------------------------------

/** `@Inject(X)`, `@InjectRepository(User)`, `@InjectModel('Cat')`, ... */
function readInjectDecorator(
  decorators: readonly ts.Decorator[],
): { token: string | null; identifier: string | null; optional: boolean } {
  let token: string | null = null;
  let identifier: string | null = null;
  let optional = false;

  for (const decorator of decorators) {
    const name = decoratorName(decorator);
    if (name === "Optional") optional = true;
    if (!name.startsWith("Inject")) continue;
    const [arg] = decoratorArgs(decorator);
    if (!arg) continue;
    const literal = stringLiteralValue(arg);
    if (literal !== null) {
      token = literal;
    } else {
      identifier = rootIdentifier(arg);
      token = tokenText(arg);
    }
  }

  return { token, identifier, optional };
}

function typeIdentifier(type: ts.TypeNode | undefined): string | null {
  if (!type) return null;
  if (ts.isTypeReferenceNode(type)) {
    const name = rootIdentifier(type.typeName);
    if (!name || PRIMITIVE_TYPES.has(name)) {
      // `Repository<User>` is a framework type; `User` is the real dependency.
      const [first] = type.typeArguments ?? [];
      return first ? typeIdentifier(first) : null;
    }
    return name;
  }
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    for (const member of type.types) {
      const name = typeIdentifier(member);
      if (name) return name;
    }
  }
  return null;
}

function extractInjections(sourceFile: ts.SourceFile): RawInjection[] {
  const injections: RawInjection[] = [];

  const visitClass = (node: ts.ClassDeclaration): void => {
    const ownerClass = node.name?.text ?? "(anonymous class)";

    for (const member of node.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const decorators = getDecorators(parameter);
          const injected = readInjectDecorator(decorators);
          const identifier = injected.identifier ?? typeIdentifier(parameter.type);
          if (identifier === null && injected.token === null) continue;
          injections.push({
            ownerClass,
            line: lineOf(sourceFile, parameter),
            identifier,
            token: injected.token ?? identifier,
            source: "constructor",
            optional: injected.optional,
          });
        }
        continue;
      }

      if (ts.isPropertyDeclaration(member)) {
        const decorators = getDecorators(member);
        if (decorators.length === 0) continue;
        const injected = readInjectDecorator(decorators);
        if (injected.token === null && injected.identifier === null) continue;
        const identifier = injected.identifier ?? typeIdentifier(member.type);
        injections.push({
          ownerClass,
          line: lineOf(sourceFile, member),
          identifier,
          token: injected.token ?? identifier,
          source: "property",
          optional: injected.optional,
        });
      }
    }

    // `this.moduleRef.get(OrdersService)` - only when the argument is static.
    const walk = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        ts.isPropertyAccessExpression(child.expression) &&
        (child.expression.name.text === "get" || child.expression.name.text === "resolve") &&
        /moduleRef|moduleReference|lazyModuleLoader/i.test(child.expression.expression.getText())
      ) {
        const [arg] = child.arguments;
        if (arg) {
          const identifier = rootIdentifier(arg);
          injections.push({
            ownerClass,
            line: lineOf(sourceFile, child),
            identifier,
            token: tokenText(arg),
            source: "module-ref",
            optional: false,
          });
        }
      }
      child.forEachChild(walk);
    };
    node.forEachChild(walk);
  };

  const walk = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) visitClass(node);
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return injections;
}

// ---------------------------------------------------------------------------
// inferred signals (all lower confidence, all behind flags at scoring time)
// ---------------------------------------------------------------------------

const RELATION_DECORATORS = new Set([
  "ManyToOne",
  "OneToMany",
  "OneToOne",
  "ManyToMany",
  "TreeParent",
  "TreeChildren",
]);

function extractRelations(sourceFile: ts.SourceFile): RawRelation[] {
  const relations: RawRelation[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const ownerClass = node.name?.text ?? "(anonymous class)";
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        for (const decorator of getDecorators(member)) {
          const name = decoratorName(decorator);
          if (!RELATION_DECORATORS.has(name)) continue;
          const [arg] = decoratorArgs(decorator);
          let identifier: string | null = null;
          if (arg && ts.isArrowFunction(arg) && !ts.isBlock(arg.body)) {
            identifier = rootIdentifier(arg.body);
          } else if (arg) {
            identifier = rootIdentifier(arg);
          }
          identifier ??= typeIdentifier(member.type);
          relations.push({
            ownerClass,
            identifier,
            decorator: name,
            line: lineOf(sourceFile, member),
          });
        }
      }
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return relations;
}

function extractEvents(sourceFile: ts.SourceFile): RawEventSignal[] {
  const events: RawEventSignal[] = [];

  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "emit" || node.expression.name.text === "emitAsync")
    ) {
      const [first] = node.arguments;
      const event = first ? stringLiteralValue(first) : null;
      if (event !== null) events.push({ kind: "emit", event, line: lineOf(sourceFile, node) });
    }

    for (const decorator of getDecorators(node)) {
      if (decoratorName(decorator) !== "OnEvent") continue;
      const [first] = decoratorArgs(decorator);
      const event = first ? stringLiteralValue(first) : null;
      if (event !== null) events.push({ kind: "handle", event, line: lineOf(sourceFile, node) });
    }

    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return events;
}

const CQRS_HANDLER_DECORATORS = new Set(["CommandHandler", "QueryHandler", "EventsHandler"]);

function extractCqrs(sourceFile: ts.SourceFile): RawCqrsSignal[] {
  const signals: RawCqrsSignal[] = [];

  const walk = (node: ts.Node): void => {
    for (const decorator of getDecorators(node)) {
      if (!CQRS_HANDLER_DECORATORS.has(decoratorName(decorator))) continue;
      for (const arg of decoratorArgs(decorator)) {
        signals.push({ kind: "handle", identifier: rootIdentifier(arg), line: lineOf(sourceFile, decorator) });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["execute", "publish", "publishAll", "dispatch"].includes(node.expression.name.text)
    ) {
      const [first] = node.arguments;
      if (first && ts.isNewExpression(first)) {
        signals.push({
          kind: "dispatch",
          identifier: rootIdentifier(first.expression),
          line: lineOf(sourceFile, node),
        });
      }
    }

    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return signals;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "request", "axiosRef"]);

function extractHttp(sourceFile: ts.SourceFile): RawHttpSignal[] {
  const calls: RawHttpSignal[] = [];

  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      HTTP_METHODS.has(node.expression.name.text) &&
      /http|axios/i.test(node.expression.expression.getText())
    ) {
      const [first] = node.arguments;
      const url = first ? stringLiteralValue(first) : null;
      if (url !== null) calls.push({ url, line: lineOf(sourceFile, node) });
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return calls;
}

function extractRoutes(sourceFile: ts.SourceFile): RawControllerRoute[] {
  const routes: RawControllerRoute[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      for (const decorator of getDecorators(node)) {
        if (decoratorName(decorator) !== "Controller") continue;
        const [arg] = decoratorArgs(decorator);
        let prefix = "";
        if (arg) {
          const literal = stringLiteralValue(arg);
          if (literal !== null) prefix = literal;
          else if (ts.isObjectLiteralExpression(arg)) {
            const path = objectProperty(arg, "path");
            prefix = path ? (stringLiteralValue(path) ?? "") : "";
          }
        }
        routes.push({ className: node.name.text, prefix, line: lineOf(sourceFile, node) });
      }
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return routes;
}

const FACTORY_METHODS = new Set(["create", "createMicroservice", "createApplicationContext"]);

function extractEntrypoints(sourceFile: ts.SourceFile): RawEntrypoint[] {
  const entrypoints: RawEntrypoint[] = [];

  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      FACTORY_METHODS.has(node.expression.name.text) &&
      /NestFactory/.test(node.expression.expression.getText())
    ) {
      const [first] = node.arguments;
      if (first) {
        entrypoints.push({
          identifier: rootIdentifier(first),
          text: first.getText(),
          line: lineOf(sourceFile, node),
        });
      }
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);

  return entrypoints;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export interface ExtractResult {
  file: ExtractedFile;
  /** Entries in the `@Module` decorator that could not be resolved syntactically. */
  unresolvedModuleEntries: RawRef[];
}

/**
 * Extract every fact derivable from one file's text. Pure with respect to the
 * rest of the project, which is what makes it safe to content-hash cache.
 */
export function extractFile(
  sourceFile: ts.SourceFile,
  filePath: string,
  parseErrors: number,
): ExtractResult {
  const locals = collectLocalArrays(sourceFile);
  const abstractness = countAbstractness(sourceFile);

  let moduleDecl: RawModuleDecl | null = null;
  const unresolvedModuleEntries: RawRef[] = [];

  const findModule = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const decorator of getDecorators(node)) {
        if (decoratorName(decorator) !== "Module") continue;
        const { decl, unresolved } = readModuleDecl(sourceFile, node, decorator, locals);
        // A file with two @Module classes is pathological; the first wins and
        // the rest are reported as ambiguous ownership by the caller.
        moduleDecl ??= decl;
        unresolvedModuleEntries.push(...unresolved);
      }
    }
    node.forEachChild(findModule);
  };
  sourceFile.forEachChild(findModule);

  return {
    file: {
      version: EXTRACTOR_VERSION,
      path: filePath,
      statements: countStatements(sourceFile),
      parseErrors,
      abstractions: abstractness.abstractions,
      concretions: abstractness.concretions,
      classes: extractClasses(sourceFile, filePath),
      functions: extractFunctions(sourceFile),
      imports: extractImports(sourceFile),
      localDeclarations: extractLocalDeclarations(sourceFile),
      moduleDecl,
      injections: extractInjections(sourceFile),
      relations: extractRelations(sourceFile),
      events: extractEvents(sourceFile),
      cqrs: extractCqrs(sourceFile),
      http: extractHttp(sourceFile),
      routes: extractRoutes(sourceFile),
      entrypoints: extractEntrypoints(sourceFile),
    },
    unresolvedModuleEntries,
  };
}
