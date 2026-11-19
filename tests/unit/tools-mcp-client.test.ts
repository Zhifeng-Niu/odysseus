/**
 * MCP stdio client + ToolRegistry bridge — the Communication/protocol layer
 * of the consensus template (MCP = agent↔tools, JSON-RPC over stdio).
 *
 * Deterministic via a fixture MCP server (tests/fixtures/mcp-echo-server.mjs)
 * spawned with an argv array (no shell — same injection safety as
 * execFileNoThrow, but bidirectional long-running).
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { connectMcpStdio, registerMcpTools } from '../../src/tools/mcp-client.js';
import { ToolRegistry } from '../../src/tools/registry.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/mcp-echo-server.mjs', import.meta.url));

describe('connectMcpStdio', () => {
  it('handshake + listTools discovers the fixture tool', async () => {
    const client = await connectMcpStdio('node', [FIXTURE]);
    try {
      const tools = await client.listTools();
      const echo = tools.find(t => t.name === 'echo');
      expect(echo).toBeDefined();
      expect(echo?.description).toContain('Echo');
      expect(echo?.inputSchema).toMatchObject({ type: 'object' });
    } finally {
      await client.close();
    }
  });

  it('callTool returns text content', async () => {
    const client = await connectMcpStdio('node', [FIXTURE]);
    try {
      const result = await client.callTool('echo', { text: 'hello' });
      expect(result.text).toBe('echo: hello');
      expect(result.isError).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('unknown tool surfaces the server error', async () => {
    const client = await connectMcpStdio('node', [FIXTURE]);
    try {
      await expect(client.callTool('nope', {})).rejects.toThrow(/nope/);
    } finally {
      await client.close();
    }
  });
});

describe('registerMcpTools — registry bridge', () => {
  it('wraps MCP tools as registry tools; dispatch flows through the registry', async () => {
    const registry = new ToolRegistry();
    const client = await registerMcpTools(registry, 'node', [FIXTURE]);
    try {
      const spec = registry.listSpecs().find(s => s.function.name === 'echo');
      expect(spec?.function.description).toContain('Echo');

      const result = await registry.dispatch('echo', { text: 'hi' }, { cwd: process.cwd() });
      expect(result).toEqual({ ok: true, value: 'echo: hi' });

      // Conservative default: MCP tools are treated as mutating (checkpoint
      // cost over un-checkpointed mutation risk).
      expect(registry.mayMutate('echo', {})).toBe(true);

      const errResult = await registry.dispatch('echo', {}, { cwd: process.cwd() });
      // fixture requires `text`; echo of undefined still succeeds → ok.
      expect(errResult.ok).toBe(true);
    } finally {
      await client.close();
    }
  });
});
