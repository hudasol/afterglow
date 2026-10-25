/**
 * Serves the AFTERGLOW tools over stdio for any MCP client.
 *
 *   npm run mcp
 *
 * Standard output carries the protocol, so every log line goes to standard error. Cases opened
 * here use the same database, the same feasibility gate and the same providers as the web app.
 * Live tools need QLOO_API_KEY in the environment of this process.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { sessionKeyFromToken } from '../application/session.js';
import { buildContainer } from '../container.js';
import { createMcpServer } from '../interfaces/mcp/server.js';

async function main(): Promise<void> {
  const container = buildContainer();
  const server = createMcpServer({
    service: container.service,
    sessionKey: sessionKeyFromToken(process.env['AFTERGLOW_MCP_SESSION'] ?? 'mcp-stdio-local'),
    version: container.version,
  });
  await server.connect(new StdioServerTransport());
  const mode = container.integration.liveConfigured ? 'live and demo' : 'demo only';
  console.error(`AFTERGLOW ${container.version} MCP server ready on stdio (${mode}).`);

  const stop = (): void => {
    void server.close().finally(() => {
      container.db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(
    'AFTERGLOW MCP server failed to start:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exit(1);
});
