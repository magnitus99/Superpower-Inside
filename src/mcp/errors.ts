import { shouldAppendMcpPathHintRust } from '../rag/rust-core';

export function shouldAppendMcpPathHint(command: string, errorMessage: string): boolean {
  const rustHint = shouldAppendMcpPathHintRust(command, errorMessage);
  if (rustHint !== null) return rustHint;

  if (!errorMessage.includes('ENOENT')) {
    return false;
  }

  if (!command || command.includes('/') || command.includes('\\')) {
    return false;
  }

  return true;
}
