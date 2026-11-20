/**
 * M1 可插拔验证层 · artifact 类型 — non-code task acceptance.
 *
 * A personal task declares its acceptance in `${cwd}/.odysseus/acceptance.json`
 * (declared by the harness/task-giver, NOT self-graded by the agent):
 *   { "checks": [{ "path": "weekly-report.md", "contains": "完成" }, ...] }
 * runVerify(layers=['artifact']) reads it: all satisfied → pass; any miss →
 * fail with a detail naming the misses; no spec → skipped; corrupt spec →
 * fail. Relative paths resolve against the agent cwd.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArtifactVerify } from '../../src/cerebellum/verify-artifact.js';
import { runVerify } from '../../src/cerebellum/verify.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'verify-artifact-'));
  mkdirSync(join(cwd, '.odysseus'), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeSpec(spec: unknown): void {
  writeFileSync(join(cwd, '.odysseus', 'acceptance.json'), JSON.stringify(spec), 'utf8');
}

describe('runArtifactVerify — declared acceptance checks', () => {
  test('no spec file → skipped', async () => {
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('skipped');
  });

  test('all checks satisfied → pass', async () => {
    writeFileSync(join(cwd, 'report.md'), '# 周报\n本周完成基线扩样\n');
    writeSpec({ checks: [{ path: 'report.md', contains: '周报' }] });
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('pass');
  });

  test('missing artifact file → fail, detail names the path', async () => {
    writeSpec({ checks: [{ path: 'report.md', contains: '周报' }] });
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('fail');
    expect(r.detail).toContain('report.md');
  });

  test('existsOnly check passes on bare existence', async () => {
    writeFileSync(join(cwd, 'reminder.txt'), 'x');
    writeSpec({ checks: [{ path: 'reminder.txt', existsOnly: true }] });
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('pass');
  });

  test('contains mismatch → fail, detail names the check', async () => {
    writeFileSync(join(cwd, 'report.md'), 'nothing useful');
    writeSpec({ checks: [{ path: 'report.md', contains: '周报' }] });
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('fail');
    expect(r.detail).toContain('contains');
  });

  test('corrupt spec (bad JSON) → fail', async () => {
    writeFileSync(join(cwd, '.odysseus', 'acceptance.json'), '{not json', 'utf8');
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('fail');
    expect(r.detail).toContain('acceptance.json');
  });

  test('relative paths resolve against the agent cwd (not process.cwd())', async () => {
    // The lesson from the first live baseline: relative paths must resolve
    // against ctx cwd. Artifact checks are cwd-relative by contract.
    mkdirSync(join(cwd, 'nested'), { recursive: true });
    writeFileSync(join(cwd, 'nested', 'out.md'), 'done');
    writeSpec({ checks: [{ path: 'nested/out.md', existsOnly: true }] });
    const r = await runArtifactVerify(cwd);
    expect(r.result).toBe('pass');
  });
});

describe('runVerify integration — layers=[artifact]', () => {
  test('dispatches through the standard gate', async () => {
    writeFileSync(join(cwd, 'weekly.md'), 'weekly report body 周报');
    writeSpec({ checks: [{ path: 'weekly.md', contains: 'weekly report' }] });
    const r = await runVerify({ cwd, layers: ['artifact'] });
    expect(r.passed).toBe(true);
    expect(r.results['artifact']).toBe('pass');
  });

  test('artifact fail fails the whole gate', async () => {
    writeSpec({ checks: [{ path: 'missing.md', contains: 'x' }] });
    const r = await runVerify({ cwd, layers: ['artifact'] });
    expect(r.passed).toBe(false);
    expect(r.results['artifact']).toBe('fail');
  });
});
