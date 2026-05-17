export function shouldAppendMcpPathHint(command: string, errorMessage: string): boolean {
  if (!errorMessage.includes('ENOENT')) {
    return false;
  }

  if (!command || command.includes('/') || command.includes('\\')) {
    return false;
  }

  return true;
}
