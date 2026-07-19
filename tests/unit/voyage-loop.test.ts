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
import { enqueueBacklog, listBacklog } from '../../src/cerebellum/backlog.js';
import { listPendingReview } from '../../src/cerebellum/pending-review.js';
import { readMemory } from '../../src/cerebellum/memory.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

/**
 * Provider that returns a queue of canned responses. Each call dequeues
 * the next response; once empty, returns 'DONE'.
 *
 * Each response can be either a tool-call JSON or plain text — same shape
 * as orchestrator-events.test.ts uses.
 */
function makeMockProvider(responses: string[]): LLMProvider {
  let call = 0;
  return {
    async complete(): Promise<LLMCompletion> {
      const content = responses[Math.min(call, responses.length - 1)] ?? 'DONE';
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

/**
 * "Static" provider — always returns the same response. Used for dreaming
 * phases where the LLM call should be predictable (e.g. empty dream).
 */
function staticProvider(content: string): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return {
        content,
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

describe('CerebellumOrchestrator voyage loop', () => {
  let workdir: string;
  let tracePath: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-voyage-'));
    tracePath = join(workdir, '.odysseus', 'trace.jsonl');
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

  test('voyage with seed goal drains naturally (1 waypoint, empty dream, then idle)', async () => {
    // Provider: file-write tool call for the waypoint, then empty dream JSON.
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'out.ts', 'export const v = 1;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
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

    const result = await orch.runVoyage({ seedGoal: 'add a file' });

    expect(result.outcome).toBe('completed');
    expect(result.waypoints.length).toBe(1);
    expect(result.waypoints[0]!.outcome).toBe('success');

    // Voyage lifecycle events.
    const types = events.map((e) => e.type);
    expect(types).toContain('voyage-started');
    expect(types).toContain('voyage-completed');
    expect(types).toContain('voyage-idle');

    // Brain state transitions occurred.
    const stateChanges = events.filter(
      (e): e is Extract<OrchestratorEvent, { type: 'brain-state-changed' }> =>
        e.type === 'brain-state-changed'
    );
    expect(stateChanges.length).toBeGreaterThan(0);
    // Final state must be idle.
    expect(orch.getBrainState()).toBe('idle');

    // Dream phase ran and emitted dream-completed.
    const dream = events.find(
      (e): e is Extract<OrchestratorEvent, { type: 'dream-completed' }> =>
        e.type === 'dream-completed'
    );
    expect(dream).toBeDefined();
    expect(dream?.backlogItemsAdded).toBe(0);

    // File was actually written.
    const written = await readFile(join(workdir, 'out.ts'), 'utf8');
    expect(written).toContain('export const v = 1;');
  });

  test('voyage with no backlog and no seed emits voyage-idle immediately', async () => {
    const provider = staticProvider('DONE');
    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    const result = await orch.runVoyage();

    expect(result.outcome).toBe('completed');
    expect(result.waypoints.length).toBe(0);
    const types = events.map((e) => e.type);
    expect(types).toContain('voyage-idle');
    expect(types).not.toContain('waypoint-started');
    // No dreaming phase since no waypoint ran.
    expect(types).not.toContain('dream-completed');
  });

  test('voyage with pre-enqueued backlog items runs them in priority order', async () => {
    // Seed two backlog items before starting — one user, one dream.
    await enqueueBacklog(join(workdir, '.odysseus'), 'dream task', 'dream', {
      priority: 100,
    });
    await enqueueBacklog(join(workdir, '.odysseus'), 'user task', 'user', {
      priority: 50,
    });

    // Provider needs to handle: user task file-write, DONE, dream, dream task file-write, DONE, dream
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'user.ts', 'export const u = 1;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
      fileWriteArgs(workdir, 'dream.ts', 'export const d = 2;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runVoyage();

    expect(result.waypoints.length).toBe(2);
    // User task (priority 50) ran first, dream task (100) second.
    expect(result.waypoints[0]!.waypoint.goal).toBe('user task');
    expect(result.waypoints[1]!.waypoint.goal).toBe('dream task');

    // Both files written.
    await expect(readFile(join(workdir, 'user.ts'), 'utf8')).resolves.toContain('u = 1');
    await expect(readFile(join(workdir, 'dream.ts'), 'utf8')).resolves.toContain('d = 2');
  });

  test('voyage dream that produces backlog items parks them in pending-review (no auto-iteration)', async () => {
    // New behavior: dream output goes to pending-review, not backlog.
    // The voyage stops after the seed waypoint — the user must approve the
    // dreamed item before it enters the backlog and becomes eligible for
    // the next voyage.
    // Sequence: seed goal → waypoint → DONE → dream(produces 1 item, parked)
    //           → backlog empty → idle.
    const followupGoal = 'followup task from dream';
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'seed.ts', 'export const s = 0;'),
      'DONE',
      JSON.stringify({
        backlogItems: [{ goal: followupGoal, priority: 80 }],
        memoryEntries: [],
      }),
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

    const result = await orch.runVoyage({ seedGoal: 'seed task' });

    // Only the seed waypoint ran — the dreamed item did NOT trigger a
    // second iteration.
    expect(result.waypoints.length).toBe(1);
    expect(result.waypoints[0]!.waypoint.goal).toBe('seed task');

    // The dreamed item should be parked in pending-review, not in backlog.
    const pending = await listPendingReview(join(workdir, '.odysseus'));
    expect(pending.length).toBe(1);
    expect(pending[0]!.goal).toBe(followupGoal);
    expect(pending[0]!.origin).toBe('dream');

    // Backlog should be empty — dream never wrote to it.
    const backlog = await listBacklog(join(workdir, '.odysseus'));
    expect(backlog.length).toBe(0);

    // Exactly one dream-completed event, reporting 1 item added.
    const dreams = events.filter(
      (e): e is Extract<OrchestratorEvent, { type: 'dream-completed' }> =>
        e.type === 'dream-completed'
    );
    expect(dreams.length).toBe(1);
    expect(dreams[0]!.backlogItemsAdded).toBe(1);
  });

  test('voyage with dream that produces memory entries persists them', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'mem.ts', 'export const m = 1;'),
      'DONE',
      JSON.stringify({
        backlogItems: [],
        memoryEntries: [
          {
            category: 'lessons',
            title: 'tsc is the safety net',
            body: 'Strict type checking caught multiple bugs in spike phase.',
          },
        ],
      }),
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    await orch.runVoyage({ seedGoal: 'remember a lesson' });

    const lessons = await readMemory(join(workdir, '.odysseus'), 'lessons');
    expect(lessons.length).toBe(1);
    expect(lessons[0]!.title).toBe('tsc is the safety net');
    expect(lessons[0]!.source).toBe('dream');
  });

  test('maxWaypoints cap stops the voyage even if backlog is non-empty', async () => {
    // Pre-enqueue 3 items but cap the voyage at 1 waypoint.
    await enqueueBacklog(join(workdir, '.odysseus'), 'task 1', 'user');
    await enqueueBacklog(join(workdir, '.odysseus'), 'task 2', 'user');
    await enqueueBacklog(join(workdir, '.odysseus'), 'task 3', 'user');

    const provider = makeMockProvider([
      fileWriteArgs(workdir, 't1.ts', 'export const a = 1;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runVoyage({ maxWaypoints: 1 });

    expect(result.waypoints.length).toBe(1);
    expect(result.outcome).toBe('completed');
  });

  test('interrupt() during voyage terminates gracefully', async () => {
    await enqueueBacklog(join(workdir, '.odysseus'), 'long task', 'user');

    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'long.ts', 'export const x = 1;'),
      'DONE',
      // After the first waypoint + dream, the voyage would look for the
      // next backlog item. We interrupt before that.
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
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

    // Interrupt as soon as the first waypoint commits.
    const runPromise = orch.runVoyage();
    await new Promise<void>((resolve) => {
      const onEvent = (e: OrchestratorEvent): void => {
        if (e.type === 'waypoint-committed') {
          orch.off('event', onEvent);
          resolve();
        }
      };
      orch.on('event', onEvent);
    });
    orch.interrupt('test interrupt');

    const result = await runPromise;
    expect(result.outcome).toBe('interrupted');
    expect(result.reason ?? '').toMatch(/interrupt/i);

    const types = events.map((e) => e.type);
    expect(types).toContain('voyage-interrupted');
    expect(types).not.toContain('voyage-completed');
    expect(orch.getBrainState()).toBe('idle');
  });

  test('voyage emits brain-state-changed for wakeful and dreaming transitions', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'brain.ts', 'export const b = 1;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
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

    await orch.runVoyage({ seedGoal: 'trigger brain states' });

    const transitions = events
      .filter(
        (e): e is Extract<OrchestratorEvent, { type: 'brain-state-changed' }> =>
          e.type === 'brain-state-changed'
      )
      .map((e) => `${e.from}→${e.to}`);

    // Must see at least: idle→wakeful, wakeful→dreaming, ...→idle
    expect(transitions).toContain('idle→wakeful');
    expect(transitions.some((t) => t.startsWith('wakeful→dreaming'))).toBe(true);
    expect(transitions.some((t) => t.endsWith('→idle'))).toBe(true);
  });

  test('voyage-idle carries the last waypoint id for UI continuity', async () => {
    const provider = makeMockProvider([
      fileWriteArgs(workdir, 'last.ts', 'export const l = 1;'),
      'DONE',
      JSON.stringify({ backlogItems: [], memoryEntries: [] }),
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

    const result = await orch.runVoyage({ seedGoal: 'last task' });
    const idle = events.find(
      (e): e is Extract<OrchestratorEvent, { type: 'voyage-idle' }> =>
        e.type === 'voyage-idle'
    );
    expect(idle).toBeDefined();
    expect(idle?.lastWaypointId).toBe(result.waypoints[0]!.waypoint.id);
    expect(idle?.backlogSize).toBe(0);
  });
});
