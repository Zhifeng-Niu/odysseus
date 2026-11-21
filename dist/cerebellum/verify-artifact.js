/**
 * M1 可插拔验证层 · artifact 类型 — non-code task acceptance.
 *
 * Acceptance is DECLARED (by the task-giver/harness in
 * `${cwd}/.odysseus/acceptance.json`), never self-graded by the agent —
 * the same honesty rule as eval/task-suite.ts (outcome ∧ artifact).
 * Relative paths resolve against the agent cwd (never process.cwd() —
 * the lesson from the first live baseline).
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
const SPEC_REL = join('.odysseus', 'acceptance.json');
export async function runArtifactVerify(cwd) {
    let raw;
    try {
        raw = await readFile(join(cwd, SPEC_REL), 'utf8');
    }
    catch {
        return { result: 'skipped' }; // task declared no acceptance → nothing to check
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return {
            result: 'fail',
            detail: `acceptance.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    const checks = typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray(parsed.checks)
        ? parsed.checks
        : null;
    if (!checks || checks.length === 0) {
        return { result: 'fail', detail: 'acceptance.json has no checks array' };
    }
    const misses = [];
    for (const check of checks) {
        const abs = isAbsolute(check.path) ? check.path : join(cwd, check.path);
        let content = null;
        try {
            content = await readFile(abs, 'utf8');
        }
        catch {
            content = null; // missing artifact
        }
        if (content === null) {
            misses.push(`${check.path}: missing`);
            continue;
        }
        if (check.existsOnly !== true && check.contains !== undefined && !content.includes(check.contains)) {
            misses.push(`${check.path}: contains "${check.contains}" not found`);
        }
    }
    if (misses.length > 0) {
        return {
            result: 'fail',
            detail: `artifact acceptance failed (${misses.length}/${checks.length}):\n${misses.map((m) => `- ${m}`).join('\n')}`,
        };
    }
    return { result: 'pass' };
}
//# sourceMappingURL=verify-artifact.js.map