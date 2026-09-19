import { ts } from "ts-morph";
import { computeComplexity, isFunctionLike } from "./complexity.js";
import { countStatements } from "./statements.js";
import type { ClassInfo, FunctionInfo, MemberGraph, ProviderScope } from "../../types.js";
import { cmpStr } from "../../util/stable.js";

export const CONSTRUCTOR_MEMBER = "constructor";

export function decoratorName(decorator: ts.Decorator): string {
  const expr = decorator.expression;
  const target = ts.isCallExpression(expr) ? expr.expression : expr;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return target.getText();
}

export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  if (!ts.canHaveDecorators(node)) return [];
  return ts.getDecorators(node) ?? [];
}

export function decoratorArgs(decorator: ts.Decorator): readonly ts.Expression[] {
  const expr = decorator.expression;
  return ts.isCallExpression(expr) ? expr.arguments : [];
}

function memberName(member: ts.ClassElement): string | null {
  if (ts.isConstructorDeclaration(member)) return CONSTRUCTOR_MEMBER;
  const name = member.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function isAbstract(node: ts.ClassDeclaration): boolean {
  return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
}

const SCOPE_BY_NAME: Record<string, ProviderScope> = {
  REQUEST: "request",
  TRANSIENT: "transient",
  DEFAULT: "default",
};

/** Reads `@Injectable({ scope: Scope.REQUEST })`. */
export function readScope(decorators: readonly ts.Decorator[]): ProviderScope {
  for (const decorator of decorators) {
    if (decoratorName(decorator) !== "Injectable") continue;
    const [arg] = decoratorArgs(decorator);
    if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
    for (const property of arg.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (property.name.getText() !== "scope") continue;
      const value = property.initializer;
      const text = ts.isPropertyAccessExpression(value) ? value.name.text : value.getText();
      const scope = SCOPE_BY_NAME[text];
      if (scope) return scope;
    }
  }
  return "default";
}

/**
 * The method/field graph LCOM4 is computed from. Built here, during AST
 * extraction, and stored on the graph so the metric itself stays a pure
 * function over data, per the "no metric may re-read the filesystem" rule.
 */
function buildMemberGraph(node: ts.ClassDeclaration): MemberGraph {
  const fields = new Set<string>();
  const methods = new Set<string>();

  for (const member of node.members) {
    const name = memberName(member);
    if (!name) continue;
    if (ts.isPropertyDeclaration(member)) {
      fields.add(name);
    } else if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      methods.add(name);
    } else if (ts.isConstructorDeclaration(member)) {
      methods.add(CONSTRUCTOR_MEMBER);
      // `constructor(private readonly repo: Repo)` declares a field.
      for (const parameter of member.parameters) {
        const modifiers = ts.getModifiers(parameter);
        const isParameterProperty =
          modifiers?.some(
            (m) =>
              m.kind === ts.SyntaxKind.PrivateKeyword ||
              m.kind === ts.SyntaxKind.PublicKeyword ||
              m.kind === ts.SyntaxKind.ProtectedKeyword ||
              m.kind === ts.SyntaxKind.ReadonlyKeyword,
          ) ?? false;
        if (isParameterProperty && ts.isIdentifier(parameter.name)) fields.add(parameter.name.text);
      }
    }
  }

  const edgeSet = new Set<string>();
  const edges: [string, string][] = [];
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(a < b ? [a, b] : [b, a]);
  };

  const collectTouches = (owner: string, body: ts.Node): void => {
    const walk = (child: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(child) &&
        child.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        const touched = child.name.text;
        if (fields.has(touched) || methods.has(touched)) addEdge(owner, touched);
      }
      child.forEachChild(walk);
    };
    body.forEachChild(walk);
  };

  for (const member of node.members) {
    const name = memberName(member);
    if (!name) continue;
    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member) ||
      ts.isConstructorDeclaration(member)
    ) {
      if (member.body) collectTouches(name, member.body);
    } else if (ts.isPropertyDeclaration(member) && member.initializer) {
      // An arrow-function field is a method in all but syntax.
      collectTouches(name, member.initializer);
    }
  }

  return {
    methods: [...methods].sort(cmpStr),
    fields: [...fields].sort(cmpStr),
    edges: edges.sort((a, b) => cmpStr(a[0], b[0]) || cmpStr(a[1], b[1])),
  };
}

const ANONYMOUS = "(anonymous)";
const ANONYMOUS_CLASS = "(anonymous class)";

function functionName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) return CONSTRUCTOR_MEMBER;
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  // `export const handler = () => {}` reads better as `handler`.
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyDeclaration(parent) && parent.name) return parent.name.getText();
  if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText();
  return ANONYMOUS;
}

export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function describeFunction(sourceFile: ts.SourceFile, node: ts.Node, prefix: string): FunctionInfo {
  const { cyclomatic, cognitive } = computeComplexity(node);
  const name = functionName(node);
  return {
    name: prefix ? `${prefix}.${name}` : name,
    line: lineOf(sourceFile, node),
    cyclomatic,
    cognitive,
    statements: countStatements(node),
  };
}

/**
 * Every function-like node whose nearest function-like ancestor is none.
 * A callback inside a method is charged to that method rather than counted
 * separately, which is what keeps the p90 comparable between modules: otherwise
 * a module full of one-line `.map()` arrows would look simpler than it is.
 */
export function extractFunctions(sourceFile: ts.SourceFile): FunctionInfo[] {
  const out: FunctionInfo[] = [];

  const walk = (node: ts.Node, classPrefix: string): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const prefix = node.name?.text ?? ANONYMOUS_CLASS;
      node.forEachChild((child) => walk(child, prefix));
      return;
    }
    if (isFunctionLike(node)) {
      out.push(describeFunction(sourceFile, node, classPrefix));
      return; // nested functions roll up into this one
    }
    node.forEachChild((child) => walk(child, classPrefix));
  };

  sourceFile.forEachChild((child) => walk(child, ""));
  return out.sort((a, b) => a.line - b.line || cmpStr(a.name, b.name));
}

const ENTITY_DECORATORS = new Set(["Entity", "ViewEntity", "Schema", "ObjectType"]);

export function extractClasses(sourceFile: ts.SourceFile, filePath: string): ClassInfo[] {
  const classes: ClassInfo[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const decorators = getDecorators(node);
      const names = decorators.map(decoratorName);
      const functions: FunctionInfo[] = [];
      for (const member of node.members) {
        if (isFunctionLike(member)) {
          functions.push(describeFunction(sourceFile, member, node.name.text));
        }
      }
      classes.push({
        name: node.name.text,
        file: filePath,
        line: lineOf(sourceFile, node),
        decorators: [...names].sort(cmpStr),
        isInjectable: names.includes("Injectable"),
        isController: names.includes("Controller"),
        isModule: names.includes("Module"),
        isEntity: names.some((n) => ENTITY_DECORATORS.has(n)),
        abstract: isAbstract(node),
        scope: readScope(decorators),
        members: buildMemberGraph(node),
        functions,
      });
    }
    node.forEachChild(walk);
  };

  sourceFile.forEachChild(walk);
  return classes.sort((a, b) => a.line - b.line || cmpStr(a.name, b.name));
}
