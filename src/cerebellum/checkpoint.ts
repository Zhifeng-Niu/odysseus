import { execFileNoThrow } from '../util/exec.js';

export interface CheckpointInput {
  cwd: string;
  label: string;
  allowEmpty?: boolean;
}

export interface CheckpointOk {
  ok: true;
  sha: string;
}

export interface CheckpointErr {
  ok: false;
  error: string;
}

export type CheckpointResult = CheckpointOk | CheckpointErr;

export async function createCheckpoint(input: CheckpointInput): Promise<CheckpointResult> {
  const revParse = await execFileNoThrow(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { cwd: input.cwd }
  );
  if (revParse.exitCode !== 0) {
    return { ok: false, error: `not a git repository: ${revParse.stderr.trim()}` };
  }

  const add = await execFileNoThrow('git', ['add', '-A'], { cwd: input.cwd });
  if (add.exitCode !== 0) {
    return { ok: false, error: `git add failed: ${add.stderr.trim()}` };
  }

  const diff = await execFileNoThrow('git', ['diff', '--cached', '--quiet'], { cwd: input.cwd });
  const nothingStaged = diff.exitCode === 0;
  const allowEmpty = input.allowEmpty ?? true;

  if (nothingStaged && !allowEmpty) {
    return { ok: false, error: 'nothing to checkpoint (empty diff)' };
  }

  const args = ['commit', '-m', `checkpoint/${input.label}`];
  if (nothingStaged && allowEmpty) {
    args.push('--allow-empty');
  }

  const commit = await execFileNoThrow('git', args, { cwd: input.cwd });
  if (commit.exitCode !== 0) {
    return { ok: false, error: `git commit failed: ${commit.stderr.trim()}` };
  }

  const sha = await execFileNoThrow('git', ['rev-parse', 'HEAD'], { cwd: input.cwd });
  if (sha.exitCode !== 0) {
    return { ok: false, error: `git rev-parse HEAD failed: ${sha.stderr.trim()}` };
  }

  return { ok: true, sha: sha.stdout.trim() };
}
