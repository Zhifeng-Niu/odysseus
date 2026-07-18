import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileWriteTool } from '../../src/tools/file.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

function extractToolCalls(content: string): unknown {
  try {
    const parsed = JSON.parse(content) as { toolCalls?: unknown };
    return parsed.toolCalls;
  } catch {
    return undefined;
  }
}

function makeMockProvider(responses: string[]): LLMProvider {
  let call = 0;
  return {
    async complete(): Promise<LLMCompletion> {
      const content = responses[Math.min(call, responses.length - 1)] ?? '';
      call += 1;
      return {
        content,
        model: 'mock',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        toolCalls: content.startsWith('{') ? extractToolCalls(content) : undefined,
      };
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

describe('CerebellumOrchestrator', () => {
  let workdir: string;
  let tracePath: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-orch-'));
    tracePath = join(workdir, 'trace.jsonl');
    await initRepo(workdir);
    registry = new ToolRegistry();
    registry.register(new FileWriteTool());
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
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('happy path: writes a valid file, tsc passes, commits, traces success', async () => {
    const provider = makeMockProvider([
      JSON.stringify({
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'file-write',
              arguments: JSON.stringify({
                path: join(workdir, 'out.ts'),
                content: 'export const v = 1;',
              }),
            },
          },
        ],
      }),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: 'add a file with const v = 1' });

    expect(result.outcome).toBe('success');
    const written = await readFile(join(workdir, 'out.ts'), 'utf8');
    expect(written).toContain('export const v = 1;');
  });

  test('failure path: tsc fails, rolls back to checkpoint', async () => {
    const provider = makeMockProvider([
      JSON.stringify({
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'file-write',
              arguments: JSON.stringify({
                path: join(workdir, 'bad.ts'),
                content: 'export const v: number = "wrong";',
              }),
            },
          },
        ],
      }),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: 'add broken file' });

    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/syntax|tsc|verify/i);
    await expect(readFile(join(workdir, 'bad.ts'), 'utf8')).rejects.toThrow();
  });
});
