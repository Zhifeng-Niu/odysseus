/**
 * MCP stdio client + ToolRegistry bridge — the Communication/protocol layer
 * of the consensus template (MCP = agent↔tools, JSON-RPC 2.0, newline-
 * delimited over stdio).
 *
 * Safety note: the server process is spawned with an argv array and
 * `shell: false` — the same injection-safety level as execFileNoThrow
 * (no shell interpolation anywhere), but bidirectional and long-running,
 * which execFileNoThrow cannot do. stderr is drained to prevent
 * backpressure; stdout lines that fail to parse are ignored (a chatty
 * server must not crash the client).
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface McpToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  readonly text: string;
  readonly isError: boolean;
}

export interface McpClient {
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface McpConnectOptions {
  /** Per-request timeout. Default 10s. */
  timeoutMs?: number;
  /** Client identity sent in the initialize handshake. */
  clientName?: string;
}

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_MS = 10_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class StdioMcpClient implements McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = '';

  constructor(
    private readonly proc: ChildProcess,
    private readonly timeoutMs: number,
    private readonly clientName: string
  ) {
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => this.handleChunk(chunk));
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', () => {
      // Drained to prevent backpressure; server logs are not client concerns.
    });
    proc.on('exit', () => {
      this.rejectAll(new Error('MCP server process exited'));
    });
    proc.on('error', (err: Error) => {
      this.rejectAll(err);
    });
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // tolerate non-JSON lines from a chatty server
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id;
    if (id === undefined || id === null) return; // notification — ignore
    const pending = this.pending.get(Number(id));
    if (!pending) return; // response for an unknown/expired request — ignore

    this.pending.delete(Number(id));
    clearTimeout(pending.timer);

    if (message.error !== undefined && message.error !== null) {
      const err = message.error as { code?: number; message?: string };
      pending.reject(new Error(`MCP error ${err.code ?? '?'}: ${err.message ?? 'unknown'}`));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private send(message: Record<string, unknown>): void {
    this.proc.stdin?.write(JSON.stringify(message) + '\n');
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: '0.1.0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.request('tools/list', {})) as { tools?: McpToolDef[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
    return { text, isError: result.isError === true };
  }

  async close(): Promise<void> {
    const proc = this.proc;
    this.rejectAll(new Error('MCP client closed'));
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.stdin?.end();
      const killTimer = setTimeout(() => proc.kill('SIGKILL'), 2_000);
      proc.once('exit', () => clearTimeout(killTimer));
      proc.kill('SIGTERM');
    });
  }
}

export async function connectMcpStdio(
  command: string,
  args: readonly string[],
  options: McpConnectOptions = {}
): Promise<McpClient> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clientName = options.clientName ?? 'odysseus-spike';
  // argv array + shell:false — no shell interpolation (see module docstring).
  const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const client = new StdioMcpClient(proc, timeoutMs, clientName);
  await client.initialize();
  return client;
}

/**
 * Discover tools from an MCP server and register them into the registry,
 * wrapped as standard Tool entries. Returns the client so the caller owns
 * its lifecycle (close on shutdown). MCP tools omit `mutates` — the
 * registry's conservative default (treated as mutating) applies, erring
 * toward paying the checkpoint cost over risking un-checkpointed mutation.
 */
export async function registerMcpTools(
  registry: { register(tool: import('./types.js').Tool): void },
  command: string,
  args: readonly string[],
  options: McpConnectOptions = {}
): Promise<McpClient> {
  const client = await connectMcpStdio(command, args, options);
  const tools = await client.listTools();
  for (const mcpTool of tools) {
    registry.register({
      name: mcpTool.name,
      description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
      parameters: mcpTool.inputSchema,
      async execute(args: Record<string, unknown>): Promise<import('./types.js').ToolResult> {
        try {
          const result = await client.callTool(mcpTool.name, args);
          if (result.isError) {
            return { ok: false, error: result.text.length > 0 ? result.text : 'MCP tool reported an error' };
          }
          return { ok: true, value: result.text };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }
  return client;
}
