import { cmpStr } from "../util/stable.js";

/**
 * Tarjan's strongly connected components, iterative so a deep dependency chain
 * cannot blow the stack on a large monorepo. Returns only components with a
 * real cycle: size > 1, or a single node with a self-edge.
 */
export function findCycles(
  nodes: readonly string[],
  edgesOf: (node: string) => Iterable<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const sortedNodes = [...nodes].sort(cmpStr);
  const neighbours = new Map<string, string[]>();
  const neighboursOf = (node: string): string[] => {
    let list = neighbours.get(node);
    if (!list) {
      list = [...edgesOf(node)].sort(cmpStr);
      neighbours.set(node, list);
    }
    return list;
  };

  for (const root of sortedNodes) {
    if (index.has(root)) continue;

    const work: { node: string; childIndex: number }[] = [{ node: root, childIndex: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; childIndex: number };
      const children = neighboursOf(frame.node);

      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex] as string;
        frame.childIndex++;
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          work.push({ node: child, childIndex: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(child) as number));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop() as string;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        const isSelfLoop = component.length === 1 && neighboursOf(frame.node).includes(frame.node);
        if (component.length > 1 || isSelfLoop) components.push(component.sort(cmpStr));
      }
    }
  }

  return components.sort((a, b) => cmpStr(a[0] as string, b[0] as string));
}

/**
 * Orders a cycle's members so the same cycle always serialises identically:
 * sorted members, which is what the baseline diff keys on.
 */
export function cycleId(prefix: string, members: readonly string[]): string {
  return `${prefix}:${[...members].sort(cmpStr).join("|")}`;
}
