import { execFileNoThrow } from '../util/exec.js';

export interface RollbackInput {
  cwd: string;
  sha: string;
  /**
   * Zeroth-law guard: when provided, the target SHA must be in this list.
   * Prevents the agent from `git reset --hard` to arbitrary history
   * (which could wipe human-authored safety fixes).
   */
  allowedShas?: readonly string[];
}

export interface RollbackOk {
  ok: true;
  sha: string;
}

export interface RollbackErr {
  ok: false;
  error: string;
}

export type RollbackResult = RollbackOk | RollbackErr;

export async function rollbackTo(input: RollbackInput): Promise<RollbackResult> {
  if (input.allowedShas && !input.allowedShas.includes(input.sha)) {
    return {
      ok: false,
      error: `safety violation: SHA ${input.sha} is not in this session's allowed list`,
    };
  }

  const exists = await execFileNoThrow('git', ['cat-file', '-t', input.sha], {
    cwd: input.cwd,
  });
  if (exists.exitCode !== 0) {
    return { ok: false, error: `unknown revision ${input.sha}: ${exists.stderr.trim()}` };
  }

  const reset = await execFileNoThrow('git', ['reset', '--hard', input.sha], {
    cwd: input.cwd,
  });
  if (reset.exitCode !== 0) {
    return { ok: false, error: `git reset failed: ${reset.stderr.trim()}` };
  }

  // Remove untracked files written during ACT so failed changes are fully discarded.
  // `-d` includes directories; `-f` is non-interactive; gitignored files are preserved.
  const clean = await execFileNoThrow('git', ['clean', '-fd'], {
    cwd: input.cwd,
  });
  if (clean.exitCode !== 0) {
    return { ok: false, error: `git clean failed: ${clean.stderr.trim()}` };
  }

  return { ok: true, sha: input.sha };
}
