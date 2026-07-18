import type {
  LLMProvider,
  LLMCompletion,
  LLMCompleteOptions,
  ChatMessage,
  ToolCall,
} from './provider.js';
import { withRetry } from './retry.js';

export interface GLMConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokensDefault?: number;
  temperatureDefault?: number;
  requestTimeoutMs?: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

interface OpenAIChoice {
  message?: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  delta?: { content?: string };
  finish_reason?: string;
  index: number;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class GLMProvider implements LLMProvider {
  private readonly config: Required<GLMConfig>;

  constructor(config: GLMConfig) {
    this.config = {
      maxTokensDefault: 4096,
      temperatureDefault: 0.7,
      requestTimeoutMs: 60_000,
      ...config,
    };
  }

  getModel(): string {
    return this.config.model;
  }

  async complete(prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion> {
    const body = this.buildRequestBody(prompt, options, false);
    return withRetry(
      async () => {
        const response = await this.fetchEndpoint('/chat/completions', body);
        return this.parseCompletionResponse(response);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (err) => {
          if (err instanceof LLMError) {
            return err.status >= 500 || err.status === 429;
          }
          return true;
        },
      }
    );
  }

  async *stream(prompt: string, options?: LLMCompleteOptions): AsyncIterable<string> {
    const body = this.buildRequestBody(prompt, options, true);
    const response = await this.fetchEndpoint('/chat/completions', body);

    if (!response.ok) {
      const text = await response.text();
      throw new LLMError(`GLM API ${response.status}`, response.status, text);
    }
    if (!response.body) {
      throw new LLMError('GLM stream: empty body', 0, '');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const parsed = JSON.parse(payload) as OpenAIResponse;
            const delta = parsed.choices[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildRequestBody(
    prompt: string,
    options: LLMCompleteOptions | undefined,
    stream: boolean
  ): Record<string, unknown> {
    const messages: ChatMessage[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options?.history?.length) {
      messages.push(...options.history);
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: options?.model ?? this.config.model,
      messages,
      stream,
      temperature: options?.temperature ?? this.config.temperatureDefault,
      max_tokens: options?.maxTokens ?? this.config.maxTokensDefault,
    };

    if (options?.tools?.length) {
      body.tools = options.tools;
      if (options.toolChoice) {
        body.tool_choice = options.toolChoice;
      }
    }

    return body;
  }

  private async fetchEndpoint(
    path: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseCompletionResponse(response: Response): Promise<LLMCompletion> {
    if (!response.ok) {
      const text = await response.text();
      throw new LLMError(`GLM API ${response.status}`, response.status, text);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices[0];
    if (!choice) {
      throw new LLMError('GLM API: no choices in response', 0, JSON.stringify(data));
    }

    const message = choice.message;
    const toolCalls = message?.tool_calls?.map((tc): ToolCall => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    const completion: LLMCompletion = {
      content: message?.content ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      finishReason: (choice.finish_reason as LLMCompletion['finishReason']) ?? 'stop',
    };
    if (toolCalls) {
      completion.toolCalls = toolCalls;
    }
    return completion;
  }
}
