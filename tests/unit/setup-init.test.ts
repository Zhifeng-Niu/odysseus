/**
 * `odysseus init` — 一句话部署的落地端：写 .env、种子 ~/.odysseus、live 验证
 * key、输出下一步。All I/O injected (fs via tmp dirs, ping via fake, prompt
 * via canned queue) — no network, no TTY in tests.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, type InitIo } from '../../src/setup.js';

let cwd: string;
let home: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'init-cwd-'));
  home = mkdtempSync(join(tmpdir(), 'init-home-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function makeIo(promptTexts: string[] = []): InitIo & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    prompt: async (text: string) => {
      prompts.push(text);
      return promptTexts[i++] ?? '';
    },
    out: () => undefined,
  };
}

describe('runInit — env 写入与幂等', () => {
  test('writes .env with provided key/model/baseUrl', async () => {
    const report = await runInit({
      cwd,
      homeDir: home,
      apiKey: 'k-test',
      io: makeIo(),
    });
    const env = readFileSync(join(cwd, '.env'), 'utf8');
    expect(env).toContain('ODYSSEUS_LLM_API_KEY=k-test');
    expect(report.envWritten).toBe(true);
  });

  test('prompts for the key when missing and stdin can answer', async () => {
    const io = makeIo(['k-from-prompt']);
    await runInit({ cwd, homeDir: home, io });
    const env = readFileSync(join(cwd, '.env'), 'utf8');
    expect(env).toContain('ODYSSEUS_LLM_API_KEY=k-from-prompt');
    expect(io.prompts.length).toBeGreaterThan(0);
  });

  test('no key anywhere → env still written with placeholder, report says unverified', async () => {
    const report = await runInit({ cwd, homeDir: home, io: makeIo() });
    const env = readFileSync(join(cwd, '.env'), 'utf8');
    expect(env).toContain('ODYSSEUS_LLM_API_KEY=');
    expect(report.verified).toBe(false);
  });

  test('existing .env is preserved unless force', async () => {
    (await import('node:fs')).writeFileSync(join(cwd, '.env'), 'ODYSSEUS_LLM_API_KEY=keep-me\n', 'utf8');
    const kept = await runInit({ cwd, homeDir: home, apiKey: 'new', io: makeIo() });
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toContain('keep-me');
    expect(kept.envWritten).toBe(false);
    expect(kept.envSkipped).toBe(true);

    const forced = await runInit({ cwd, homeDir: home, apiKey: 'new', force: true, io: makeIo() });
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toContain('ODYSSEUS_LLM_API_KEY=new');
    expect(forced.envWritten).toBe(true);
  });
});

describe('runInit — live key 验证（可注入 pinger）', () => {
  test('pinger ok → verified=true', async () => {
    const report = await runInit({
      cwd,
      homeDir: home,
      apiKey: 'k',
      ping: async () => ({ ok: true }),
      io: makeIo(),
    });
    expect(report.verified).toBe(true);
  });

  test('pinger fails → verified=false but env still written (不闪退)', async () => {
    const report = await runInit({
      cwd,
      homeDir: home,
      apiKey: 'bad',
      ping: async () => ({ ok: false, error: '401' }),
      io: makeIo(),
    });
    expect(report.verified).toBe(false);
    expect(report.verifyError).toContain('401');
    expect(existsSync(join(cwd, '.env'))).toBe(true);
  });

  test('no key → ping skipped entirely', async () => {
    let pingCalls = 0;
    const report = await runInit({
      cwd,
      homeDir: home,
      ping: async () => {
        pingCalls += 1;
        return { ok: true };
      },
      io: makeIo(),
    });
    expect(pingCalls).toBe(0);
    expect(report.verified).toBe(false);
  });
});

describe('runInit — ~/.odysseus 种子', () => {
  test('creates the home store dir', async () => {
    await runInit({ cwd, homeDir: home, io: makeIo() });
    expect(existsSync(join(home, '.odysseus'))).toBe(true);
  });
});
