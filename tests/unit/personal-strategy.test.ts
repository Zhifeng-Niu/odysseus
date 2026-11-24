/**
 * M2 personal 身份与策略 — the agent's identity broadens from "coding
 * agent" to "personal agent": non-code goals get the artifact-acceptance
 * path (M1) and a personal-domain prompt section; init seeds a personal
 * self-model.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PERSONAL_DOMAIN_SECTION } from '../../src/cerebellum/personal-prompt.js';
import { ENGINEER_BASE_PROMPT } from '../../src/cerebellum/prompts.js';
import { runInit, type InitIo } from '../../src/setup.js';

describe('PERSONAL_DOMAIN_SECTION — prompt module', () => {
  test('declares the personal-agent stance and the artifact acceptance path', () => {
    expect(PERSONAL_DOMAIN_SECTION).toContain('个人 agent');
    expect(PERSONAL_DOMAIN_SECTION).toContain('acceptance.json');
    expect(PERSONAL_DOMAIN_SECTION).toContain('artifact');
    // Identity framing: coding is a tool, not the whole self.
    expect(PERSONAL_DOMAIN_SECTION).toMatch(/工具/);
  });

  test('ENGINEER_BASE_PROMPT interpolates the personal section', () => {
    expect(ENGINEER_BASE_PROMPT).toContain(PERSONAL_DOMAIN_SECTION);
    // Identity anchor: personal agent, not coding agent.
    expect(ENGINEER_BASE_PROMPT).toContain("the user's personal agent");
    expect(ENGINEER_BASE_PROMPT).toContain('个人 agent');
  });
});

describe('runInit — seeds personal self-model', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'init-selfmodel-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const modelPath = (cwd: string): string => join(cwd, '.odysseus', 'self-model.md');

  test('init writes .odysseus/self-model.md with personal identity', async () => {
    const io: InitIo = { prompt: async () => '', out: () => undefined };
    await runInit({ cwd, io });
    expect(existsSync(modelPath(cwd))).toBe(true);
    const model = readFileSync(modelPath(cwd), 'utf8');
    expect(model).toContain('个人 agent');
    expect(model).toContain('artifact');
    expect(model).toContain('Odysseus');
  });

  test('existing self-model is preserved (never clobbered)', async () => {
    mkdirSync(join(cwd, '.odysseus'), { recursive: true });
    writeFileSync(modelPath(cwd), '# 我自己的 self-model\n evolved content', 'utf8');
    const io: InitIo = { prompt: async () => '', out: () => undefined };
    await runInit({ cwd, io });
    expect(readFileSync(modelPath(cwd), 'utf8')).toContain('evolved content');
  });
});
