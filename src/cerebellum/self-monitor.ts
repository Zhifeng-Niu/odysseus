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

/**
 * One entry in the rolling tool-call window. `tool` is always present;
 * `target` is an optional short signature (file path, command head)
 * extracted from the call's args. The pair is enough for the nudge to
 * name concrete behavior ("3× file-read(src/a.ts, src/b.ts, src/c.ts)")
 * instead of an abstract count.
 */
export interface ToolCallObservation {
  readonly tool: string;
  readonly target?: string;
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
 */
export function summarizeToolCall(toolName: string, args: unknown): ToolCallObservation {
  if (!isObject(args)) return { tool: toolName };
  // Prefer `path`, fall back to `file_path`. Both spellings appear
  // across our own tool registry and the Anthropic-style spec.
  const path = typeof args.path === 'string'
    ? args.path
    : typeof args.file_path === 'string'
      ? args.file_path
      : undefined;
  if (path !== undefined && path.trim().length > 0) {
    return { tool: toolName, target: truncatePath(path) };
  }
  if (typeof args.command === 'string' && args.command.trim().length > 0) {
    return { tool: toolName, target: truncate(args.command.trim(), 40) };
  }
  if (typeof args.message === 'string' && args.message.trim().length > 0) {
    return { tool: toolName, target: truncate(args.message.trim(), 30) };
  }
  return { tool: toolName };
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
 * Detect the most actionable pattern in the recent window and emit a
 * one-sentence observation. Returns null when no pattern matches — the
 * caller then omits the observation, keeping the nudge tight.
 *
 * Patterns, in priority order (first match wins):
 *
 *   1. STUCK LOOP — same tool + same target N≥3 times. Strongest
 *      signal; the agent is hitting the same call with the same args
 *      and getting nowhere. Bail out and re-read the goal.
 *
 *   2. SAME-TOOL STREAK — same tool N≥3 times, different targets.
 *      Could be healthy (verify, verify, verify) or drift (read, read,
 *      read without acting). Call it out by name; let the LLM judge.
 *
 *   3. BREADTH-WITHOUT-ACTION — 3+ read-class calls (file-read,
 *      git-log, git-status) and 0 write-class calls (file-edit,
 *      file-write, bash). Agent is exploring but hasn't started
 *      producing. Suggest picking an anchor.
 *
 *   4. ERROR-LOOP — last 2 calls both errored (signal carried in
 *      ToolCallObservation when caller marks it). Out of scope for the
 *      pure signature; future extension.
 *
 *   5. HIGH-COUNT NO-DONE — totalCallCount ≥ 9 and no DONE in recent.
 *      The agent has spent real budget; nudge toward smaller diff.
 *
 * Pattern detection runs in O(window) — cheap.
 */
export function detectPattern(
  recent: readonly ToolCallObservation[],
  totalCallCount: number,
): string | null {
  if (recent.length === 0) return null;

  // 1. STUCK LOOP — same tool + same target 3+ times.
  const stuckLoop = detectStuckLoop(recent);
  if (stuckLoop !== null) return stuckLoop;

  // 2. SAME-TOOL STREAK — same tool 3+ times (targets may differ).
  const streak = detectSameToolStreak(recent);
  if (streak !== null) return streak;

  // 3. BREADTH-WITHOUT-ACTION.
  const breadth = detectBreadthWithoutAction(recent);
  if (breadth !== null) return breadth;

  // 4. (reserved for error-loop in a future iteration)

  // 5. HIGH-COUNT NO-DONE.
  if (totalCallCount >= 9) {
    return (
      `You've made ${totalCallCount} tool calls without reaching DONE. ` +
      `Consider: ship a smaller diff now (DONE) and let a follow-up waypoint refine — ` +
      `a finished small step beats an unfinished perfect one.`
    );
  }

  return null;
}

function detectStuckLoop(recent: readonly ToolCallObservation[]): string | null {
  if (recent.length < 3) return null;
  // Look at the last 3 entries — if all match on tool+target, it's a stuck loop.
  const last3 = recent.slice(-3);
  const first = last3[0]!;
  for (const entry of last3.slice(1)) {
    if (entry.tool !== first.tool) return null;
    if ((entry.target ?? '') !== (first.target ?? '')) return null;
  }
  const targetLabel = first.target !== undefined ? ` (${first.target})` : '';
  return (
    `You've called ${first.tool}${targetLabel} 3 times in a row with the same arguments — ` +
    `this is a stuck loop, not convergence. Stop and re-read the goal, or pick a different tool.`
  );
}

function detectSameToolStreak(recent: readonly ToolCallObservation[]): string | null {
  if (recent.length < 3) return null;
  const last3 = recent.slice(-3);
  const tool = last3[0]!.tool;
  for (const entry of last3.slice(1)) {
    if (entry.tool !== tool) return null;
  }
  // Same tool, varying targets — name the specific tool.
  const targets = last3
    .map((e) => e.target ?? '?')
    .filter((t) => t !== '?');
  const targetList = targets.length > 0 ? ` [${targets.join(', ')}]` : '';
  return (
    `Last 3 calls were all ${tool}${targetList}. ` +
    `Healthy if you're verifying; risky if you're circling. ` +
    `If the next call wouldn't materially advance the goal, switch tools or DONE.`
  );
}

const READ_TOOLS = new Set(['file-read', 'git-log', 'git-status']);
const WRITE_TOOLS = new Set(['file-write', 'file-edit', 'file-delete', 'bash', 'git-commit']);

function detectBreadthWithoutAction(recent: readonly ToolCallObservation[]): string | null {
  if (recent.length < 3) return null;
  let readCount = 0;
  let writeCount = 0;
  for (const entry of recent) {
    if (READ_TOOLS.has(entry.tool)) readCount += 1;
    else if (WRITE_TOOLS.has(entry.tool)) writeCount += 1;
  }
  if (readCount >= 3 && writeCount === 0) {
    return (
      `${readCount} recent reads, 0 writes — you're exploring but haven't acted yet. ` +
      `Pick the most specific anchor file you've seen and make the change. ` +
      `Reading more won't converge; editing will.`
    );
  }
  return null;
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

function formatEntry(entry: ToolCallObservation): string {
  return entry.target !== undefined
    ? `${entry.tool}(${entry.target})`
    : entry.tool;
}
