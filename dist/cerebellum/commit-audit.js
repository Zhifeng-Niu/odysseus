import { execFileNoThrow } from '../util/exec.js';
/**
 * Returns true if `sha` is a commit with zero file changes vs its first
 * parent. Root commits (no parent) are considered non-empty if they
 * introduced any files, empty otherwise.
 *
 * Single-commit check — useful when reacting to a specific
 * `waypoint-committed` event and asking "was this one empty?".
 */
export async function isCommitEmpty(cwd, sha) {
    // `git show --shortstat` is the canonical way to inspect a commit's
    // diff stat. For an empty commit it prints the metadata but no stat
    // line (or a stat line with all zeros). For a normal commit it prints
    // " N files changed, ...".
    const r = await execFileNoThrow('git', ['show', '--shortstat', '--format=%s', sha], { cwd });
    if (r.exitCode !== 0)
        return false; // Unknown commit — treat as non-empty
    // Look for the shortstat line: " N files changed". If absent OR if
    // it reports 0 files, the commit is empty.
    const match = r.stdout.match(/(\d+) files? changed/);
    if (match === null)
        return true; // No stat line → empty commit
    const fileCount = Number.parseInt(match[1] ?? '0', 10);
    return fileCount === 0;
}
/**
 * Scan git log for empty waypoint-success commits (`waypoint/...-ok`).
 *
 * Returns the empty commits in reverse-chronological order (newest
 * first), one per line of git log that meets both:
 *   1. Subject starts with `waypoint/` and ends with `-ok`
 *   2. Commit has zero file changes (empty diff)
 *
 * Checkpoint commits (`checkpoint/...`) are excluded even if empty —
 * they are structurally allowed to be empty (the lazy-checkpoint path
 * creates them before any mutating tool runs).
 *
 * Cap on commits scanned: `options.limit ?? 1000`. Auditing a longer
 * range requires passing a higher limit explicitly.
 */
export async function detectEmptyWaypointCommits(cwd, options) {
    const limit = options?.limit ?? 1000;
    const range = options?.since !== undefined ? `${options.since}..HEAD` : 'HEAD';
    // %H=%h|%s|%aI delimited by `|`. Using raw format avoids ambiguity
    // from subject lines containing newlines (rare but possible).
    const format = '%H|%s|%aI';
    const r = await execFileNoThrow('git', ['log', `-${limit}`, `--format=${format}`, '--shortstat', range], { cwd });
    if (r.exitCode !== 0)
        return [];
    const lines = r.stdout.split('\n');
    const results = [];
    let pending = null;
    for (const line of lines) {
        if (line === '')
            continue;
        // A commit-metadata line starts with a 40-char SHA followed by `|`.
        // A shortstat line starts with a space (typical) or contains
        // "files changed" — but never starts with a 40-char SHA + `|`.
        const metaMatch = line.match(/^([0-9a-f]{40})\|(.*)\|(.*)$/);
        if (metaMatch !== null) {
            // Flush any pending commit (no shortstat between it and the next
            // metadata line → empty commit).
            if (pending !== null) {
                if (isWaypointOkSubject(pending.subject)) {
                    results.push(pending);
                }
                pending = null;
            }
            pending = {
                sha: metaMatch[1],
                subject: metaMatch[2],
                date: metaMatch[3],
            };
            continue;
        }
        // Stat line — flush pending commit only if it reports 0 files changed.
        if (pending !== null) {
            const statMatch = line.match(/(\d+) files? changed/);
            const isEmpty = statMatch === null ? false : Number.parseInt(statMatch[1] ?? '0', 10) === 0;
            if (isEmpty && isWaypointOkSubject(pending.subject)) {
                results.push(pending);
            }
            pending = null;
        }
    }
    // Flush trailing pending (last commit in range had no following stat).
    if (pending !== null) {
        if (isWaypointOkSubject(pending.subject)) {
            results.push(pending);
        }
    }
    return results;
}
/**
 * Returns true if a commit subject looks like a waypoint-success
 * commit (`waypoint/wp_*-ok`). Used to filter audit results to only
 * the false-success commits — checkpoint commits (`checkpoint/*`) and
 * human-authored commits are excluded.
 */
function isWaypointOkSubject(subject) {
    return subject.startsWith('waypoint/') && subject.endsWith('-ok');
}
/**
 * Convenience: returns just the count of empty waypoint commits in
 * the given range. Cheaper than `detectEmptyWaypointCommits` when
 * only the cardinality matters (e.g. a voyage-summary badge).
 */
export async function countEmptyWaypointCommits(cwd, options) {
    const found = await detectEmptyWaypointCommits(cwd, options);
    return found.length;
}
//# sourceMappingURL=commit-audit.js.map