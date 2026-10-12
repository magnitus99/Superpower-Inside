import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { mcpStdioNodeTimers } from './mcp-stdio-build.mjs';

it('렌더러의 숫자 타이머에서도 번들된 MCP stdio 프로세스를 오류 없이 종료한다', async () => {
  const result = await build({
    stdin: {
      contents: 'export { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'cjs',
    write: false,
    external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [mcpStdioNodeTimers],
  });
  const script = `
    globalThis.setTimeout = () => 1;
    ${result.outputFiles[0].text}
    (async () => {
      const transport = new module.exports.StdioClientTransport({
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
      });
      await transport.start();
      await transport.close();
      process.stdout.write('closed');
    })().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
  `;
  // Linux는 인자 하나를 128KiB로 제한하므로 번들을 -e가 아니라 임시 파일로 실행합니다.
  const dir = mkdtempSync(join(tmpdir(), 'mcp-stdio-'));
  try {
    const probe = join(dir, 'probe.cjs');
    writeFileSync(probe, script);
    expect(execFileSync(process.execPath, [probe], { encoding: 'utf8', timeout: 10000 })).toBe(
      'closed',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
