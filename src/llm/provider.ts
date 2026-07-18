export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    /**
     * JSON Schema object describing the tool's input parameters.
     * Most providers expect `{ type: 'object', properties: {...}, required: [...] }`.
     * Untyped here to avoid coupling the interface to a specific JSON Schema version.
     */
    parameters: Record<string, unknown>;
  };
}

export interface LLMCompleteOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  history?: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMFinishReason = 'stop' | 'length' | 'tool_calls' | 'error';

export interface LLMCompletion {
  content: string;
  model: string;
  usage: LLMUsage;
  finishReason: LLMFinishReason;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  complete(prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion>;
  stream(prompt: string, options?: LLMCompleteOptions): AsyncIterable<string>;
  getModel(): string;
}
