import { execFileNoThrow } from '../util/exec.js';
import { createRequire } from 'node:module';
/**
 * Iteration 20 — progress layer. Detects the "empty-commit false-success"
 * pattern (commit-audit.ts, Iteration 19): `git diff --cached --quiet`
 * exit 0 made commitWaypoint append `--allow-empty` and create a
 * `waypoint/wp_*-ok` commit despite zero work (~40% of waypoint commits).
 * The verify gate blocks this BEFORE commitWaypoint; a failing layer
 * forces the rollback/failure branch.
 */
// Resolve the real TypeScript compiler shipped with Odysseus. `npx tsc`
// silently falls back to the deprecated npm `tsc` stub (which exits 0 with a
// help message) on systems that have it cached, defeating the syntax gate.
// Pinning to the local `typescript/bin/tsc` keeps the gate trustworthy.
// Resolved LAZILY (first syntax run, not module load): typescript is a
// runtime dependency now, but a broken install must degrade the syntax
// layer gracefully instead of crashing the whole entry point.
let tscBinCache = null;
function resolveTscBin() {
    if (tscBinCache === null) {
        const require = createRequire(import.meta.url);
        tscBinCache = require.resolve('typescript/bin/tsc');
    }
    return tscBinCache;
}
export async function runVerify(input) {
    const results = {
        syntax: 'skipped',
        lint: 'skipped',
        tests: 'skipped',
        metric: 'skipped',
        progress: 'skipped',
    };
    const details = [];
    for (const layer of input.layers) {
        if (layer === 'syntax') {
            let TSC_BIN;
            try {
                TSC_BIN = resolveTscBin();
            }
            catch (err) {
                results.syntax = 'fail';
                details.push(`--- syntax ---\ntypescript unavailable in this install: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
            // Project mode (tsconfig.json present): bare `tsc --noEmit` checks
            // the whole project. No tsconfig → check only the CHANGED .ts files
            // (bare tsc would print help text and fail every waypoint run in an
            // arbitrary directory); git-clean or non-git dirs fall back to the
            // bare call. Enumeration lives in verify-syntax.ts, loaded lazily to
            // keep this module's import surface at exactly two statements.
            const { existsSync } = await import('node:fs');
            const { changedTypeScriptFiles } = await import('./verify-syntax.js');
            const projectMode = existsSync(`${input.cwd}/tsconfig.json`);
            const enumerated = projectMode ? [] : await changedTypeScriptFiles(input.cwd);
            let r;
            if (projectMode || enumerated === 'unavailable') {
                r = await execFileNoThrow('node', [TSC_BIN, '--noEmit'], {
                    cwd: input.cwd,
                    env: input.env ?? process.env,
                });
                results.syntax = r.exitCode === 0 ? 'pass' : 'fail';
                if (r.exitCode !== 0) {
                    details.push(`--- syntax ---\n${r.stdout}\n${r.stderr}`);
                }
            }
            else if (enumerated.length === 0) {
                results.syntax = 'pass'; // no TS changes → nothing to check
            }
            else {
                r = await execFileNoThrow('node', [TSC_BIN, '--noEmit', ...enumerated.slice(0, 50)], { cwd: input.cwd, env: input.env ?? process.env });
                results.syntax = r.exitCode === 0 ? 'pass' : 'fail';
                if (r.exitCode !== 0) {
                    details.push(`--- syntax ---\n${r.stdout}\n${r.stderr}`);
                }
            }
        }
        if (layer === 'tests') {
            // Full vitest suite; --passWithNoTests keeps brand-new codebases
            // green (same "nothing to check is not failure" philosophy as the
            // no-tsconfig syntax fallback).
            const r = await execFileNoThrow('npx', ['vitest', 'run', '--passWithNoTests'], { cwd: input.cwd, env: input.env ?? process.env });
            results.tests = r.exitCode === 0 ? 'pass' : 'fail';
            if (r.exitCode !== 0) {
                details.push(`--- tests ---\n${r.stdout}\n${r.stderr}`);
            }
        }
        if (layer === 'progress') {
            // Iteration 21 — HEAD-aware progress detection: HEAD still being the
            // checkpoint-start commit means zero work (the Iteration 20
            // false-success pattern); HEAD moved means real progress.
            const headR = await execFileNoThrow('git', ['log', '-1', '--format=%s'], { cwd: input.cwd, env: input.env ?? process.env });
            const headSubject = headR.exitCode === 0 ? headR.stdout.trim() : '';
            const headIsCheckpoint = headSubject.startsWith('checkpoint/') && headSubject.endsWith('-start');
            const r = await execFileNoThrow('git', ['status', '--porcelain'], {
                cwd: input.cwd,
                env: input.env ?? process.env,
            });
            if (r.exitCode !== 0) {
                results.progress = 'fail';
                details.push(`--- progress ---\n${r.stdout}\n${r.stderr}`);
            }
            else if (headIsCheckpoint && r.stdout.trim().length === 0) {
                results.progress = 'fail';
                details.push('--- progress ---\nwaypoint produced no file changes and no commits since checkpoint');
            }
            else {
                results.progress = 'pass';
            }
        }
        // lint, metric layers land in a future iteration via self-extension
    }
    const passed = input.layers.every((layer) => results[layer] === 'pass');
    return {
        passed,
        results,
        detail: details.length > 0 ? details.join('\n\n') : undefined,
    };
}
//# sourceMappingURL=verify.js.map