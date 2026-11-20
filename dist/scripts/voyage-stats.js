#!/usr/bin/env node
/**
 * Voyage stats CLI — aggregates `.odysseus/trace.jsonl` into a single
 * retrospective view. Answers: "how is the agent actually doing?"
 *
 * Usage:
 *   npm exec tsx -- src/scripts/voyage-stats.ts [options]
 *   node dist/scripts/voyage-stats.js [options]   # after `npm run build`
 *
 * Options:
 *   --summary     Print only the headline line (success rate + token
 *                 total + avg iterations). Useful for dashboards.
 *   --no-trend    Skip the first-half vs second-half trend comparison.
 *   --cwd <path>  Target repo (where .odysseus/ lives).
 *                 Default: process.cwd().
 *
 * Exit codes:
 *   0  Stats computed successfully (regardless of success rate).
 *   1  Argument parse error or trace.jsonl is unreadable.
 *
 * Token semantics (Iteration 37 fix):
 *   Per-waypoint tokens are computed as DELTAS within each voyage.
 *   The orchestrator writes its running `state.totalInput` into trace.jsonl,
 *   so within a voyage each record's total includes every prior waypoint.
 *   This CLI differences same-voyage records to recover per-waypoint cost.
 *   Legacy records without `voyage_id` are treated as standalone.
 *
 * Examples:
 *   npm exec tsx -- src/scripts/voyage-stats.ts
 *   npm exec tsx -- src/scripts/voyage-stats.ts --summary
 *   npm exec tsx -- src/scripts/voyage-stats.ts --cwd /path/to/repo
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeVoyageStats, formatVoyageStatsMarkdown, } from '../cerebellum/voyage-stats.js';
export function parseCliArgs(argv) {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            summary: { type: 'boolean', default: false },
            trend: { type: 'boolean', default: true },
            cwd: { type: 'string', default: process.cwd() },
        },
        allowPositionals: false,
    });
    return {
        summary: values.summary === true,
        trend: values.trend !== false,
        cwd: typeof values.cwd === 'string' ? values.cwd : process.cwd(),
    };
}
export function readTraceRecords(cwd) {
    const path = join(cwd, '.odysseus', 'trace.jsonl');
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    }
    catch (err) {
        throw new Error(`trace.jsonl not readable at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const records = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            records.push(JSON.parse(trimmed));
        }
        catch {
            // Skip malformed line — same defensive parse as readTrace in
            // src/trace/jsonl.ts. A single corrupt line shouldn't blow up
            // the whole retrospective.
        }
    }
    return records;
}
function formatSummary(stats) {
    const pct = `${(stats.successRate * 100).toFixed(0)}%`;
    const tokens = `${(stats.totalTokens.input / 1_000_000).toFixed(1)}M in / ${(stats.totalTokens.output / 1_000_000).toFixed(2)}M out`;
    const avgIters = stats.avgIterations.toFixed(1);
    const outcomes = `${stats.outcomes.success}/${stats.outcomes.failure}/${stats.outcomes.abandoned}`;
    return (`${stats.totalWaypoints} waypoints | success ${pct} (${outcomes}) | ` +
        `${tokens} | avg ${avgIters} iters/wp`);
}
function main() {
    let options;
    try {
        options = parseCliArgs(process.argv.slice(2));
    }
    catch (err) {
        process.stderr.write(`argument parse error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }
    let records;
    try {
        records = readTraceRecords(options.cwd);
    }
    catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }
    if (records.length === 0) {
        process.stdout.write('(no trace records found)\n');
        process.exit(0);
    }
    const stats = computeVoyageStats(records);
    if (options.summary) {
        process.stdout.write(formatSummary(stats) + '\n');
    }
    else {
        const markdown = options.trend
            ? formatVoyageStatsMarkdown(stats)
            : formatVoyageStatsMarkdown({ ...stats, trend: null });
        process.stdout.write(markdown + '\n');
    }
    process.exit(0);
}
main();
//# sourceMappingURL=voyage-stats.js.map