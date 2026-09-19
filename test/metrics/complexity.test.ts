import { describe, expect, it } from "vitest";
import { Project, ts } from "ts-morph";
import { computeComplexity as computeFunctionComplexity } from "../../src/graph/ast/complexity.js";
import { countStatements } from "../../src/graph/ast/statements.js";
import { computeComplexity } from "../../src/metrics/complexity.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { FileNode } from "../../src/types.js";

const project = new Project({ useInMemoryFileSystem: true });
let counter = 0;

/** Complexity of the first function-like declaration in `code`. */
function complexityOf(code: string): { cyclomatic: number; cognitive: number } {
  const file = project.createSourceFile(`f${counter++}.ts`, code);
  const node = file.compilerNode.statements[0] as ts.Node;
  return computeFunctionComplexity(node);
}

describe("cyclomatic complexity", () => {
  it("is 1 for a straight-line function", () => {
    expect(complexityOf("function f() { return 1; }").cyclomatic).toBe(1);
  });

  it("adds one per decision point", () => {
    // 1 base + if + for + case + case + catch + && + ternary = 8
    const code = `
      function f(a: number, b: number[]) {
        try {
          if (a > 0 && a < 10) { return 1; }
          for (const x of b) { console.log(x); }
          switch (a) {
            case 1: return 2;
            case 2: return 3;
            default: return 4;
          }
        } catch (error) {
          return a > 1 ? 5 : 6;
        }
      }
    `;
    expect(complexityOf(code).cyclomatic).toBe(8);
  });

  it("counts optional chaining as a short circuit", () => {
    // 1 base + a?.b + ?? + c?.() = 4
    expect(complexityOf("function f(a: any, c: any) { return a?.b ?? c?.(); }").cyclomatic).toBe(4);
  });

  it("counts each of &&, || and ?? once", () => {
    // 1 base + 3 logical operators = 4
    expect(complexityOf("function f(a: any) { return a && a || a ?? 1; }").cyclomatic).toBe(4);
  });

  it("sees a decision point at the root of a concise arrow body", () => {
    // `x => x ? 1 : 2` is 1 base + 1 ternary = 2
    const file = project.createSourceFile(`arrow${counter++}.ts`, "const f = (x: number) => x ? 1 : 2;");
    const arrow = file
      .getVariableDeclarationOrThrow("f")
      .getInitializerOrThrow()
      .compilerNode as ts.Node;
    expect(computeFunctionComplexity(arrow).cyclomatic).toBe(2);
  });
});

describe("cognitive complexity", () => {
  it("is 0 for a straight-line function", () => {
    expect(complexityOf("function f() { return 1; }").cognitive).toBe(0);
  });

  it("charges nesting", () => {
    // outer if +1, inner if +2 (1 + nesting 1), innermost if +3 = 6
    const code = `
      function f(a: number) {
        if (a > 0) {
          if (a > 1) {
            if (a > 2) { return 1; }
          }
        }
        return 0;
      }
    `;
    expect(complexityOf(code).cognitive).toBe(6);
  });

  it("charges else and else-if flat, without a nesting increment", () => {
    // if +1, else if +1, else +1 = 3   (the same shape nested would cost more)
    const code = `
      function f(a: number) {
        if (a === 1) { return 1; }
        else if (a === 2) { return 2; }
        else { return 3; }
      }
    `;
    expect(complexityOf(code).cognitive).toBe(3);
  });

  it("charges a run of the same boolean operator once", () => {
    // if +1, and one run of && = +1 => 2
    expect(complexityOf("function f(a: any) { if (a && a && a) { return 1; } return 0; }").cognitive).toBe(2);
  });

  it("charges each change of boolean operator", () => {
    // if +1, then && run +1 and || run +1 => 3
    expect(complexityOf("function f(a: any) { if (a && a || a) { return 1; } return 0; }").cognitive).toBe(3);
  });

  it("treats a parenthesised subexpression as a fresh sequence", () => {
    // if +1, outer && +1, inner (|| ) +1 => 3
    expect(complexityOf("function f(a: any) { if (a && (a || a)) { return 1; } return 0; }").cognitive).toBe(3);
  });

  it("charges a switch once, not once per case", () => {
    // switch +1 = 1 (cyclomatic would charge 3 for the same code)
    const code = `
      function f(a: number) {
        switch (a) {
          case 1: return 1;
          case 2: return 2;
          default: return 3;
        }
      }
    `;
    const result = complexityOf(code);
    expect(result.cognitive).toBe(1);
    expect(result.cyclomatic).toBe(3);
  });

  it("charges a labelled break", () => {
    const code = `
      function f(rows: number[][]) {
        outer: for (const row of rows) {
          for (const cell of row) {
            if (cell < 0) { break outer; }
          }
        }
      }
    `;
    // for +1, for +2, if +3, break outer +1 = 7
    expect(complexityOf(code).cognitive).toBe(7);
  });

  it("counts a nested function's body as one level deeper", () => {
    // the callback's `if` sits at nesting 1 => +2
    const code = `
      function f(rows: number[]) {
        return rows.map((row) => {
          if (row > 0) { return row; }
          return 0;
        });
      }
    `;
    expect(complexityOf(code).cognitive).toBe(2);
  });
});

