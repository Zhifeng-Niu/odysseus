/**
 * Pattern-detection heuristics for the self-monitor nudge.
 *
 * Iteration 48 (2026-07-21) extracted these from self-monitor.ts
 * (318 → 205 lines). The pattern detectors are pure functions over
 * the rolling tool-call window — no I/O, no formatting decisions,
 * no public-API surface beyond detectPattern itself. Separating them
 * from the observation-builder makes both halves easier to evolve:
 *   - Adding a new pattern (e.g. "tool-call latency spike") touches
 *     only this file.
 *   - Changing the nudge format (e.g. adding timestamps) touches only
 *     self-monitor.ts.
 *
 * The detector order in detectPattern is load-bearing — see the
 * docstring there. Patterns fire first-match-wins, so the priority
 * sequence reflects which signal is most actionable when multiple
 * overlap.
 */
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
 *   4. ERROR-LOOP — last 2 calls both errored. The agent is retrying
 *      without diagnosing; the cost of one more blind retry is much
 *      higher than the cost of re-reading the error message.
 *
 *   5. HIGH-COUNT NO-DONE — totalCallCount ≥ 9 and no DONE in recent.
 *      The agent has spent real budget; nudge toward smaller diff.
 *
 * Pattern detection runs in O(window) — cheap.
 */
export function detectPattern(recent, totalCallCount) {
    if (recent.length === 0)
        return null;
    // 1. STUCK LOOP — same tool + same target 3+ times.
    const stuckLoop = detectStuckLoop(recent);
    if (stuckLoop !== null)
        return stuckLoop;
    // 2. SAME-TOOL STREAK — same tool 3+ times (targets may differ).
    const streak = detectSameToolStreak(recent);
    if (streak !== null)
        return streak;
    // 3. BREADTH-WITHOUT-ACTION.
    const breadth = detectBreadthWithoutAction(recent);
    if (breadth !== null)
        return breadth;
    // 4. ERROR-LOOP — last 2 calls both errored (Iteration 14).
    const errorLoop = detectErrorLoop(recent);
    if (errorLoop !== null)
        return errorLoop;
    // 5. HIGH-COUNT NO-DONE.
    if (totalCallCount >= 9) {
        return (`You've made ${totalCallCount} tool calls without reaching DONE. ` +
            `Consider: ship a smaller diff now (DONE) and let a follow-up waypoint refine — ` +
            `a finished small step beats an unfinished perfect one.`);
    }
    return null;
}
function detectStuckLoop(recent) {
    if (recent.length < 3)
        return null;
    // Look at the last 3 entries — if all match on tool+target, it's a stuck loop.
    const last3 = recent.slice(-3);
    const first = last3[0];
    for (const entry of last3.slice(1)) {
        if (entry.tool !== first.tool)
            return null;
        if ((entry.target ?? '') !== (first.target ?? ''))
            return null;
    }
    const targetLabel = first.target !== undefined ? ` (${first.target})` : '';
    return (`You've called ${first.tool}${targetLabel} 3 times in a row with the same arguments — ` +
        `this is a stuck loop, not convergence. Stop and re-read the goal, or pick a different tool.`);
}
function detectSameToolStreak(recent) {
    if (recent.length < 3)
        return null;
    const last3 = recent.slice(-3);
    const tool = last3[0].tool;
    for (const entry of last3.slice(1)) {
        if (entry.tool !== tool)
            return null;
    }
    // Same tool, varying targets — name the specific tool.
    const targets = last3
        .map((e) => e.target ?? '?')
        .filter((t) => t !== '?');
    const targetList = targets.length > 0 ? ` [${targets.join(', ')}]` : '';
    return (`Last 3 calls were all ${tool}${targetList}. ` +
        `Healthy if you're verifying; risky if you're circling. ` +
        `If the next call wouldn't materially advance the goal, switch tools or DONE.`);
}
const READ_TOOLS = new Set(['file-read', 'git-log', 'git-status']);
const WRITE_TOOLS = new Set(['file-write', 'file-edit', 'file-delete', 'bash', 'git-commit']);
function detectBreadthWithoutAction(recent) {
    if (recent.length < 3)
        return null;
    let readCount = 0;
    let writeCount = 0;
    for (const entry of recent) {
        if (READ_TOOLS.has(entry.tool))
            readCount += 1;
        else if (WRITE_TOOLS.has(entry.tool))
            writeCount += 1;
    }
    if (readCount >= 3 && writeCount === 0) {
        return (`${readCount} recent reads, 0 writes — you're exploring but haven't acted yet. ` +
            `Pick the most specific anchor file you've seen and make the change. ` +
            `Reading more won't converge; editing will.`);
    }
    return null;
}
/**
 * ERROR-LOOP — last 2 calls in the window both errored. The agent is
 * likely retrying without diagnosis. Strong nudge: stop, re-read the
 * error message, change approach. Distinct from STUCK LOOP (which
 * fires at 3× same-call): error-loop fires earlier — at the second
 * consecutive failure, regardless of whether the tool/target match.
 *
 * Threshold of 2 (not 3) is deliberate. A single error is normal
 * (transient: file doesn't exist yet, command needs different flag).
 * Two errors in a row is the smallest pattern that says "your mental
 * model of the situation is wrong" — the agent should diagnose, not
 * retry. Waiting for 3 would waste one more tool call against a
 * broken approach.
 */
function detectErrorLoop(recent) {
    if (recent.length < 2)
        return null;
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];
    if (last.error !== true || prev.error !== true)
        return null;
    // Name both failing calls concretely so the LLM can recognize them.
    const lastLabel = formatEntry(last);
    const prevLabel = formatEntry(prev);
    return (`Last 2 tool calls errored (${prevLabel}, ${lastLabel}). ` +
        `Don't retry blindly — re-read the error messages above and change ` +
        `your approach. The same call with the same args will likely fail ` +
        `the same way.`);
}
/**
 * Shared display helper. Exported so self-monitor.ts's
 * buildSelfMonitorObservation can format entries identically to how
 * detectErrorLoop formats them — a single source of truth for the
 * "tool(target)" / "tool" rendering avoids drift between the two
 * surfaces where users see these labels.
 */
export function formatEntry(entry) {
    return entry.target !== undefined
        ? `${entry.tool}(${entry.target})`
        : entry.tool;
}
//# sourceMappingURL=self-monitor-patterns.js.map