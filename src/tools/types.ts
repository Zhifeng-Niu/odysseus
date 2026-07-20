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
  /**
   * Whether executing this tool with the given args may mutate the filesystem
   * or repo state. Used by the orchestrator to lazily create checkpoints only
   * before the first mutating call, so conversational waypoints (greetings,
   * status queries, identity questions) pay zero git cost.
   *
   * Default (when omitted): true (conservative). Override to false for
   * read-only tools like file-read or git-log.
   */
  mutates?(args: Record<string, unknown>): boolean;
}

export type { ToolSpec };
