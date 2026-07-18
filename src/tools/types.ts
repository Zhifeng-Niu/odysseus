import type { ToolSpec } from '../llm/provider.js';

export interface ToolContext {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ToolResultOk {
  ok: true;
  value: string;
}

export interface ToolResultErr {
  ok: false;
  error: string;
}

export type ToolResult = ToolResultOk | ToolResultErr;

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export type { ToolSpec };
