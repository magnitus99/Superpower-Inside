type Constructor<T> = {
  new (): T;
};

type ObsidianInstanceNode = Node & {
  instanceOf?: <T>(type: Constructor<T>) => boolean;
};

export function isDomInstance<T extends Node>(
  node: Node | null | undefined,
  type: Constructor<T>,
): node is T {
  if (!node) return false;
  const checkedNode = node as ObsidianInstanceNode;
  if (typeof checkedNode.instanceOf === 'function') {
    return checkedNode.instanceOf(type);
  }
  return node instanceof type;
}
