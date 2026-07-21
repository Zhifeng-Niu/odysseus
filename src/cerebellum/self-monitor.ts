/**
 * Context-aware self-monitor — replaces the fixed "am I repeating?"
 * nudge with a concrete observation derived from the agent's recent
 * tool-call sequence.
 *
 * History: SELF_MONITOR_INTERVAL (every 3 tool calls) used to inject
 * the same fixed string regardless of what the agent was actually
 * doing. The agent already knew its tool-call count — the nudge added
 * no signal density. As of 2026-07-21 (Iteration 12), the nudge shows
 * the recent sequence and names the specific pattern detected.
 *
 * Closes self-model aspiration #1 ("Continuous self-monitor — needs
 * tighter integration with context-aware judgment, not just turn
 * counting"). No LLM call — heuristics only. Token cost stays bounded
 * (~80–200 tokens per nudge), signal density rises sharply.
 */

import { detectPattern, formatEntry } from './self-monitor-patterns.js';

// Re-export moved symbol (Iteration 48 extraction) so existing importers
// (tests) do not need to know about the internal split. Same pattern as
// planner.ts re-exporting planner-policy.js (Iter 42), curiosity.ts
// re-exporting curiosity-prompt.js (Iter 44), and dreamer.ts re-exporting
// dreamer-prompt.js (Iter 47).
export { detectPattern } from './self-monitor-patterns.js';

/**
 * One entry in the rolling tool-call window. `tool` is always present;
 * `target` is an optional short signature (file path, command head)
 * extracted from the call's args. The pair is enough for the nudge to
 * name concrete behavior ("3× file-read(src/a.ts, src/b.ts, src/c.ts)")
 * instead of an abstract count.
 *
 * `error` is set when the orchestrator observed the tool result as a
 * failure (result.ok === false). Used by detectErrorLoop to spot
 * repeated-failure patterns ("last 2 calls errored — re-read the
 * error before the next call"). Optional for backward compatibility
 * with callers that don't yet thread the error bit.
 */
export interface ToolCallObservation {
  readonly tool: string;
  readonly target?: string;
  readonly error?: boolean;
}

/**
 * Maximum number of recent tool calls kept in the rolling window. The
 * nudge never lists more than this; older calls age out. Tuned so the
 * nudge fits on one screen line in most terminals (≈ 80 chars).
 */
export const SELF_MONITOR_WINDOW = 6;

/**
 * Extract a short target signature from common tool-call args. Returns
 * undefined when the args shape is unknown or carries no useful target
 * (e.g., the call has no path or command). The orchestrator calls this
 * once per tool call; the cost is negligible.
 *
 * Recognized arg shapes (kept deliberately small — add more only when
 * a real nudge failure shows the missing one matters):
 *   - { path: '...' }      → file-read / file-edit / file-write
 *   - { file_path: '...' } → alternate spelling (Anthropic-style)
 *   - { command: '...' }   → bash — truncate to keep nudge readable
 *   - { message: '...' }   → git-commit
 *
 * The optional `isError` bit (Iteration 14) carries the tool's execution
 * outcome — when true, the returned observation has `error: true`, which
 * detectErrorLoop uses to spot repeated-failure patterns. Callers that
 * don't yet track tool outcome can omit it; the resulting observation
 * behaves identically to pre-Iteration-14 behavior.
 */
export function summarizeToolCall(
  toolName: string,
  args: unknown,
  isError?: boolean,
): ToolCallObservation {
  if (!isObject(args)) return makeObs(toolName, undefined, isError);
  // Prefer `path`, fall back to `file_path`. Both spellings appear
  // across our own tool registry and the Anthropic-style spec.
  const path = typeof args.path === 'string'
    ? args.path
    : typeof args.file_path === 'string'
      ? args.file_path
      : undefined;
  if (path !== undefined && path.trim().length > 0) {
    return makeObs(toolName, truncatePath(path), isError);
  }
  if (typeof args.command === 'string' && args.command.trim().length > 0) {
    return makeObs(toolName, truncate(args.command.trim(), 40), isError);
  }
  if (typeof args.message === 'string' && args.message.trim().length > 0) {
    return makeObs(toolName, truncate(args.message.trim(), 30), isError);
  }
  return makeObs(toolName, undefined, isError);
}

/**
 * Build a ToolCallObservation with optional target and optional error
 * flag. Centralizing the shape here keeps the exactOptionalPropertyTypes
 * checker happy — we never produce `{ error: undefined }`, only either
 * `{ error: true }` or no `error` field at all.
 */
function makeObs(
  tool: string,
  target: string | undefined,
  isError: boolean | undefined,
): ToolCallObservation {
  if (target !== undefined && isError === true) {
    return { tool, target, error: true };
  }
  if (target !== undefined) {
    return { tool, target };
  }
  if (isError === true) {
    return { tool, error: true };
  }
  return { tool };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Shorten a file path for inline display. Keeps the basename plus the
 * last directory segment when present (`cerebellum/orchestrator.ts`
 * rather than the full absolute path). The agent already knows its
 * cwd; absolute paths add noise.
 */
function truncatePath(p: string): string {
  const trimmed = p.trim();
  // Take last 2 segments max — enough to disambiguate without bloating.
  const segments = trimmed.split('/').filter((s) => s.length > 0);
  if (segments.length <= 2) return trimmed;
  return segments.slice(-2).join('/');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Build the full self-monitor nudge: a concrete sequence listing plus
 * a pattern-based observation. Always returns a non-empty string so
 * the orchestrator can push it as a user message unconditionally.
 *
 * Shape:
 *
 *   [self-monitor] N tool calls. Recent: tool-a, tool-b(x.ts), tool-c.
 *   <observation or "Keep going.">
 *
 * The "Keep going." fallback appears when no pattern matches — positive
 * signal that the current rhythm looks fine. Better than silence: it
 * confirms the monitor ran and had nothing to flag.
 */
export function buildSelfMonitorObservation(
  recent: readonly ToolCallObservation[],
  totalCallCount: number,
): string {
  const sequence = recent.length === 0
    ? '(no recent calls)'
    : recent.map(formatEntry).join(', ');

  const pattern = detectPattern(recent, totalCallCount);
  const observation = pattern ?? 'Keep going — no obvious loop or stall.';

  return (
    `[self-monitor] ${totalCallCount} tool calls so far. Recent: ${sequence}\n` +
    `${observation}`
  );
}
