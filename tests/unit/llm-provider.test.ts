import { describe, test, expect, expectTypeOf } from 'vitest';
import type { LLMProvider, LLMCompletion, LLMCompleteOptions, LLMFinishReason } from '../../src/llm/provider.js';

describe('LLMProvider interface contract', () => {
  test('LLMCompletion has the required shape', () => {
    const completion: LLMCompletion = {
      content: 'hello',
      model: 'glm-5.2',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop',
    };
    expect(completion.content).toBe('hello');
    expect(completion.usage.inputTokens).toBe(10);
  });

  test('LLMCompleteOptions allows tools and history', () => {
    const opts: LLMCompleteOptions = {
      model: 'glm-5.2',
      maxTokens: 1024,
      temperature: 0.7,
      tools: [],
      history: [{ role: 'user', content: 'hi' }],
    };
    expect(opts.maxTokens).toBe(1024);
  });

  test('LLMProvider interface is structurally complete', () => {
    const provider: LLMProvider = {
      async complete() {
        return {
          content: '',
          model: 'mock',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield '';
      },
      getModel() {
        return 'mock';
      },
    };
    expect(provider.getModel()).toBe('mock');
  });

  test('LLMFinishReason is the exhaustive union', () => {
    expectTypeOf<LLMFinishReason>().toEqualTypeOf<'stop' | 'length' | 'tool_calls' | 'error'>();
  });

  test('LLMCompleteOptions accepts full options shape', () => {
    const opts: LLMCompleteOptions = {
      model: 'glm-5.2',
      maxTokens: 2048,
      temperature: 0.4,
      systemPrompt: 'you are a coding agent',
      history: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: { type: 'function', function: { name: 'file_read' } },
      signal: new AbortController().signal,
    };
    expectTypeOf(opts).toMatchTypeOf<LLMCompleteOptions>();
  });
});
