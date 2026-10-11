import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
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
  expect(
    execFileSync(process.execPath, ['--input-type=commonjs', '-'], {
      input: script,
      encoding: 'utf8',
      timeout: 10000,
    }),
  ).toBe('closed');
});
