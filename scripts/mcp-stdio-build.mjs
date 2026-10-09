import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const mcpStdioNodeTimers = {
  name: 'mcp-stdio-node-timers',
  setup(build) {
    // Node 전용 transport의 unref() 호출이 렌더러 타이머에 연결되지 않게 한다.
    build.onLoad(
      { filter: /[/\\]@modelcontextprotocol[/\\]sdk[/\\]dist[/\\]esm[/\\]client[/\\]stdio\.js$/ },
      async ({ path }) => ({
        contents: `import { setTimeout } from 'node:timers';\n${await readFile(path, 'utf8')}`,
        loader: 'js',
        resolveDir: dirname(path),
      }),
    );
  },
};
