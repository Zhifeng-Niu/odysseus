import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type { LLMProvider, LLMCompletion, LLMCompleteOptions } from '../../src/llm/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileWriteTool } from '../../src/tools/file.js';
import {
  listRejectedGoals,
  clearRejectedGoals,
} from '../../src/cerebellum/backlog.js';

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

function makeRecordingProvider(responses: string[], recorded: LLMCompleteOptions[]): LLMProvider {
  let call = 0;
  return {
    async complete(_prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion> {
      if (options) recorded.push(options);
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
    clearRejectedGoals();
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

  test('passes registered tool specs to the LLM on every complete() call', async () => {
    const recorded: LLMCompleteOptions[] = [];
    const provider = makeRecordingProvider(
      [
        JSON.stringify({
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'file-write',
                arguments: JSON.stringify({
                  path: join(workdir, 'ok.ts'),
                  content: 'export const v = 1;',
                }),
              },
            },
          ],
        }),
        'DONE',
      ],
      recorded
    );

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: 'add a file' });

    expect(result.outcome).toBe('success');
    expect(recorded.length).toBeGreaterThan(0);
    for (const opt of recorded) {
      expect(opt.tools).toBeDefined();
      expect(opt.tools?.length).toBeGreaterThan(0);
      expect(opt.tools?.some((t) => t.function.name === 'file-write')).toBe(true);
    }
  });

  test('trace records iterations_used from the actual loop count', async () => {
    const provider = makeMockProvider([
      JSON.stringify({
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'file-write',
              arguments: JSON.stringify({
                path: join(workdir, 'iter.ts'),
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

    const result = await orch.runWaypoint({ goal: 'add a file' });

    expect(result.outcome).toBe('success');
    expect(result.iterationsUsed).toBe(2);

    const traceLines = (await readFile(tracePath, 'utf8')).trim().split('\n');
    const last = JSON.parse(traceLines[traceLines.length - 1]!) as { iterations_used: number };
    expect(last.iterations_used).toBe(2);
  });

  test('StuckLoopError triggers a single retry with nudge injection', async () => {
    const stuckArgs = JSON.stringify({
      path: join(workdir, 'noop.ts'),
      content: 'export const v = 1;',
    });
    const stuckToolCall = JSON.stringify({
      toolCalls: [
        {
          id: 'call_stuck',
          type: 'function',
          function: { name: 'file-write', arguments: stuckArgs },
        },
      ],
    });

    // Provider sequence:
    //   calls 1-3  → identical tool calls (detector fires recovery, no StuckLoopError)
    //   calls 4-6  → identical tool calls again (detector throws StuckLoopError)
    //   call 7     → LLM sees nudge, writes a valid file
    //   call 8     → DONE
    const provider = makeMockProvider([
      stuckToolCall, // iter 1
      stuckToolCall, // iter 2
      stuckToolCall, // iter 3 → detector returns recovery message
      stuckToolCall, // iter 4
      stuckToolCall, // iter 5
      stuckToolCall, // iter 6 → StuckLoopError caught, nudge injected, continue
      JSON.stringify({
        toolCalls: [
          {
            id: 'call_ok',
            type: 'function',
            function: {
              name: 'file-write',
              arguments: JSON.stringify({
                path: join(workdir, 'recovered.ts'),
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

    const result = await orch.runWaypoint({ goal: 'write a file' });

    // The orchestrator should have recovered and succeeded — not rolled back.
    expect(result.outcome).toBe('success');
    expect(result.failReason).toBeUndefined();
    const written = await readFile(join(workdir, 'recovered.ts'), 'utf8');
    expect(written).toContain('export const v = 1;');
  });

  test('second StuckLoopError is not retried and results in failure', async () => {
    const stuckArgs = JSON.stringify({
      path: join(workdir, 'noop.ts'),
      content: 'export const v = 1;',
    });
    const stuckToolCall = JSON.stringify({
      toolCalls: [
        {
          id: 'call_stuck',
          type: 'function',
          function: { name: 'file-write', arguments: stuckArgs },
        },
      ],
    });

    // Provider sequence:
    //   calls 1-3  → identical (detector fires recovery)
    //   calls 4-6  → identical (StuckLoopError → orchestrator retries once)
    //   calls 7-9  → identical again (second StuckLoopError → propagates → rollback + failure)
    const provider = makeMockProvider([
      stuckToolCall, // iter 1
      stuckToolCall, // iter 2
      stuckToolCall, // iter 3 → recovery
      stuckToolCall, // iter 4
      stuckToolCall, // iter 5
      stuckToolCall, // iter 6 → first StuckLoopError, retry
      stuckToolCall, // iter 7
      stuckToolCall, // iter 8
      stuckToolCall, // iter 9 → second StuckLoopError, NOT retried → failure
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: 'write a file' });

    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/Stuck loop detected/);
  });

  test('reports failure when maxIterations is reached without DONE', async () => {
    // Provider emits tool calls every turn and never says DONE — loop will
    // run up to maxIter and the orchestrator must not declare success.
    const responses: string[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push(
        JSON.stringify({
          toolCalls: [
            {
              id: `call_${i}`,
              type: 'function',
              function: {
                name: 'file-write',
                arguments: JSON.stringify({
                  path: join(workdir, `noop_${i}.ts`),
                  content: `export const x${i} = ${i};`,
                }),
              },
            },
          ],
        })
      );
    }
    const provider = makeMockProvider(responses);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      maxIterations: 3,
    });

    const result = await orch.runWaypoint({ goal: 'loop forever without DONE' });

    expect(result.outcome).toBe('failure');
    expect(result.iterationsUsed).toBe(3);
    expect(result.failReason ?? '').toMatch(/maxIterations.*DONE/);
  });

  test('conversational goal flows through LLM once and stops (honors reply-once-and-stop)', async () => {
    // The agent replies once and the orchestrator honors the engineer prompt's
    // CONVERSATION CASE promise: "reply once and stop". A single text-only
    // response ends the waypoint cleanly. Provider is called exactly once.
    const provider = makeMockProvider(['Hi! I am Odysseus. What would you like me to build?']);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: 'hello' });

    // Waypoint still ends as abandoned (no DONE, no work), but only after
    // one LLM turn. This is the new contract: conversational inputs get a
    // real reply, then stop. They are no longer pre-rejected.
    expect(result.outcome).toBe('abandoned');
    expect(result.iterationsUsed).toBe(1);
    expect(result.failReason ?? '').toMatch(/conversational/i);

    // Conversational goals no longer hit the rejection registry — only
    // empty goals do. This assertion locks that contract: a hello is not a
    // rejection, it's a conversation.
    const rejected = listRejectedGoals();
    expect(rejected.length).toBe(0);
  });

  test('empty goal is still rejected before any LLM turn', async () => {
    // Empty goals are the only remaining hard-reject case: nothing for the
    // agent to respond to. Provider is never called.
    const provider = makeMockProvider([]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
    });

    const result = await orch.runWaypoint({ goal: '' });

    expect(result.outcome).toBe('abandoned');
    expect(result.iterationsUsed).toBe(0);
    expect(result.failReason ?? '').toMatch(/empty/i);

    // Note: empty goals are not recorded in listRejectedGoals (recordRejectedGoal
    // explicitly skips them — nothing meaningful to trace). The contract here
    // is just "short-circuit cleanly, don't burn an LLM call".
    const rejected = listRejectedGoals();
    expect(rejected.length).toBe(0);
  });
});
