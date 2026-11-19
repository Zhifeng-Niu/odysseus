import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runVerify } from '../../src/cerebellum/verify.js';

describe('runVerify (syntax layer only in Iteration 0)', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-verify-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('passes when tsc reports no errors', async () => {
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );
    await writeFile(join(workdir, 'ok.ts'), 'export const x: number = 1;\n');

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.passed).toBe(true);
    expect(result.results.syntax).toBe('pass');
  });

  test('fails when tsc reports errors', async () => {
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );
    await writeFile(join(workdir, 'bad.ts'), 'export const x: number = "string";\n');

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.passed).toBe(false);
    expect(result.results.syntax).toBe('fail');
  });

  test('no tsconfig + changed good .ts files: single-file mode passes', async () => {
    // Mission acceptance line: an agent must complete tasks in ARBITRARY
    // directories. Without a tsconfig, bare `tsc --noEmit` prints help and
    // exits non-zero — 100% waypoint failure. The fallback verifies the
    // CHANGED .ts files individually (real checking, not a blind skip).
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: workdir });
    };
    git(['init']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    await writeFile(join(workdir, 'ok.ts'), 'export const x: number = 1;\n');
    git(['add', '-A']);

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.results.syntax).toBe('pass');
    expect(result.passed).toBe(true);
  });

  test('no tsconfig + changed broken .ts file: single-file mode still fails (no false green)', async () => {
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: workdir });
    };
    git(['init']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    await writeFile(join(workdir, 'bad.ts'), 'export const v: number = "type error";\n');
    git(['add', '-A']);

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.results.syntax).toBe('fail');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('bad.ts');
  });

  test('no tsconfig + git-clean repo: syntax passes (nothing to check)', async () => {
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: workdir });
    };
    git(['init']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    writeFileSync(join(workdir, 'base.ts'), 'export const base = 1;\n');
    git(['add', '-A']);
    git(['commit', '-m', 'base']);

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.results.syntax).toBe('pass'); // git-clean = no TS changes
    expect(result.passed).toBe(true); // nothing to check ≠ failure
  });
});
