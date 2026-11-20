import { appendFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeGoal } from './dreamer-dedup.js';
/** Default cap on how many recent explorations to surface in the prompt. */
export const DEFAULT_EXPLORATION_LIMIT = 8;
/**
 * Generate an 8-char hex id from timestamp + random. Same scheme as
 * memory.ts's generateMemoryId — collisions don't matter (the file is
 * append-only, and ids are for operator grep, not for joins).
 */
function generateExplorationId() {
    const ts = Date.now().toString(16).slice(-6);
    const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return `expl_${ts}${rand}`;
}
/**
 * Append a single exploration record. Writes are atomic per-line (the
 * underlying appendFile call is a single write syscall on Linux/macOS
 * for chunks under the pipe buffer). Returns the record that was
 * written so callers can correlate it with downstream actions.
 *
 * `input.id` and `input.ts` are optional — when omitted, fresh values
 * are generated. This makes the function easy to call (just goal +
 * origin + priority) while keeping it testable (tests can pin ids).
 */
export async function appendExploration(explorationsPath, input) {
    const record = {
        id: input.id ?? generateExplorationId(),
        ts: input.ts ?? new Date().toISOString(),
        goal: input.goal,
        origin: input.origin,
        priority: input.priority,
        ...(input.voyage_id !== undefined ? { voyage_id: input.voyage_id } : {}),
    };
    await mkdir(dirname(explorationsPath), { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await appendFile(explorationsPath, line, 'utf8');
    return record;
}
/**
 * Load recent exploration records (sync version for use inside the
 * curiosity user-prompt builder, which must stay sync because the
 * prompt is constructed synchronously before the LLM call).
 *
 * Returns records in reverse-chronological order (most recent first),
 * capped at `max`. Missing file or malformed lines are tolerated — a
 * fresh agent with no explorations gets back [].
 */
export function loadRecentExplorationsSync(explorationsPath, max = DEFAULT_EXPLORATION_LIMIT) {
    let raw;
    try {
        raw = readFileSync(explorationsPath, 'utf8');
    }
    catch {
        return [];
    }
    const records = [];
    for (const line of raw.split('\n')) {
        if (line.trim().length === 0)
            continue;
        try {
            records.push(JSON.parse(line));
        }
        catch {
            // Skip malformed line — same tolerance as voyage-log/loadRecentVoyageSummariesSync.
        }
    }
    // Reverse-chronological. Stable sort so ties preserve file order.
    const sorted = [...records].sort((a, b) => b.ts.localeCompare(a.ts));
    return sorted.slice(0, max);
}
/**
 * Join a list of explorations with a trace, producing per-exploration
 * outcomes. Each exploration is matched to the LATEST trace record
 * whose goal normalizes to the same key (see `normalizeGoal` in
 * dreamer.ts — strips punctuation, lowercases, collapses whitespace).
 *
 * Multiple explorations of the same goal share the same trace outcome;
 * both render in the prompt so the LLM sees "proposed twice, last
 * executed on DATE with outcome Z".
 *
 * Returns the outcomes in the same order as the input explorations
 * (caller has already sorted them — typically reverse-chronological
 * from loadRecentExplorationsSync).
 */
export function joinWithTraceOutcomes(explorations, trace) {
    // Index trace records by normalized goal, keeping only the latest per goal.
    const latestByGoal = new Map();
    for (const r of trace) {
        if (r.goal.trim().length === 0)
            continue;
        const key = normalizeGoal(r.goal);
        if (key.length === 0)
            continue;
        const existing = latestByGoal.get(key);
        if (existing === undefined || r.ts.localeCompare(existing.ts) > 0) {
            latestByGoal.set(key, r);
        }
    }
    return explorations.map((exploration) => {
        const key = normalizeGoal(exploration.goal);
        const match = key.length > 0 ? latestByGoal.get(key) : undefined;
        if (match === undefined) {
            return {
                exploration,
                traceOutcome: null,
                traceOutcomeAt: null,
                traceFailReason: null,
            };
        }
        return {
            exploration,
            traceOutcome: match.outcome,
            traceOutcomeAt: match.ts,
            traceFailReason: match.fail_reason,
        };
    });
}
/**
 * Render explorations as a markdown block for injection into the
 * curiosity user prompt. Returns '' for empty input so callers can
 * skip the section entirely.
 *
 * Output shape:
 *
 *   ### Recent explorations
 *   - [proposed→success] add SELF_MONITOR_INTERVAL (prio 80, 2d ago)
 *   - [proposed→failure] extract json helper (prio 75, 5d ago) — FAIL: tsc errored
 *   - [proposed, never executed] add workWaypointCounter (prio 90, just now)
 */
export function formatExplorationsMarkdown(outcomes) {
    if (outcomes.length === 0)
        return '';
    const lines = ['### Recent explorations'];
    for (const o of outcomes) {
        const expl = o.exploration;
        const outcomeLabel = o.traceOutcome === null
            ? 'proposed, never executed'
            : `proposed→${o.traceOutcome}`;
        const age = formatAge(expl.ts);
        const fail = o.traceFailReason !== null && o.traceOutcome === 'failure'
            ? ` — FAIL: ${truncate(o.traceFailReason, 100)}`
            : '';
        lines.push(`- [${outcomeLabel}] ${truncate(expl.goal, 140)} (prio ${expl.priority}, ${age})${fail}`);
    }
    return lines.join('\n');
}
/** Render a relative age label like "just now", "3h ago", "5d ago". */
function formatAge(ts) {
    const then = Date.parse(ts);
    if (Number.isNaN(then))
        return 'unknown age';
    const ms = Date.now() - then;
    if (ms < 60_000)
        return 'just now';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + '…';
}
//# sourceMappingURL=exploration-log.js.map