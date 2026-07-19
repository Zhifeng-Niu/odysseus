import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileWriteTool } from '../../src/tools/file.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

function makeMockProvider(responses: string[]): LLMProvider {
  let call = 0;
  return {
    async complete(): Promise<LLMCompletion> {
      const content = responses[Math.min(call, responses.length - 1)] ?? '';
      call += 1;
      let toolCalls: unknown;
      try {
        const parsed = JSON.parse(content) as { toolCalls?: unknown };
        toolCalls = parsed.toolCalls;
      } catch {
        toolCalls = undefined;
      }
      return {
        content,
        model: 'mock',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        ...(toolCalls !== undefined ? { toolCalls } : {}),
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

function fileWriteArgs(dir: string, filename: string, content: string): string {
  return JSON.stringify({
    toolCalls: [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'file-write',
          arguments: JSON.stringify({ path: join(dir, filename), content }),
        },
      },
    ],
  });
}

function subscribe(orch: CerebellumOrchestrator): OrchestratorEvent[] {
  const events: OrchestratorEvent[] = [];
  orch.on('event', (e: OrchestratorEvent) => {
    events.push(e);
  });
  return events;
}

describe('CerebellumOrchestrator events + approval gate', () => {
  let workdir: string;
  let tracePath: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-orch-evt-'));
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

  test('happy path emits waypoint-started → iteration → tool-call-* → verify-* → waypoint-committed', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'out.ts', 'export const v = 1;'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    const result = await orch.runWaypoint({ goal: 'add a file' });

    expect(result.outcome).toBe('success');

    const types = events.map((e) => e.type);
    expect(types).toContain('waypoint-started');
    expect(types).toContain('waypoint-iteration');
    expect(types).toContain('tool-call-started');
    expect(types).toContain('tool-call-completed');
    expect(types).toContain('verify-started');
    expect(types).toContain('verify-completed');
    expect(types).toContain('waypoint-committed');

    // Ordering invariant: started < iteration < committed
    const idx = (t: string): number => types.indexOf(t);
    expect(idx('waypoint-started')).toBeLessThan(idx('waypoint-iteration'));
    expect(idx('waypoint-iteration')).toBeLessThan(idx('tool-call-started'));
    expect(idx('tool-call-completed')).toBeLessThan(idx('verify-started'));
    expect(idx('verify-completed')).toBeLessThan(idx('waypoint-committed'));

    // waypoint-committed carries a real sha
    const committed = events.find((e) => e.type === 'waypoint-committed');
    expect(committed && committed.type === 'waypoint-committed' && committed.sha).toMatch(
      /^[0-9a-f]{7,40}$/
    );
  });

  test('verify failure emits verify-completed(passed=false) + waypoint-rolled-back', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'bad.ts', 'export const v: number = "wrong";'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    const result = await orch.runWaypoint({ goal: 'add broken file' });

    expect(result.outcome).toBe('failure');
    const types = events.map((e) => e.type);
    expect(types).toContain('verify-completed');
    const verify = events.find((e) => e.type === 'verify-completed');
    expect(verify && verify.type === 'verify-completed' && verify.passed).toBe(false);
    expect(types).toContain('waypoint-rolled-back');
  });

  test('autoApprove=false blocks on approval gate until approve() is called', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'ok.ts', 'export const v = 1;'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: false,
    });
    const events = subscribe(orch);

    const runPromise = orch.runWaypoint({ goal: 'add a file' });

    // Wait for the awaiting-approval event, then approve.
    await new Promise<void>((resolve) => {
      const onEvent = (e: OrchestratorEvent): void => {
        if (e.type === 'waypoint-awaiting-approval') {
          orch.off('event', onEvent);
          resolve();
        }
      };
      orch.on('event', onEvent);
    });

    const awaiting = events.find((e) => e.type === 'waypoint-awaiting-approval');
    const waypointId = awaiting?.type === 'waypoint-awaiting-approval' ? awaiting.waypointId : '';
    expect(waypointId).toMatch(/^wp_/);
    orch.approve(waypointId);

    const result = await runPromise;
    expect(result.outcome).toBe('success');
    const types = events.map((e) => e.type);
    expect(types).toContain('waypoint-committed');

    // committed SHAd; ensure file landed
    const written = await readFile(join(workdir, 'ok.ts'), 'utf8');
    expect(written).toContain('export const v = 1;');
  });

  test('reject() on approval gate triggers rollback and marks outcome failure', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'rejected.ts', 'export const v = 1;'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: false,
    });
    const events = subscribe(orch);

    const runPromise = orch.runWaypoint({ goal: 'add file that will be rejected' });

    const waypointId = await new Promise<string>((resolve) => {
      const onEvent = (e: OrchestratorEvent): void => {
        if (e.type === 'waypoint-awaiting-approval') {
          orch.off('event', onEvent);
          resolve(e.waypointId);
        }
      };
      orch.on('event', onEvent);
    });

    orch.reject(waypointId, 'i changed my mind');

    const result = await runPromise;
    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/rejected/i);
    const types = events.map((e) => e.type);
    // User reject is a decision, not a system rollback — emit waypoint-failed
    // (not waypoint-rolled-back). The workspace is still cleaned up via
    // rollbackTo(); the file must NOT exist post-reject.
    expect(types).toContain('waypoint-failed');
    expect(types).not.toContain('waypoint-committed');

    // Verify the file was rolled back (no commit).
    await expect(readFile(join(workdir, 'rejected.ts'), 'utf8')).rejects.toThrow();
  });

  test('interrupt() before completion aborts the loop', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'iter1.ts', 'export const a = 1;'),
      fileWriteArgs(workdir, 'iter2.ts', 'export const b = 2;'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    const runPromise = orch.runWaypoint({ goal: 'will be interrupted' });

    // Wait for the first tool-call-completed, then interrupt.
    await new Promise<void>((resolve) => {
      const onEvent = (e: OrchestratorEvent): void => {
        if (e.type === 'tool-call-completed') {
          orch.off('event', onEvent);
          resolve();
        }
      };
      orch.on('event', onEvent);
    });

    orch.interrupt('test interrupt');

    const result = await runPromise;
    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/interrupt/i);
    const types = events.map((e) => e.type);
    expect(types).toContain('waypoint-rolled-back');
    expect(types).not.toContain('waypoint-committed');
  });

  test('injectMessage() surfaces as a user message in the next LLM turn', async () => {
    const seenHistories: Array<{ role: string; content: string }[]> = [];
    const recordingProvider: LLMProvider = {
      async complete(_prompt: string, options?): Promise<LLMCompletion> {
        if (options?.history) {
          seenHistories.push(options.history.map((m) => ({ role: m.role, content: m.content })));
        }
        return {
          content: 'DONE',
          model: 'mock',
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield '';
      },
      getModel() {
        return 'mock';
      },
    };

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider: recordingProvider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    // Inject before starting — the message should appear on the first turn.
    orch.injectMessage('remember to keep diffs small');
    await orch.runWaypoint({ goal: 'noop goal' });

    const flat = seenHistories.flat();
    expect(flat.some((m) => m.role === 'user' && m.content.includes('keep diffs small'))).toBe(true);
  });

  test('conversational goal (no tool calls, no DONE) stops early as abandoned', async () => {
    // Simulates the "hi" scenario: LLM keeps replying with plain text and
    // never invokes tools. Without the consecutiveTextOnly guard, the loop
    // would burn all 16 iterations and emit a failure. With the guard, the
    // orchestrator stops after 2 conversational turns and marks abandoned.
    const provider = makeMockProvider([
      'Hi! I am Odysseus, ready to help.',
      'Please give me a concrete task.',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
      maxIterations: 16,
    });
    const events = subscribe(orch);

    const result = await orch.runWaypoint({ goal: 'hi' });

    expect(result.outcome).toBe('abandoned');
    expect(result.iterationsUsed).toBe(2);
    expect(result.failReason ?? '').toMatch(/conversational/i);

    // The agent must NOT have committed or attempted verify.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('verify-started');
    expect(types).not.toContain('waypoint-committed');

    // Both conversational replies should be surfaced to the UI.
    const assistantMessages = events.filter(
      (e): e is Extract<OrchestratorEvent, { type: 'assistant-message' }> =>
        e.type === 'assistant-message'
    );
    expect(assistantMessages.length).toBe(2);
  });

  test('single text reply followed by tool calls does NOT trip the conversational guard', async () => {
    // LLM may legitimately say "sure, on it" before invoking a tool — that
    // one conversational turn must not stop the loop.
    const provider = makeMockProvider([
      'Sure, on it.',
      fileWriteArgs(workdir, 'ok.ts', 'export const v = 1;'),
      'DONE',
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runWaypoint({ goal: 'add a file' });

    expect(result.outcome).toBe('success');
    expect(result.iterationsUsed).toBe(3);
  });
});
