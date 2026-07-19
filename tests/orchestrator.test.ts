import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../src/util/exec.js';
import { CerebellumOrchestrator } from '../src/cerebellum/orchestrator.js';
import type {
  LLMProvider,
  LLMCompletion,
  LLMCompleteOptions,
  ChatMessage,
} from '../src/llm/provider.js';
import type { OrchestratorEvent } from '../src/orchestrator/events.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { FileWriteTool } from '../src/tools/file.js';
import type { Tool, ToolContext, ToolResult } from '../src/tools/types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

/**
 * A second registered tool so the orchestrator's recovery hint has a real
 * "Other tools available" list to enumerate (the production hint filters out
 * the stuck tool name). Without a second tool the alternatives list is empty
 * and several assertions become vacuous.
 */
class NoopTool implements Tool {
  readonly name = 'noop';
  readonly description = 'Does nothing — used to populate the alternatives list.';
  readonly parameters = {
    type: 'object',
    properties: {},
    required: [],
  };
  async execute(): Promise<ToolResult> {
    return { ok: true, value: 'noop' };
  }
}

function extractToolCalls(content: string): unknown {
  try {
    const parsed = JSON.parse(content) as { toolCalls?: unknown };
    return parsed.toolCalls;
  } catch {
    return undefined;
  }
}

interface RecordedCall {
  prompt: string;
  options: LLMCompleteOptions;
}

/**
 * Provider that returns a scripted sequence of responses and records every
 * `complete()` invocation (prompt + options) so tests can assert on the
 * history injected between turns (recovery hint, final-retry nudge).
 */
