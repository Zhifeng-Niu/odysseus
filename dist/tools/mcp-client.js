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
import { spawn } from 'node:child_process';
import { quarantineExternalContent } from '../util/quarantine.js';
const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_MS = 10_000;
class StdioMcpClient {
    proc;
    timeoutMs;
    clientName;
    nextId = 1;
    pending = new Map();
    buffer = '';
    constructor(proc, timeoutMs, clientName) {
        this.proc = proc;
        this.timeoutMs = timeoutMs;
        this.clientName = clientName;
        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', (chunk) => this.handleChunk(chunk));
        proc.stderr?.setEncoding('utf8');
        proc.stderr?.on('data', () => {
            // Drained to prevent backpressure; server logs are not client concerns.
        });
        proc.on('exit', () => {
            this.rejectAll(new Error('MCP server process exited'));
        });
        proc.on('error', (err) => {
            this.rejectAll(err);
        });
    }
    handleChunk(chunk) {
        this.buffer += chunk;
        let newlineIdx;
        while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newlineIdx).trim();
            this.buffer = this.buffer.slice(newlineIdx + 1);
            if (line.length === 0)
                continue;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch {
                continue; // tolerate non-JSON lines from a chatty server
            }
            this.handleMessage(message);
        }
    }
    handleMessage(message) {
        const id = message.id;
        if (id === undefined || id === null)
            return; // notification — ignore
        const pending = this.pending.get(Number(id));
        if (!pending)
            return; // response for an unknown/expired request — ignore
        this.pending.delete(Number(id));
        clearTimeout(pending.timer);
        if (message.error !== undefined && message.error !== null) {
            const err = message.error;
            pending.reject(new Error(`MCP error ${err.code ?? '?'}: ${err.message ?? 'unknown'}`));
            return;
        }
        pending.resolve(message.result);
    }
    rejectAll(err) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pending.clear();
    }
    send(message) {
        this.proc.stdin?.write(JSON.stringify(message) + '\n');
    }
    request(method, params) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP request timed out after ${this.timeoutMs}ms: ${method}`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }
    async initialize() {
        await this.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: this.clientName, version: '0.1.0' },
        });
        this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }
    async listTools() {
        const result = (await this.request('tools/list', {}));
        return result.tools ?? [];
    }
    async callTool(name, args) {
        const result = (await this.request('tools/call', { name, arguments: args }));
        const text = (result.content ?? [])
            .filter((c) => c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
            .join('\n');
        return { text, isError: result.isError === true };
    }
    async close() {
        const proc = this.proc;
        this.rejectAll(new Error('MCP client closed'));
        if (proc.exitCode !== null || proc.signalCode !== null)
            return;
        await new Promise((resolve) => {
            proc.once('exit', () => resolve());
            proc.stdin?.end();
            const killTimer = setTimeout(() => proc.kill('SIGKILL'), 2_000);
            proc.once('exit', () => clearTimeout(killTimer));
            proc.kill('SIGTERM');
        });
    }
}
export async function connectMcpStdio(command, args, options = {}) {
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
export async function registerMcpTools(registry, command, args, options = {}) {
    const client = await connectMcpStdio(command, args, options);
    const tools = await client.listTools();
    for (const mcpTool of tools) {
        registry.register({
            name: mcpTool.name,
            description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
            parameters: mcpTool.inputSchema,
            async execute(args) {
                try {
                    const result = await client.callTool(mcpTool.name, args);
                    if (result.isError) {
                        return { ok: false, error: result.text.length > 0 ? result.text : 'MCP tool reported an error' };
                    }
                    // M5 injection defense: MCP output is EXTERNAL data (a remote
                    // server's text enters the prompt) — nonce quarantine, same as
                    // file-read and memory recall.
                    return {
                        ok: true,
                        value: quarantineExternalContent(result.text, {
                            origin: 'mcp-tool',
                            provenance: `server=${command} tool=${mcpTool.name}`,
                        }),
                    };
                }
                catch (err) {
                    return { ok: false, error: err instanceof Error ? err.message : String(err) };
                }
            },
        });
    }
    return client;
}
//# sourceMappingURL=mcp-client.js.map