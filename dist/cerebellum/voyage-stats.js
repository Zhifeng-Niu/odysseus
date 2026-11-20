// Re-export the formatter so existing importers (src/scripts/voyage-stats.ts,
// tests/unit/cerebellum-voyage-stats.test.ts) do not need to know about the
// internal split. Same pattern as memory.ts re-exporting memory-parse.js
// (Iter 53).
export { formatVoyageStatsMarkdown } from './voyage-stats-format.js';
const TOP_REASONS_LIMIT = 5;
/**
 * Normalize a fail/abandon reason for aggregation. Long reasons have
 * details that vary per-occurrence ("threshold N", specific tool name,
 * iteration count). Without normalization, each variant is its own
 * bucket and the aggregation loses signal.
 *
 * Strategy: take the prefix before the first delimiter among `:`, `—`,
 * `(`. If no delimiter, take the first 60 chars. Examples:
 *   "hit maxIterations (16) without DONE — agent did not converge"
 *     → "hit maxIterations"
 *   "early termination: agent produced 3 consecutive..."
 *     → "early termination"
 *   "agent emitted [CONVERSATIONAL-DONE]: conversational turn complete..."
 *     → "agent emitted [CONVERSATIONAL-DONE]"
 *   "fetch failed" → "fetch failed"
 */
export function normalizeReason(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return '(none)';
    for (const delim of [':', '—', '(']) {
        const idx = trimmed.indexOf(delim);
        if (idx > 0) {
            return trimmed.slice(0, idx).trim();
        }
    }
    return trimmed.length > 60 ? trimmed.slice(0, 60).trim() + '…' : trimmed;
}
/**
 * Compute per-waypoint incremental tokens by differencing consecutive
 * same-voyage records' cumulative `tokens_consumed`. The orchestrator
 * writes its running `state.totalInput`/`totalOutput` into every trace
 * record (orchestrator.ts:689), so within a voyage each record's total
 * INCLUDES every prior waypoint. Naively summing double-counts.
 *
 * Rules:
 *   - `voyage_id` undefined (legacy pre-2026-07-21): treat as standalone.
 *   - First record of a new voyage_id: same as standalone.
 *   - Subsequent: delta from prior record in same voyage. Negative deltas
 *     (shouldn't happen — state is monotonic) clamp to 0.
 */
export function computeIncrementalTokens(records) {
    const lastCumulative = new Map();
    const result = [];
    for (const r of records) {
        const cumulative = {
            input: r.tokens_consumed?.input ?? 0,
            output: r.tokens_consumed?.output ?? 0,
        };
        const vid = r.voyage_id;
        const prev = vid === undefined ? undefined : lastCumulative.get(vid);
        if (prev === undefined) {
            result.push({ ...cumulative });
        }
        else {
            result.push({
                input: Math.max(0, cumulative.input - prev.input),
                output: Math.max(0, cumulative.output - prev.output),
            });
        }
        if (vid !== undefined)
            lastCumulative.set(vid, { ...cumulative });
    }
    return result;
}
function sumTokens(incremental) {
    let input = 0;
    let output = 0;
    for (const t of incremental) {
        input += t.input;
        output += t.output;
    }
    return { input, output };
}
function computeSlice(records, incremental) {
    const n = records.length;
    if (n === 0) {
        return {
            waypoints: 0,
            successRate: 0,
            failureRate: 0,
            abandonedRate: 0,
            avgIterations: 0,
            avgInputTokens: 0,
        };
    }
    const counts = countOutcomes(records);
    const tokens = sumTokens(incremental);
    const totalIters = records.reduce((sum, r) => sum + (r.iterations_used ?? 0), 0);
    return {
        waypoints: n,
        successRate: counts.success / n,
        failureRate: counts.failure / n,
        abandonedRate: counts.abandoned / n,
        avgIterations: totalIters / n,
        avgInputTokens: tokens.input / n,
    };
}
export function countOutcomes(records) {
    let success = 0;
    let failure = 0;
    let abandoned = 0;
    for (const r of records) {
        if (r.outcome === 'success')
            success += 1;
        else if (r.outcome === 'failure')
            failure += 1;
        else if (r.outcome === 'abandoned')
            abandoned += 1;
    }
    return { success, failure, abandoned };
}
function aggregateReasons(records, outcome) {
    const counts = new Map();
    for (const r of records) {
        if (r.outcome !== outcome)
            continue;
        const normalized = normalizeReason(r.fail_reason ?? '(none)');
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_REASONS_LIMIT);
}
export function computeVoyageStats(records) {
    const total = records.length;
    const outcomes = countOutcomes(records);
    const incremental = computeIncrementalTokens(records);
    const tokens = sumTokens(incremental);
    const totalIters = records.reduce((sum, r) => sum + (r.iterations_used ?? 0), 0);
    let trend = null;
    if (total >= 4) {
        const half = Math.floor(total / 2);
        trend = {
            firstHalf: computeSlice(records.slice(0, half), incremental.slice(0, half)),
            secondHalf: computeSlice(records.slice(half), incremental.slice(half)),
        };
    }
    return {
        totalWaypoints: total,
        outcomes,
        successRate: total > 0 ? outcomes.success / total : 0,
        totalTokens: tokens,
        avgTokensPerWaypoint: {
            input: total > 0 ? tokens.input / total : 0,
            output: total > 0 ? tokens.output / total : 0,
        },
        avgIterations: total > 0 ? totalIters / total : 0,
        topFailReasons: aggregateReasons(records, 'failure'),
        topAbandonedReasons: aggregateReasons(records, 'abandoned'),
        trend,
    };
}
//# sourceMappingURL=voyage-stats.js.map