function makeRecordingProvider(responses: string[]): {
  provider: LLMProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let call = 0;
  const provider: LLMProvider = {
    async complete(prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion> {
      calls.push({ prompt, options: options ?? {} });
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
  return { provider, calls };
}

function fileWriteCall(dir: string, filename: string, content: string): string {
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

function recoveryEvents(events: OrchestratorEvent[]): OrchestratorEvent[] {
  return events.filter((e) => e.type === 'recovery-intervention');
}

function userMessages(history: ChatMessage[] | undefined): string[] {
  return (history ?? []).filter((m) => m.role === 'user').map((m) => m.content);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('repeatedToolCallDetector abort logic (orchestrator integration)', () => {
  let workdir: string;
  let tracePath: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-orch-abort-'));
    tracePath = join(workdir, 'trace.jsonl');
    await initRepo(workdir);
    registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    registry.register(new NoopTool());
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

  test('first loop detection injects a recovery hint into history and emits recovery-intervention (no abort)', async () => {
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const { provider, calls } = makeRecordingProvider([
      stuck, // iter 1 — window: [sig]
      stuck, // iter 2 — window: [sig, sig]
      stuck, // iter 3 — window full + identical → recovery injected, NOT aborted
      'DONE', // iter 4 — LLM heeds the hint and exits cleanly
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

    // The recovery path must NOT abort — the waypoint succeeds once the LLM
    // responds to the hint.
    expect(result.outcome).toBe('success');
    expect(result.failReason).toBeUndefined();

    // Exactly one recovery-intervention event, naming the stuck tool.
    const recoveries = recoveryEvents(events);
    expect(recoveries.length).toBe(1);
    const recovery = recoveries[0]!;
    expect(recovery.type).toBe('recovery-intervention');
    if (recovery.type === 'recovery-intervention') {
      expect(recovery.tool).toBe('file-write');
      // The contextual hint wraps the detector's base message and appends
      // goal context + the list of alternative tools.
      expect(recovery.message).toContain('RECOVERY INTERVENTION');
      expect(recovery.message).toContain('write a file');
      expect(recovery.message).toContain('Other tools available');
      expect(recovery.message).toContain('noop');
    }

    // The hint must appear as a user message in the history of the turn
    // AFTER detection (iter 4). The detector window is reset on recovery,
    // so this is the only recovery injection in the whole run.
    const postDetectionCall = calls[3]!;
    expect(userMessages(postDetectionCall.options.history)).toEqual(
      expect.arrayContaining([expect.stringContaining('RECOVERY INTERVENTION')])
    );

    // No final-retry nudge should have been emitted — that path is reserved
    // for the second (StuckLoopError) detection.
    const allUserMsgs = calls.flatMap((c) => userMessages(c.options.history));
    expect(allUserMsgs.some((m) => m.includes('STUCK LOOP — FINAL RETRY'))).toBe(false);
  });

  test('recovery resets the window: a different tool call after the hint does not re-trigger', async () => {
    // After the first detection the detector window is cleared. A single
    // different (or even identical-but-fewer-than-3) call must NOT trip the
    // abort. This guards the "one free retry" semantics of the recovery path.
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const different = fileWriteCall(workdir, 'other.ts', 'export const w = 2;');
    const { provider } = makeRecordingProvider([
      stuck, // iter 1
      stuck, // iter 2
      stuck, // iter 3 → recovery injected, window reset
      different, // iter 4 — different signature, window: [sig2]
      'DONE', // iter 5
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

    expect(result.outcome).toBe('success');
    // Only the first-detection recovery event — no second intervention.
    expect(recoveryEvents(events).length).toBe(1);
  });

  test('second loop detection throws StuckLoopError → orchestrator injects FINAL RETRY nudge and continues once', async () => {
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const recovered = fileWriteCall(workdir, 'recovered.ts', 'export const r = 1;');
    const { provider, calls } = makeRecordingProvider([
      stuck, // iter 1
      stuck, // iter 2
      stuck, // iter 3 → first detection: recovery hint injected, window reset
      stuck, // iter 4 — window: [sig]
      stuck, // iter 5 — window: [sig, sig]
      stuck, // iter 6 → StuckLoopError thrown, caught, FINAL RETRY nudge injected, continue
      recovered, // iter 7 — LLM picks a different approach
      'DONE', // iter 8
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

    // The single retry must allow recovery — not a failure.
    expect(result.outcome).toBe('success');
    expect(result.failReason).toBeUndefined();
    const written = await readFile(join(workdir, 'recovered.ts'), 'utf8');
    expect(written).toContain('r = 1');

    // Two recovery-intervention events: first = recovery hint, second = nudge.
    const recoveries = recoveryEvents(events);
    expect(recoveries.length).toBe(2);
    const nudge = recoveries[1]!;
    expect(nudge.type).toBe('recovery-intervention');
    if (nudge.type === 'recovery-intervention') {
      expect(nudge.tool).toBe('file-write');
      expect(nudge.message).toContain('STUCK LOOP — FINAL RETRY');
      expect(nudge.message).toContain('last attempt');
    }

    // The FINAL RETRY nudge must appear in the history of the turn after the
    // StuckLoopError (iter 7). The stuck tool call at iter 6 is skipped —
    // not dispatched — so no tool result for it lands in history.
    const postNudgeCall = calls[6]!;
    expect(userMessages(postNudgeCall.options.history)).toEqual(
      expect.arrayContaining([expect.stringContaining('STUCK LOOP — FINAL RETRY')])
    );

    // The stuck call at iter 6 must NOT have been dispatched. Iters 1–5 each
    // dispatched file-write to loop.ts (5 loop.ts tool results); iter 6 threw
    // StuckLoopError and was skipped before dispatch; iter 7 dispatched
    // file-write to recovered.ts (1 result). So iter 7's history carries
    // exactly 5 tool messages referencing loop.ts — NOT 6, which would mean
    // the skipped stuck call was erroneously dispatched.
    const history7 = postNudgeCall.options.history ?? [];
    const toolMsgs = history7.filter((m) => m.role === 'tool');
    const loopMsgs = toolMsgs.filter((m) => m.content.includes('loop.ts'));
    expect(loopMsgs.length).toBe(5);

    // Stronger ordering check: the iter-6 assistant message (carrying the
    // stuck tool call) must be immediately followed by the FINAL RETRY nudge
    // user message — with NO tool message in between, proving the stuck call
    // was skipped rather than dispatched.
    const nudgeIdx = history7.findIndex(
      (m) => m.role === 'user' && m.content.includes('STUCK LOOP — FINAL RETRY')
    );
    expect(nudgeIdx).toBeGreaterThan(0);
    expect(history7[nudgeIdx - 1]!.role).toBe('assistant');
    expect(history7[nudgeIdx - 1]!.toolCalls).toBeDefined();
  });

  test('third loop detection (after the single retry) propagates StuckLoopError → rollback + failure', async () => {
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const { provider } = makeRecordingProvider([
      stuck, // iter 1
      stuck, // iter 2
      stuck, // iter 3 → first detection: recovery hint
      stuck, // iter 4
      stuck, // iter 5
      stuck, // iter 6 → StuckLoopError → FINAL RETRY nudge, retry consumed
      stuck, // iter 7
      stuck, // iter 8
      stuck, // iter 9 → second StuckLoopError, NOT retried → propagates
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

    // The hard abort: outcome is failure with the StuckLoopError reason.
    expect(result.outcome).toBe('failure');
    expect(result.failReason ?? '').toMatch(/Stuck loop detected/);
    expect(result.failReason ?? '').toMatch(/file-write/);

    // The propagating error triggers the outer catch → rollback + failure
    // event. No commit, no verify.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('waypoint-committed');
    expect(types).not.toContain('verify-started');
    expect(types).toContain('waypoint-failed');

    // The stuck file must have been rolled back (no commit landed it).
    await expect(readFile(join(workdir, 'loop.ts'), 'utf8')).rejects.toThrow();

    // Exactly two recovery-intervention events (hint + nudge); the third
    // detection throws directly with no further intervention event.
    expect(recoveryEvents(events).length).toBe(2);
  });

  test('detector is scoped per waypoint: a fresh runWaypoint starts with an empty window', async () => {
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const { provider } = makeRecordingProvider([
      // First waypoint: trips recovery then exits via DONE.
      stuck,
      stuck,
      stuck, // → recovery
      'DONE',
      // Second waypoint: the SAME identical calls must trip recovery again
      // from scratch — the detector must NOT carry state across waypoints.
      stuck,
      stuck,
      stuck, // → recovery (proves the window was reset between waypoints)
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

    const r1 = await orch.runWaypoint({ goal: 'first file' });
    const r2 = await orch.runWaypoint({ goal: 'second file' });

    expect(r1.outcome).toBe('success');
    expect(r2.outcome).toBe('success');

    // Two recovery interventions — one per waypoint — proving the per-waypoint
    // detector reset. If state leaked, the second waypoint's third identical
    // call would have thrown StuckLoopError instead of emitting recovery.
    const recoveries = recoveryEvents(events);
    expect(recoveries.length).toBe(2);
    if (recoveries[0]!.type === 'recovery-intervention') {
      expect(recoveries[0]!.message).toContain('first file');
    }
    if (recoveries[1]!.type === 'recovery-intervention') {
      expect(recoveries[1]!.message).toContain('second file');
    }
  });

  test('different tool arguments break the streak: no recovery, no abort', async () => {
    // The detector keys on name + serialized args. Varying the path each turn
    // means no three identical signatures → no intervention at all.
    const { provider } = makeRecordingProvider([
      fileWriteCall(workdir, 'a.ts', 'export const a = 1;'),
      fileWriteCall(workdir, 'b.ts', 'export const b = 2;'),
      fileWriteCall(workdir, 'c.ts', 'export const c = 3;'),
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

    const result = await orch.runWaypoint({ goal: 'write three files' });

    expect(result.outcome).toBe('success');
    expect(recoveryEvents(events).length).toBe(0);
  });

  test('recovery hint enumerates only tools other than the stuck one', async () => {
    const stuck = fileWriteCall(workdir, 'loop.ts', 'export const v = 1;');
    const { provider } = makeRecordingProvider([stuck, stuck, stuck, 'DONE']);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const events = subscribe(orch);

    await orch.runWaypoint({ goal: 'write a file' });

    const recovery = recoveryEvents(events)[0]!;
    expect(recovery.type).toBe('recovery-intervention');
    if (recovery.type === 'recovery-intervention') {
      // The stuck tool (file-write) must NOT appear in the alternatives list,
      // but the other registered tool (noop) must.
      expect(recovery.message).toContain('noop');
      // "Other tools available: noop." — file-write should be absent from
      // that specific enumeration (it may still appear elsewhere in the
      // message as the stuck-tool reference).
      const alternativesLine = recovery.message
        .split('\n')
        .find((l) => l.includes('Other tools available'));
      expect(alternativesLine).toBeDefined();
      expect(alternativesLine!).not.toContain('file-write');
    }
  });
});
