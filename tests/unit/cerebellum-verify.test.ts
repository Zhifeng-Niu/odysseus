import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('fails when tsconfig.json is missing', async () => {
    await writeFile(join(workdir, 'orphan.ts'), 'export const x = 1;\n');
    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.passed).toBe(false);
  });
});
