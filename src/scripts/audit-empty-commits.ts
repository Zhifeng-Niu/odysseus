#!/usr/bin/env node
/**
 * Empty-commit audit CLI — surfaces false-success waypoint commits.
 *
 * Iteration 19 shipped `commit-audit.ts` as a diagnostic module with no
 * wired consumer. Iteration 20 added the `'progress'` verify layer to
 * BLOCK the false-success pattern at runtime — so new voyages should
 * produce zero empty `waypoint/wp_*-ok` commits. This CLI closes the
 * last gap: a retrospective view of historical empty commits, so an
 * operator can answer "how much false-success debt predates the
 * Iteration 20 gate?".
 *
 * Usage:
 *   node dist/scripts/audit-empty-commits.js [options]
 *
 * Options:
 *   --since <ref>   Scan commits after <ref> (exclusive). Examples:
 *                   `HEAD~50`, a SHA, `main`, `origin/main`.
 *                   Default: scan all reachable history.
 *   --limit <N>     Maximum commits to scan. Defensive cap so an audit
 *                   on a long-lived repo doesn't walk decades of
 *                   history. Default: 1000.
 *   --summary       Print only the summary line (count + ratio), not
 *                   the per-commit list. Useful for piping into dashboards.
 *   --cwd <path>    Target repo. Default: process.cwd().
 *
 * Exit codes:
 *   0  Audit ran successfully (regardless of whether empties were found).
 *   1  Argument parse error or git is unavailable / cwd is not a repo.
 *
 * Examples:
 *   node dist/scripts/audit-empty-commits.js
 *   node dist/scripts/audit-empty-commits.js --since HEAD~100
 *   node dist/scripts/audit-empty-commits.js --summary
 */
import { parseArgs } from 'node:util';
import {
  detectEmptyWaypointCommits,
  type EmptyWaypointCommit,
} from '../cerebellum/commit-audit.js';
import { execFileNoThrow } from '../util/exec.js';

interface CliOptions {
  readonly since: string | undefined;
  readonly limit: number | undefined;
  readonly summary: boolean;
  readonly cwd: string;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      since: { type: 'string' },
      limit: { type: 'string' },
      summary: { type: 'boolean', default: false },
      cwd: { type: 'string', default: process.cwd() },
    },
    allowPositionals: false,
  });

  const limitParsed = values.limit !== undefined ? Number.parseInt(values.limit, 10) : undefined;
  if (limitParsed !== undefined && (Number.isNaN(limitParsed) || limitParsed <= 0)) {
    throw new UserError(`--limit must be a positive integer, got: ${values.limit ?? ''}`);
  }
  if (values.since !== undefined && values.since.trim().length === 0) {
    throw new UserError('--since cannot be empty');
  }

  return {
    since: values.since,
    limit: limitParsed,
    summary: values.summary ?? false,
    cwd: values.cwd ?? process.cwd(),
  };
}

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Count total `waypoint/wp_*-ok` commits in the scanned range so the
 * report can show a ratio, not just an absolute count. Without the
 * denominator, "11 empty commits" is meaningless — 11/12 is a crisis,
 * 11/5000 is noise.
 */
async function countWaypointOkCommits(
  cwd: string,
  since: string | undefined,
  limit: number
): Promise<number> {
  const range = since !== undefined ? `${since}..HEAD` : 'HEAD';
  const r = await execFileNoThrow(
    'git',
    ['log', `-${limit}`, '--format=%s', range],
    { cwd }
  );
  if (r.exitCode !== 0) return 0;
  return r.stdout
    .split('\n')
    .filter((s) => s.startsWith('waypoint/') && s.endsWith('-ok'))
    .length;
}

export function formatCommitLine(c: EmptyWaypointCommit): string {
  return `  ${c.sha.slice(0, 10)}  ${c.subject.padEnd(28)}  ${c.date}`;
}

export function printReport(
  empties: readonly EmptyWaypointCommit[],
  totalWaypointOk: number,
  options: CliOptions
): void {
  const ratio = totalWaypointOk > 0 ? `${(empties.length / totalWaypointOk * 100).toFixed(1)}%` : 'n/a';
  const rangeLabel = options.since !== undefined ? `${options.since}..HEAD` : 'all history';

  if (options.summary) {
    console.log(`${empties.length}/${totalWaypointOk} (${ratio}) empty waypoint commits in ${rangeLabel}`);
    return;
  }

  console.log(`=== Empty-commit audit ===`);
  console.log(`Range scanned: ${rangeLabel}`);
  console.log(`Empty waypoint commits: ${empties.length}/${totalWaypointOk} (${ratio})`);
  console.log();
  if (empties.length === 0) {
    console.log('No empty waypoint commits found. Either the Iteration 20 progress');
    console.log('gate is working, or this repo has no `waypoint/wp_*-ok` history.');
    return;
  }
  console.log('Empty commits (newest first):');
  for (const c of empties) {
    console.log(formatCommitLine(c));
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: ${msg}`);
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Sanity-check cwd is a git repo before walking log. Without this, the
  // audit would silently return an empty result on a non-repo directory
  // and the operator might mistake "0 empties" for "all good".
  const sanity = await execFileNoThrow('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: options.cwd,
  });
  if (sanity.exitCode !== 0) {
    console.error(`error: ${options.cwd} is not a git repository`);
    process.exit(1);
  }

  const limit = options.limit ?? 1000;
  const empties = await detectEmptyWaypointCommits(options.cwd, {
    ...(options.since !== undefined ? { since: options.since } : {}),
    limit,
  });
  const totalWaypointOk = await countWaypointOkCommits(options.cwd, options.since, limit);

  printReport(empties, totalWaypointOk, options);
}

main().catch((err: unknown) => {
  if (err instanceof UserError) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
