import { execFileNoThrow } from '../util/exec.js';

/**
 * Empty-commit audit — detects commits that the orchestrator's
 * `commitWaypoint` produced with `--allow-empty` despite the waypoint
 * being marked as "committed" (success).
 *
 * Iteration 19. The orchestrator's `commitWaypoint` (src/cerebellum/
 * orchestrator.ts:1493) intentionally allows empty commits: when
 * `git diff --cached --quiet` returns 0 (no staged changes), it appends
 * `--allow-empty` and creates a commit anyway. The resulting commit
 * carries a `waypoint/wp_XXX-ok` message and a fresh SHA, but the diff
 * is empty.
 *
 * From the operator's perspective this is a *false success*: the TUI
 * shows a green "OK" badge, the event stream emits `waypoint-committed`,
 * and `git log` shows a new commit — but zero code was actually written.
 * The agent burned iterations and tokens and produced nothing.
 *
 * Editing `orchestrator.ts` to refuse empty commits is the right fix,
 * but the codebase convention requires manual review for that file
 * (see CLAUDE.md "Key Constraints"). This module provides the next-best
 * thing: a post-hoc audit that scans `git log` for empty commits, so
 * the dishonest-success pattern becomes visible and measurable.
 *
 * Future iteration can wire this into:
 *   - A CLI tool (`npm run audit:empty-commits`) for retrospective scans
 *   - The voyage-completed event path (emit a warning event when the
 *     voyage produced any empty commits)
 *   - The TUI (badge on the voyage summary: "2 empty commits")
 *
 * Detection strategy: walk `git log --shortstat` looking for commits
 * whose stat line reports "0 files changed" (or no stat line at all
 * when the commit genuinely has no diff). Cross-reference against
 * commit-message prefix to distinguish:
 *   - `waypoint/wp_*-ok`  → waypoint success commits (the false-positive
 *                          risk this module exists to surface)
 *   - `checkpoint/*`      → pre-dispatch checkpoints (empty by design;
 *                          the lazy-checkpoint path may commit before
 *                          any mutating tool runs)
 *
 * Only `waypoint/...-ok` commits are flagged. Checkpoint commits are
 * structurally allowed to be empty and are excluded.
 */

export interface EmptyWaypointCommit {
  /** Full 40-char SHA of the empty commit. */
  readonly sha: string;
  /** First line of the commit message (e.g. `waypoint/wp_abc123-ok`). */
  readonly subject: string;
  /** Commit author ISO timestamp. */
  readonly date: string;
}

export interface AuditOptions {
  /**
   * Commit ref to scan back to (exclusive). Defaults to scanning all
   * reachable history. Examples: `HEAD~10`, a SHA, `main`, `origin/main`.
   */
  readonly since?: string;
  /**
   * Maximum commits to scan. Defensive cap so an audit on a long-lived
   * repo doesn't walk decades of history. Default 1000.
   */
  readonly limit?: number;
}

/**
 * Returns true if `sha` is a commit with zero file changes vs its first
 * parent. Root commits (no parent) are considered non-empty if they
 * introduced any files, empty otherwise.
 *
 * Single-commit check — useful when reacting to a specific
 * `waypoint-committed` event and asking "was this one empty?".
 */
export async function isCommitEmpty(cwd: string, sha: string): Promise<boolean> {
  // `git show --shortstat` is the canonical way to inspect a commit's
  // diff stat. For an empty commit it prints the metadata but no stat
  // line (or a stat line with all zeros). For a normal commit it prints
  // " N files changed, ...".
  const r = await execFileNoThrow(
    'git',
    ['show', '--shortstat', '--format=%s', sha],
    { cwd }
  );
  if (r.exitCode !== 0) return false; // Unknown commit — treat as non-empty
  // Look for the shortstat line: " N files changed". If absent OR if
  // it reports 0 files, the commit is empty.
  const match = r.stdout.match(/(\d+) files? changed/);
  if (match === null) return true; // No stat line → empty commit
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
export async function detectEmptyWaypointCommits(
  cwd: string,
  options?: AuditOptions
): Promise<readonly EmptyWaypointCommit[]> {
  const limit = options?.limit ?? 1000;
  const range = options?.since !== undefined ? `${options.since}..HEAD` : 'HEAD';
  // %H=%h|%s|%aI delimited by `|`. Using raw format avoids ambiguity
  // from subject lines containing newlines (rare but possible).
  const format = '%H|%s|%aI';
  const r = await execFileNoThrow(
    'git',
    ['log', `-${limit}`, `--format=${format}`, '--shortstat', range],
    { cwd }
  );
  if (r.exitCode !== 0) return [];

  const lines = r.stdout.split('\n');
  const results: EmptyWaypointCommit[] = [];
  let pending: { sha: string; subject: string; date: string } | null = null;

  for (const line of lines) {
    if (line === '') continue;
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
        sha: metaMatch[1]!,
        subject: metaMatch[2]!,
        date: metaMatch[3]!,
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
function isWaypointOkSubject(subject: string): boolean {
  return subject.startsWith('waypoint/') && subject.endsWith('-ok');
}

/**
 * Convenience: returns just the count of empty waypoint commits in
 * the given range. Cheaper than `detectEmptyWaypointCommits` when
 * only the cardinality matters (e.g. a voyage-summary badge).
 */
export async function countEmptyWaypointCommits(
  cwd: string,
  options?: AuditOptions
): Promise<number> {
  const found = await detectEmptyWaypointCommits(cwd, options);
  return found.length;
}
