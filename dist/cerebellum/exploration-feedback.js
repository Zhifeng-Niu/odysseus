import { normalizeGoal } from './dreamer-dedup.js';
/**
 * Exploration feedback loop — closes self-model aspiration #3
 * ("Exploration-outcome feedback loop: demote for N voyages after 3
 * failures; mark closed when shipped").
 *
 * Extracted from exploration-log.ts (Iteration 48) to keep that file
 * under the 260-line size cap. Same extraction pattern as dreamer.ts →
 * dreamer-dedup.ts / extract-json.ts / prompts.ts.
 *
 * The feedback loop gives curiosity a closed-loop signal: instead of
 * re-deciding from scratch each voyage, the agent sees which past
 * explorations have repeatedly failed (→ demote, skip) and which have
 * shipped (→ mark closed, do not re-propose).
 */
/**
 * Threshold: after this many consecutive failures for the same goal
 * (normalized), the exploration is considered "demoted" and the LLM is
 * told to skip it.
 */
export const DEMOTION_FAILURE_THRESHOLD = 3;
/**
 * Compute per-exploration stats from a list of exploration outcomes.
 * Each exploration is matched against the full trace to count total
 * attempts, successes, failures, and consecutive failures.
 *
 * The "consecutive failures" count walks trace records for the same
 * normalized goal in reverse-chronological order, counting failures
 * until a non-failure (success or abandoned) is encountered.
 *
 * Returns stats only for explorations that have at least one trace
 * match — explorations that were never executed carry no feedback
 * signal and are omitted.
 */
export function computeExplorationStats(outcomes, trace) {
    // Index trace records by normalized goal, preserving chronological order.
    const traceByGoal = new Map();
    for (const r of trace) {
        if (r.goal.trim().length === 0)
            continue;
        const key = normalizeGoal(r.goal);
        if (key.length === 0)
            continue;
        const existing = traceByGoal.get(key);
        if (existing === undefined) {
            traceByGoal.set(key, [r]);
        }
        else {
            existing.push(r);
        }
    }
    const stats = [];
    const seen = new Set();
    for (const o of outcomes) {
        const key = normalizeGoal(o.exploration.goal);
        if (key.length === 0 || seen.has(key))
            continue;
        const records = traceByGoal.get(key);
        if (records === undefined)
            continue; // never executed — no stats
        seen.add(key);
        // Sort chronologically (oldest first) for consecutive-failure walk.
        const sorted = [...records].sort((a, b) => a.ts.localeCompare(b.ts));
        let successCount = 0;
        let failureCount = 0;
        for (const r of sorted) {
            if (r.outcome === 'success')
                successCount += 1;
            else if (r.outcome === 'failure')
                failureCount += 1;
        }
        // Walk backward from most recent, counting consecutive failures.
        let consecutiveFailures = 0;
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].outcome === 'failure') {
                consecutiveFailures += 1;
            }
            else {
                break;
            }
        }
        const lastSucceeded = sorted[sorted.length - 1].outcome === 'success';
        stats.push({
            goalKey: key,
            goalSample: o.exploration.goal,
            totalAttempts: sorted.length,
            successCount,
            failureCount,
            consecutiveFailures,
            lastSucceeded,
            demoted: consecutiveFailures >= DEMOTION_FAILURE_THRESHOLD,
        });
    }
    return stats;
}
/**
 * Render exploration stats as a guidance block for the curiosity prompt.
 * Only renders entries that carry actionable signal: demoted explorations
 * (skip these) and recently-succeeded explorations (mark as closed).
 *
 * Returns '' when no stats carry signal so callers can skip the section.
 *
 * Output shape:
 *
 *   ### Exploration feedback
 *   - DEMOTED (3 consecutive failures): add workWaypointCounter — skip for now, pick a different aspiration
 *   - SHIPPED (succeeded): extract json helper — aspiration closed, do not re-propose
 */
export function formatExplorationFeedback(stats) {
    const signal = stats.filter((s) => s.demoted || s.lastSucceeded);
    if (signal.length === 0)
        return '';
    const lines = ['### Exploration feedback'];
    for (const s of signal) {
        if (s.demoted) {
            lines.push(`- DEMOTED (${s.consecutiveFailures} consecutive failures): ${truncate(s.goalSample, 100)} — skip for now, pick a different aspiration`);
        }
        else if (s.lastSucceeded) {
            lines.push(`- SHIPPED (succeeded): ${truncate(s.goalSample, 100)} — aspiration closed, do not re-propose`);
        }
    }
    return lines.join('\n');
}
/**
 * Analyse exploration outcomes and produce a per-aspiration action
 * decision:
 *
 * - **close** — at least one attempt succeeded (the aspiration shipped).
 * - **demote** — the last 3 attempts all failed (stop re-proposing).
 * - **continue** — neither condition met (keep exploring).
 *
 * Entries are grouped by `aspiration` (exact string match). Within a
 * group the entries are assumed to be in chronological order (oldest
 * first), so "last 3" = the final three entries. The "close" rule takes
 * priority over "demote": if any attempt ever succeeded the aspiration
 * is considered closed regardless of later failures.
 *
 * Returns one {@link ExplorationAction} per unique aspiration, in the
 * order aspirations first appear in the input.
 */
export function analyzeExplorationOutcomes(entries) {
    // Group entries by aspiration, preserving first-appearance order.
    const groups = new Map();
    for (const entry of entries) {
        const existing = groups.get(entry.aspiration);
        if (existing === undefined) {
            groups.set(entry.aspiration, [entry]);
        }
        else {
            existing.push(entry);
        }
    }
    const results = [];
    for (const [aspiration, group] of groups) {
        // close if any attempt succeeded — takes priority over demote.
        if (group.some((e) => e.outcome === 'success')) {
            results.push({ aspiration, action: 'close' });
            continue;
        }
        // demote if the last 3 attempts all failed.
        const last3 = group.slice(-3);
        if (last3.length === 3 && last3.every((e) => e.outcome === 'failure')) {
            results.push({ aspiration, action: 'demote' });
            continue;
        }
        results.push({ aspiration, action: 'continue' });
    }
    return results;
}
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + '…';
}
//# sourceMappingURL=exploration-feedback.js.map