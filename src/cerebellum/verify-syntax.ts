/**
 * Changed-TypeScript-file enumeration for the syntax layer's no-tsconfig
 * fallback. verify.ts type-checks the returned files individually; this
 * module only knows how to ask git what changed.
 *
 * - `-z` NUL separators so paths with spaces survive.
 * - Deleted files are excluded (nothing to type-check).
 * - Rename pairs contribute the new path.
 * - 'unavailable' = git failed (not a repo, or git itself errored) —
 *   verify.ts then falls back to bare `tsc --noEmit` (original behavior).
 */

import { execFileNoThrow } from '../util/exec.js';
import { join } from 'node:path';

const TS_EXTENSIONS = /\.(ts|tsx|mts|cts)$/;

export async function changedTypeScriptFiles(
  cwd: string
): Promise<readonly string[] | 'unavailable'> {
  const r = await execFileNoThrow('git', ['status', '--porcelain', '-z'], { cwd });
  if (r.exitCode !== 0) return 'unavailable';
  if (r.stdout.length === 0) return [];

  const files: string[] = [];
  const entries = r.stdout.split('\0').filter((s) => s.length > 0);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    let filePath: string = entry.slice(3);
    if (status.includes('R') && i + 1 < entries.length) {
      // rename: porcelain -z packs "XY orig\0new" — take the new path.
      const renamed = entries[i + 1];
      if (renamed === undefined) continue;
      filePath = renamed;
      i += 1;
    }
    if (status.includes('D')) continue;
    if (TS_EXTENSIONS.test(filePath)) {
      files.push(join(cwd, filePath));
    }
  }
  return files;
}
