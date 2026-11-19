// Minimal MCP server fixture for tests — newline-delimited JSON-RPC over
// stdio. Supports: initialize, tools/list (one tool: echo), tools/call
// (echo only; unknown tools get a JSON-RPC error). Everything else with an
// id gets -32601.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (line.length > 0) handle(line);
  }
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return; // ignore malformed lines
  }
  const { id, method, params } = request;
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'echo-fixture', version: '1.0.0' },
        },
      });
      break;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo back the given text',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        },
      });
      break;
    case 'tools/call': {
      if (params?.name !== 'echo') {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `unknown tool: ${params?.name}` },
        });
        break;
      }
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `echo: ${params.arguments?.text ?? ''}` }],
        },
      });
      break;
    }
    default:
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } });
      }
  }
}
