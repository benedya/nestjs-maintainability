import { ts } from "ts-morph";

/**
 * Size is measured in statements, not lines. Lines punish formatting choices;
 * statements track how much the code actually does.
 *
 * Counted: executable statements, plus declarations that introduce a unit of
 * behaviour (class, enum, function, and each class member that holds code).
 * Not counted: imports and re-exports, interfaces, type aliases, blank lines,
 * comments, and empty statements - none of them survive to runtime, and none
 * of them are what makes a module hard to change.
 */
const COUNTED_STATEMENTS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.WithStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ExportAssignment,
  // Class members that carry code.
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

function isCounted(node: ts.Node): boolean {
  if (COUNTED_STATEMENTS.has(node.kind)) {
    // `declare` bodies emit nothing.
    if (hasDeclareModifier(node)) return false;
    return true;
  }
  // A field is counted only when it initialises something.
  if (ts.isPropertyDeclaration(node)) return node.initializer !== undefined;
  return false;
}

function hasDeclareModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
}

/** Recursively count statements in `node` (excluding `node` itself). */
export function countStatements(node: ts.Node): number {
  let total = 0;
  const walk = (child: ts.Node): void => {
    if (isCounted(child)) total++;
    child.forEachChild(walk);
  };
  node.forEachChild(walk);
  return total;
}

/** Statement count including `node` itself when it is a counted construct. */
export function countStatementsInclusive(node: ts.Node): number {
  return (isCounted(node) ? 1 : 0) + countStatements(node);
}
