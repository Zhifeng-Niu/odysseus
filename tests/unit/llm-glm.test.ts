import { describe, test, expect, vi, afterEach } from 'vitest';
import { GLMProvider } from '../../src/llm/glm.js';

describe('GLMProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('getModel returns configured model', () => {
    const provider = new GLMProvider({
      apiKey: 'test-key',
      model: 'glm-5.2',
      baseUrl: 'https://example.com/api/paas/v4',
    });
    expect(provider.getModel()).toBe('glm-5.2');
  });

  test('complete sends OpenAI-compatible request and parses response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-1',
        model: 'glm-5.2',
        choices: [
          {
            message: { role: 'assistant', content: 'hello world' },
            finish_reason: 'stop',
            index: 0,
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GLMProvider({
      apiKey: 'test-key',
      model: 'glm-5.2',
      baseUrl: 'https://example.com/api/paas/v4',
    });

    const result = await provider.complete('Say hello');

    expect(result.content).toBe('hello world');
    expect(result.model).toBe('glm-5.2');
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(2);
    expect(result.finishReason).toBe('stop');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.com/api/paas/v4/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('glm-5.2');
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Say hello' });
  });

  test('complete throws LLMError on non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key',
    } as unknown as Response);

    const provider = new GLMProvider({
      apiKey: 'bad',
      model: 'glm-5.2',
      baseUrl: 'https://example.com/api/paas/v4',
    });

    await expect(provider.complete('hi')).rejects.toThrow(/GLM API 401/);
  });

  test('stream yields chunks from SSE response', async () => {
    const encoder = new TextEncoder();
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"hel"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as unknown as Response);

    const provider = new GLMProvider({
      apiKey: 'test-key',
      model: 'glm-5.2',
      baseUrl: 'https://example.com/api/paas/v4',
    });

    const chunks: string[] = [];
    for await (const chunk of provider.stream('hi')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('hello');
  });
});
