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
import { enqueueBacklog } from '../../src/cerebellum/backlog.js';

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
    // Default: auto-approve OFF. Tests in this suite assert the consent-gate
    // behavior. Tests that need auto-approve ON set the env var explicitly.
    process.env.ODYSSEUS_AUTO_APPROVE = '0';
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
    delete process.env.ODYSSEUS_AUTO_APPROVE;
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
    // Simulates an ambiguous goal that slips past the pre-dispatch validator
    // (no greeting/question pattern, no action verb → "unknown intent, let
    // through") but to which the LLM keeps replying with plain text, never
    // invokes tools, and NEVER emits [CONVERSATIONAL-DONE]. Without the
    // consecutiveTextOnly safety net, the loop would burn all 16 iterations
    // and emit a failure. With the net at threshold=5, the orchestrator
    // stops after 5 conversational turns and marks abandoned.
    //
    // This is the safety-net path — the primary conversational-stop path
    // is [CONVERSATIONAL-DONE] emission (covered by other tests). The net
    // exists to catch agents that forget to emit the marker.
    const provider = makeMockProvider([
      'Hi! I am Odysseus, ready to help.',
      'Please give me a concrete task.',
      'Still waiting for a real goal — try "add a file".',
      'I do not have enough information to proceed.',
      'Could you clarify what you would like me to do?',
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

    const result = await orch.runWaypoint({ goal: 'not sure what to do here' });

    expect(result.outcome).toBe('abandoned');
    expect(result.iterationsUsed).toBe(5);
    expect(result.failReason ?? '').toMatch(/^conversational stop/i);
    // Safety-net path, not the signal path:
    expect(result.failReason ?? '').not.toMatch(/^agent emitted/i);

    // The agent must NOT have committed or attempted verify.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('verify-started');
    expect(types).not.toContain('waypoint-committed');

    // All five conversational replies should be surfaced to the UI.
    const assistantMessages = events.filter(
      (e): e is Extract<OrchestratorEvent, { type: 'assistant-message' }> =>
        e.type === 'assistant-message'
    );
    expect(assistantMessages.length).toBe(5);
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

  test('greeting flows through LLM once and stops (honors reply-once-and-stop)', async () => {
    // A pure greeting ("hi") used to be hard-rejected by validateGoal before
    // any LLM call. That optimization cost agency: the agent could never
    // respond naturally to "hi" — chat path fell back to base-model identity.
    //
    // New contract: greeting enters orchestrator, agent replies once and
    // emits [CONVERSATIONAL-DONE] to signal the conversational turn is
    // complete. Orchestrator trusts the signal, waypoint ends cleanly
    // with outcome='abandoned' after exactly 1 turn.
    const provider = makeMockProvider([
      'Hi! I am Odysseus, ready to help.\n[CONVERSATIONAL-DONE]',
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
    expect(result.iterationsUsed).toBe(1);
    expect(result.failReason ?? '').toMatch(/conversational/i);

    // Exactly one assistant message emitted (the single reply).
    const assistantMessages = events.filter((e) => e.type === 'assistant-message');
    expect(assistantMessages.length).toBe(1);

    // No verify (no work done) and no commit.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('verify-started');
    expect(types).not.toContain('waypoint-committed');
  });

  test('two text replies (clarification flow) do NOT trip the conversational guard', async () => {
    // Threshold = 3 means a legitimate "ask clarifying question → receive
    // user reply → start working" two-text-turn flow must not be flagged
    // as abandoned. The agent gets one more chance to invoke a tool.
    const provider = makeMockProvider([
      'Which file should I modify?', // text 1
      'Got it, modifying now.',       // text 2
      fileWriteArgs(workdir, 'ok.ts', 'export const v = 1;'), // tool activity
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
    expect(result.iterationsUsed).toBe(4);
  });

  test('LLM error (AbortError) degrades to waypoint failure, not process crash', async () => {
    // Reproduces the production crash: GLM fetch times out after 60s, fetch
    // throws DOMException[AbortError], withRetry exhausts 3 attempts, and
    // the error bubbles to runWaypoint. Without graceful degradation this
    // crashes the process via main.ts's top-level catch. With the fix, the
    // waypoint is marked failure and the caller decides what to do next.
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    const provider: LLMProvider = {
      async complete(): Promise<LLMCompletion> {
        throw err;
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
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    // Must NOT throw — that's the entire point of the fix.
    const result = await orch.runWaypoint({ goal: 'anything' });

    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/abort/i);

    // Events: started → iteration → failed. No verify, no commit, and
    // crucially NOT waypoint-rolled-back (that's reserved for interrupts).
    const types = events.map((e) => e.type);
    expect(types).toContain('waypoint-started');
    expect(types).toContain('waypoint-failed');
    expect(types).not.toContain('verify-started');
    expect(types).not.toContain('waypoint-committed');
    expect(types).not.toContain('waypoint-rolled-back');

    const failed = events.find(
      (e): e is Extract<OrchestratorEvent, { type: 'waypoint-failed' }> =>
        e.type === 'waypoint-failed'
    );
    expect(failed?.error ?? '').toMatch(/abort/i);
  });

  test('repeatedToolCallDetector appends recovery hint to messages on first loop detection', async () => {
    // The detector uses a sliding window of size 3. Three identical tool
    // calls fill the window → first loop detection → recovery hint injected
    // into history + recovery-intervention event emitted. A subsequent DONE
    // from the LLM exits the loop cleanly (no rollback).
    const sameToolCall = fileWriteArgs(workdir, 'loop.ts', 'export const v = 1;');
    const provider = makeMockProvider([
      sameToolCall, // iter 1 — window: [sig]
      sameToolCall, // iter 2 — window: [sig, sig]
      sameToolCall, // iter 3 — window: [sig, sig, sig] → loop detected
      'DONE',      // iter 4 — LLM heeds the hint and exits
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

    const result = await orch.runWaypoint({ goal: 'write a file' });

    // The waypoint should succeed — the recovery hint gave the LLM a
    // chance to break out of the loop and it responded with DONE.
    expect(result.outcome).toBe('success');

    // A recovery-intervention event must have been emitted.
    const recoveryEvents = events.filter(
      (e): e is Extract<OrchestratorEvent, { type: 'recovery-intervention' }> =>
        e.type === 'recovery-intervention'
    );
    expect(recoveryEvents.length).toBe(1);

    const recovery = recoveryEvents[0]!;
    // The recovery message must reference the stuck tool name.
    expect(recovery.tool).toBe('file-write');
    // The message must contain the goal context injected by the orchestrator.
    expect(recovery.message).toContain('write a file');
    // The message must mention available alternative tools (at least file-write
    // is in the registry, but the hint lists tools *other* than the stuck one).
    expect(recovery.message).toContain('Other tools available');
    // The message must include the detector's base recovery text.
    expect(recovery.message).toContain('RECOVERY INTERVENTION');
  });

  test('voyage survives an LLM error on one waypoint and continues', async () => {
    // The reason graceful degradation matters: a single bad LLM call must
    // not kill the entire voyage. After the failing waypoint returns
    // outcome=failure, runVoyage proceeds to the dreaming phase and the
    // next backlog item (if any).
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';

    // Sequence of LLM responses across the whole voyage:
    //   call 1 = waypoint 1 iter 1 → throw AbortError
    //   call 2 = dream 1 → empty (no items)
    //   call 3 = waypoint 2 iter 1 → file-write tool call
    //   call 4 = waypoint 2 iter 2 → DONE
    //   call 5 = dream 2 → empty
    const emptyDream = JSON.stringify({ backlogItems: [], memoryEntries: [] });
    const responses: Array<Error | string> = [
      err,
      emptyDream,
      fileWriteArgs(workdir, 'recovered.ts', 'export const r = 1;'),
      'DONE',
      emptyDream,
    ];
    let callIdx = 0;
    const provider: LLMProvider = {
      async complete(): Promise<LLMCompletion> {
        const next = responses[Math.min(callIdx, responses.length - 1)];
        callIdx += 1;
        if (next instanceof Error) throw next;
        // Reuse the makeMockProvider parsing logic: try to extract toolCalls
        // from a JSON-shaped content string.
        let toolCalls: unknown;
        try {
          const parsed = JSON.parse(next) as { toolCalls?: unknown };
          toolCalls = parsed.toolCalls;
        } catch {
          toolCalls = undefined;
        }
        return {
          content: next,
          model: 'mock',
          usage: { inputTokens: 1, outputTokens: 1 },
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

    // Use a tracePath under .odysseus/ so memoryRoot() matches the
    // enqueueBacklog path. This is the production layout.
    const voyageTracePath = join(workdir, '.odysseus', 'trace.jsonl');
    await enqueueBacklog(join(workdir, '.odysseus'), 'crashing task', 'user', {
      priority: 50,
    });
    await enqueueBacklog(join(workdir, '.odysseus'), 'recoverable task', 'user', {
      priority: 60,
    });

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath: voyageTracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runVoyage();

    // Both waypoints ran; first failed, second succeeded.
    expect(result.waypoints.length).toBe(2);
    expect(result.waypoints[0]!.outcome).toBe('failure');
    expect(result.waypoints[1]!.outcome).toBe('success');
    expect(result.outcome).toBe('completed');

    // The recovered file actually landed.
    const recovered = await readFile(join(workdir, 'recovered.ts'), 'utf8');
    expect(recovered).toContain('r = 1');
  });
});