describe("statement counting", () => {
  it("excludes imports, interfaces and type aliases", () => {
    const file = project.createSourceFile(
      `stmts${counter++}.ts`,
      `
      import { Injectable } from '@nestjs/common';
      import type { Other } from './other';
      export interface Shape { a: string; }
      export type Alias = Shape;

      export const value = 1;
      export function go() {
        const x = 1;
        return x;
      }
      `,
    );
    // const value (1) + function go (1) + const x (1) + return (1) = 4
    expect(countStatements(file.compilerNode)).toBe(4);
  });

  it("counts class members that carry code, and initialised fields only", () => {
    const file = project.createSourceFile(
      `cls${counter++}.ts`,
      `
      export class A {
        private bare: string;
        private ready = true;
        constructor(private readonly dep: string) {}
        run(): number { return 1; }
        get size(): number { return 2; }
      }
      `,
    );
    // class (1) + initialised field (1) + constructor (1) + run (1) + return (1)
    // + get size (1) + return (1) = 7. `bare` has no initialiser and no code.
    expect(countStatements(file.compilerNode)).toBe(7);
  });
});

describe("module complexity aggregation", () => {
  const file = (path: string): FileNode => ({
    path,
    moduleId: "m",
    foreign: false,
    statements: 1,
    classes: [],
    abstractions: 0,
    concretions: 1,
    parseErrors: 0,
  });

  it("uses nearest-rank percentiles and flags functions over the threshold", () => {
    const functions = [
      { name: "a", line: 1, cyclomatic: 1, cognitive: 0 },
      { name: "b", line: 2, cyclomatic: 2, cognitive: 1 },
      { name: "c", line: 3, cyclomatic: 3, cognitive: 2 },
      { name: "d", line: 4, cyclomatic: 4, cognitive: 3 },
      { name: "e", line: 5, cyclomatic: 20, cognitive: 30 },
    ];

    const result = computeComplexity([file("f.ts")], () => functions, DEFAULT_CONFIG);

    expect(result.functionCount).toBe(5);
    expect(result.cyclomatic.max).toBe(20);
    // ceil(0.9 * 5) = 5 -> the 5th smallest value
    expect(result.cyclomatic.p90).toBe(20);
    expect(result.cyclomatic.mean).toBe(6);
    // only `e` is above the default threshold of 10
    expect(result.aboveThreshold.map((fn) => fn.name)).toEqual(["e"]);
  });

  it("returns zeros for a module with no functions rather than NaN", () => {
    const result = computeComplexity([file("f.ts")], () => [], DEFAULT_CONFIG);
    expect(result.cognitive).toEqual({ mean: 0, p90: 0, max: 0, total: 0 });
  });
});
