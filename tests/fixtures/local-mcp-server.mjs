import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'super-obsidian-test-mcp', version: '1.0.0' });

server.registerTool(
  'search',
  {
    description: '테스트 검색 결과를 반환합니다.',
    inputSchema: { query: z.string().optional(), input: z.string().optional() },
  },
  async ({ query, input }) => {
    const text = query ?? input ?? '';
    return {
      content: [
        {
          type: 'text',
          text: `fixture search result: ${text}`,
        },
      ],
    };
  },
);

server.registerTool(
  'lookup_docs',
  {
    description: '테스트 문서 검색 결과를 반환합니다.',
    inputSchema: { topic: z.string().optional(), input: z.string().optional() },
  },
  async ({ topic, input }) => {
    const text = topic ?? input ?? '';
    return {
      content: [
        {
          type: 'text',
          text: `fixture docs result: ${text}`,
        },
      ],
    };
  },
);

server.registerTool(
  'open_browser',
  {
    description: '테스트 브라우저 실행 결과를 반환합니다.',
    inputSchema: { url: z.string().optional(), input: z.string().optional() },
  },
  async ({ url, input }) => {
    const text = url ?? input ?? '';
    return {
      content: [
        {
          type: 'text',
          text: `fixture browser opened: ${text}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
