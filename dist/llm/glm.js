import { withRetry } from './retry.js';
export class LLMError extends Error {
    status;
    responseBody;
    constructor(message, status, responseBody) {
        super(message);
        this.status = status;
        this.responseBody = responseBody;
        this.name = 'LLMError';
    }
}
export class GLMProvider {
    config;
    constructor(config) {
        this.config = {
            maxTokensDefault: 4096,
            temperatureDefault: 0.7,
            requestTimeoutMs: 60_000,
            ...config,
        };
    }
    getModel() {
        return this.config.model;
    }
    async complete(prompt, options) {
        const body = this.buildRequestBody(prompt, options, false);
        return withRetry(async () => {
            const response = await this.fetchEndpoint('/chat/completions', body);
            return this.parseCompletionResponse(response);
        }, {
            maxAttempts: 3,
            baseDelayMs: 500,
            shouldRetry: (err) => {
                if (err instanceof LLMError) {
                    return err.status >= 500 || err.status === 429;
                }
                return true;
            },
        });
    }
    async *stream(prompt, options) {
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
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:'))
                        continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === '[DONE]')
                        return;
                    try {
                        const parsed = JSON.parse(payload);
                        const delta = parsed.choices[0]?.delta?.content;
                        if (delta)
                            yield delta;
                    }
                    catch {
                        // Skip malformed chunks
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    buildRequestBody(prompt, options, stream) {
        const messages = [];
        if (options?.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        if (options?.history?.length) {
            for (const msg of options.history) {
                // Wire format is snake_case (tool_calls, tool_call_id). Internal
                // ChatMessage uses camelCase; convert here so GLM accepts the request.
                const wire = { role: msg.role, content: msg.content };
                if (msg.toolCalls) {
                    wire.tool_calls = msg.toolCalls;
                }
                if (msg.toolCallId) {
                    wire.tool_call_id = msg.toolCallId;
                }
                messages.push(wire);
            }
        }
        // An empty prompt signals "continue from history" — common when the last
        // history entry is a tool result. Skip the user message entirely; pushing
        // `{ role: 'user', content: '' }` would confuse the model.
        if (prompt.length > 0) {
            messages.push({ role: 'user', content: prompt });
        }
        const body = {
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
    async fetchEndpoint(path, body) {
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
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async parseCompletionResponse(response) {
        if (!response.ok) {
            const text = await response.text();
            throw new LLMError(`GLM API ${response.status}`, response.status, text);
        }
        const data = (await response.json());
        const choice = data.choices[0];
        if (!choice) {
            throw new LLMError('GLM API: no choices in response', 0, JSON.stringify(data));
        }
        const message = choice.message;
        const toolCalls = message?.tool_calls?.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        const completion = {
            content: message?.content ?? '',
            model: data.model,
            usage: {
                inputTokens: data.usage?.prompt_tokens ?? 0,
                outputTokens: data.usage?.completion_tokens ?? 0,
            },
            finishReason: choice.finish_reason ?? 'stop',
        };
        if (toolCalls) {
            completion.toolCalls = toolCalls;
        }
        return completion;
    }
}
//# sourceMappingURL=glm.js.map