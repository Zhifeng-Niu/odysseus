/**
 * Truncation utility for tool results that feed back into the LLM context.
 *
 * Token-efficiency background (Iteration 29): 70 waypoints burned 40M
 * input tokens (avg 571k/waypoint, worst 1.46M). The orchestrator keeps
 * every tool result in conversation history permanently — a `file-read`
 * of a 1500-line file adds ~12k tokens to history for the rest of the
 * waypoint, multiplied by every subsequent iteration. Capping tool
 * output at the source bounds the per-iteration growth rate.
 *
 * This module centralizes the cap policy so every tool applies the
 * same rule and emits the same truncation notice format. Tests pin
 * the contract once, callers apply it uniformly.
 *
 * Notice format (when truncated):
 *   <content within cap>
 *   \n\n[truncated: <label> was <originalChars> chars, showed <from> <cap> — use offset/limit or narrow the query]
 */

export interface TruncateOptions {
  /** Maximum characters to keep. Must be positive. */
  readonly maxChars: number;
  /**
   * Which end to keep. Defaults to 'head' — most useful for file reads
   * (top of file usually has imports/exports/type definitions the agent
   * needs to reason about). Use 'tail' for log-like outputs where the
   * most recent entries matter most.
   */
  readonly from?: 'head' | 'tail';
  /**
   * Human-readable description of what was truncated, used in the
   * notice. Examples: 'file', 'stdout', 'git log output'. Defaults to
   * 'content'.
   */
  readonly label?: string;
}

export interface TruncateResult {
  /** The truncated content, with notice appended if truncation happened. */
  readonly content: string;
  /** True when originalChars exceeded maxChars and content was cut. */
  readonly truncated: boolean;
  /** Original input length, for observability. */
  readonly originalChars: number;
}

/**
 * Cap `input` to `options.maxChars`. When the cap applies, a notice is
 * appended so the LLM can see that data was elided and take action
 * (paginate, narrow the query, etc.).
 *
 * The notice itself is NOT counted against maxChars — it is appended
 * on top. This keeps the visible content size predictable. Caller is
 * responsible for choosing a maxChars that leaves room for the notice
 * in their downstream consumer's budget.
 */
export function truncateForLLM(input: string, options: TruncateOptions): TruncateResult {
  if (!Number.isFinite(options.maxChars) || options.maxChars <= 0) {
    throw new Error(`truncateForLLM: maxChars must be a positive finite number, got ${options.maxChars}`);
  }
  const from = options.from ?? 'head';
  const label = options.label ?? 'content';
  const originalChars = input.length;

  if (originalChars <= options.maxChars) {
    return { content: input, truncated: false, originalChars };
  }

  const kept = from === 'head' ? input.slice(0, options.maxChars) : input.slice(-options.maxChars);
  const notice =
    `\n\n[truncated: ${label} was ${originalChars} chars, showed ${from} ${options.maxChars} — ` +
    `use offset/limit or narrow the query to see more]`;
  return {
    content: kept + notice,
    truncated: true,
    originalChars,
  };
}
