import { ts } from "ts-morph";

/**
 * Cyclomatic and cognitive complexity, computed in a single pass per function.
 *
 * Cyclomatic follows the classic definition: one, plus one for every decision
 * point. Cognitive follows G. Ann Campbell's specification as implemented by
 * SonarSource: nesting-weighted, with `else`/`else if` charged flat and runs of
 * the same boolean operator charged once. Cognitive is the one used in the
 * composite score because it tracks how hard code is to *read*, which is what
 * maintainability is actually about; cyclomatic is reported alongside it
 * because it is the number people already have thresholds for.
 *
 * Known deviations from the Sonar spec, both deliberate:
 *   - recursion is not charged (it needs call-graph resolution, and the false
 *     positives on method names shared across classes are not worth it);
 *   - `!(a && b)` is not De Morgan-normalised before counting operator runs.
 */
export interface ComplexityResult {
  cyclomatic: number;
  cognitive: number;
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isLogicalBinary(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Counts `a ?. b` short circuits, which are decision points like a ternary. */
function hasOptionalChain(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return node.questionDotToken !== undefined;
  }
  if (ts.isCallExpression(node)) return node.questionDotToken !== undefined;
  return false;
}

/** Computes both metrics for the body of one function-like node. */
export function computeComplexity(fn: ts.Node): ComplexityResult {
  let cyclomatic = 1;
  let cognitive = 0;

  const body = getBody(fn);
  if (!body) return { cyclomatic, cognitive };
  // A concise arrow body (`x => x ? a : b`) *is* the expression, so descending
  // straight into its children would skip the decision point at its root.
  const isBlockBody = ts.isBlock(body);

  // --- cyclomatic -----------------------------------------------------------
  const countCyclomatic = (node: ts.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
        cyclomatic++;
        break;
      default:
        break;
    }
    if (isLogicalBinary(node)) cyclomatic++;
    if (hasOptionalChain(node)) cyclomatic++;
    node.forEachChild(countCyclomatic);
  };
  if (isBlockBody) body.forEachChild(countCyclomatic);
  else countCyclomatic(body);

  // --- cognitive ------------------------------------------------------------
  const visit = (node: ts.Node, nesting: number): void => {
    if (ts.isIfStatement(node)) {
      visitIf(node, nesting, false);
      return;
    }

    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      cognitive += 1 + nesting;
      node.forEachChild((child) => visit(child, nesting + 1));
      return;
    }

    if (ts.isCatchClause(node)) {
      cognitive += 1 + nesting;
      node.forEachChild((child) => visit(child, nesting + 1));
      return;
    }

    if (ts.isSwitchStatement(node)) {
      cognitive += 1 + nesting;
      visit(node.expression, nesting);
      node.caseBlock.forEachChild((child) => visit(child, nesting + 1));
      return;
    }

    if (ts.isConditionalExpression(node)) {
      cognitive += 1 + nesting;
      visit(node.condition, nesting);
      visit(node.whenTrue, nesting + 1);
      visit(node.whenFalse, nesting + 1);
      return;
    }

    if (
      (ts.isBreakStatement(node) || ts.isContinueStatement(node)) &&
      node.label !== undefined
    ) {
      cognitive += 1;
      return;
    }

    if (isLogicalBinary(node)) {
      // Charge once per run of the same operator, at the root of the chain only.
      cognitive += countOperatorRuns(node);
      for (const operand of logicalOperands(node)) visit(operand, nesting);
      return;
    }

    if (isFunctionLike(node)) {
      // A nested function is not itself a break in flow, but its contents are
      // one level further from the reader.
      node.forEachChild((child) => visit(child, nesting + 1));
      return;
    }

    node.forEachChild((child) => visit(child, nesting));
  };

  const visitIf = (node: ts.IfStatement, nesting: number, isElseIf: boolean): void => {
    // `else if` is charged flat: the reader is following one chain, not nesting.
    cognitive += isElseIf ? 1 : 1 + nesting;
    visit(node.expression, nesting);
    visit(node.thenStatement, nesting + 1);
    const elseStatement = node.elseStatement;
    if (!elseStatement) return;
    if (ts.isIfStatement(elseStatement)) {
      visitIf(elseStatement, nesting, true);
    } else {
      cognitive += 1;
      visit(elseStatement, nesting + 1);
    }
  };

  if (isBlockBody) body.forEachChild((child) => visit(child, 0));
  else visit(body, 0);

  return { cyclomatic, cognitive };
}

function getBody(fn: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isFunctionExpression(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isConstructorDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn)
  ) {
    return fn.body;
  }
  if (ts.isArrowFunction(fn)) return fn.body;
  return undefined;
}

/**
 * `a && b && c` is one run (+1). `a && b || c` is two (+2). Parenthesised
 * subexpressions start a fresh chain, matching Sonar.
 */
function countOperatorRuns(root: ts.BinaryExpression): number {
  const operators: ts.SyntaxKind[] = [];
  const collect = (node: ts.Node): void => {
    if (!isLogicalBinary(node)) return;
    collect(node.left);
    operators.push(node.operatorToken.kind);
    collect(node.right);
  };
  collect(root);

  let runs = 0;
  let previous: ts.SyntaxKind | null = null;
  for (const op of operators) {
    if (op !== previous) runs++;
    previous = op;
  }
  return runs;
}

/** The non-logical leaves of a logical chain, so they can be visited normally. */
function logicalOperands(root: ts.BinaryExpression): ts.Node[] {
  const leaves: ts.Node[] = [];
  const walk = (node: ts.Node): void => {
    if (isLogicalBinary(node)) {
      walk(node.left);
      walk(node.right);
    } else {
      leaves.push(node);
    }
  };
  walk(root);
  return leaves;
}

export { isFunctionLike };
