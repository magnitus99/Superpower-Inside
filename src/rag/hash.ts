import { createContentHashRust } from './rust-core';

export function createContentHash(content: string): string {
  const rustHash = createContentHashRust(content);
  if (rustHash !== null) return rustHash;

  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
