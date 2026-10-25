import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioById } from '../../src/simulation/scenarios.js';

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('mcp over stdio', () => {
  it('starts as a real process, keeps standard output clean and serves a demo case', async () => {
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve(import.meta.dirname, '../../src/cli/mcp.ts')],
      cwd: resolve(import.meta.dirname, '../..'),
      env: { PATH: process.env['PATH'] ?? '', DATABASE_PATH: ':memory:' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    client = new Client({ name: 'stdio-test', version: '0.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('afterglow_open_case');

    const spec = scenarioById('s01-anniversary-venue-closed');
    const result = await client.callTool({
      name: 'afterglow_open_case',
      arguments: { mode: 'demo', anchor: spec?.anchor, disruption: spec?.disruption },
    });
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    const body = JSON.parse(text) as { source: { mode: string }; status: string };
    expect(body.source.mode).toBe('demo');
    expect(body.status).toBe('recovering');
    expect(stderr.join('')).toContain('MCP server ready on stdio (demo only)');
  }, 30_000);
});
