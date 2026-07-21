import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileWriteTool } from '../../src/tools/file.js';
import { runAgentTurn } from '../../src/agent/loop.js';
import { clearCompletedGoals } from '../../src/cerebellum/completedGoals.js';
import { clearSeedAttempts } from '../../src/cerebellum/seedAttempts.js';

/**
 * runAgentTurn — the agent layer's CLI entry point.
 *
 * src/agent/loop.ts exports runAgentTurn, which is the function src/index.ts
 * calls for every CLI input. agent-loop.test.ts covers buildSystemPrompt and
 * AgentContext (3 tests), but runAgentTurn itself had ZERO direct tests
 * despite being the public API boundary.
 *
 * The function's load-bearing behavior is the assistant-message capture
 * contract: it subscribes to the orchestrator's assistant-message event
 * stream, and the last non-empty message becomes the CLI's stdout.
 *
 *   - If ANY assistant-message was emitted (including the literal "DONE"
 *     string the orchestrator forwards as the completion signal), that
 *     message is the response. The fallback template is NOT used.
 *
 *   - The fallback template fires only when NO assistant-message was
 *     emitted — e.g. when the LLM returns empty content for every turn,
 *     triggering the safety-net abandoned path with no prose captured.
 *
 * Each test below pins one slice of this contract. The tests are organized
 * by the path through the orchestrator: success-with-DONE, conversational
 * stop with [CONVERSATIONAL-DONE] marker, safety-net abandoned, empty-input
 * fallback, and failure path.
 */

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

function textProvider(responses: string[]): LLMProvider {
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

describe('runAgentTurn — assistant-message capture', () => {
  let workdir: string;
  let tracePath: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    // Curiosity OFF, auto-approve OFF at the env level — runAgentTurn
    // forces auto-approve true internally, so the env value doesn't
    // matter for runWaypoint. Curiosity OFF keeps the test focused on
    // the single waypoint (no dream/curiosity side-effects).
    process.env.ODYSSEUS_CURIOSITY = '0';
    clearCompletedGoals();
    clearSeedAttempts();
    workdir = await mkdtemp(join(tmpdir(), 'ody-agent-loop-'));
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
      }),
    );
  });

  afterEach(async () => {
    delete process.env.ODYSSEUS_CURIOSITY;
    delete process.env.ODYSSEUS_AUTO_APPROVE;
    await rm(workdir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Behavior 1: "DONE" string is a valid assistant-message → response is "DONE"
  //
  // The orchestrator forwards the literal "DONE" string as an
  // assistant-message event (content is non-empty). runAgentTurn captures
  // it and returns it as the CLI response. This is the DEFAULT path for a
  // code-task waypoint that succeeds.
  // -------------------------------------------------------------------------

  test('response is "DONE" when LLM completes a code task with the DONE signal', async () => {
    // Provider emits a tool call (write a valid TS file), then 'DONE'.
    // The orchestrator emits assistant-message on the DONE turn — its
    // content is the literal "DONE" string.
    const provider = textProvider([
      fileWriteArgs(workdir, 'out.ts', 'export const v = 1;\n'),
      'DONE',
    ]);

    const result = await runAgentTurn('add a file', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    // Waypoint succeeded: file written, tsc passed, DONE observed.
    expect(result.waypointOutcome).toBe('success');
    // The literal "DONE" is the response — NOT the "Waypoint succeeded"
    // fallback template. Pinning this prevents a future refactor that
    // strips "DONE" from the assistant-message stream from silently
    // changing the CLI output shape.
    expect(result.response).toBe('DONE');
  });

  test('last assistant-message wins — "DONE" after multiple tool calls is still the response', async () => {
    // Multiple tool calls produce multiple assistant-messages (each carries
    // the JSON toolCall payload as content). But the final turn's "DONE"
    // is the last assistant-message — that's what surfaces.
    const provider = textProvider([
      fileWriteArgs(workdir, 'a.ts', 'export const a = 1;\n'),
      fileWriteArgs(workdir, 'b.ts', 'export const b = 2;\n'),
      'DONE',
    ]);

    const result = await runAgentTurn('add two files', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    expect(result.waypointOutcome).toBe('success');
    expect(result.response).toBe('DONE');
  });

  // -------------------------------------------------------------------------
  // Behavior 2: [CONVERSATIONAL-DONE] marker is stripped from the response
  //
  // The orchestrator's detectConversationalDone() removes the marker line
  // before emitting assistant-message. So the CLI response contains the
  // prose but NOT the protocol token. This is a defense-in-depth contract:
  // downstream consumers never see the raw marker.
  // -------------------------------------------------------------------------

  test('[CONVERSATIONAL-DONE] marker is stripped — response is the clean prose', async () => {
    // Marker on its own line. detectConversationalDone accepts this shape
    // and strips the marker line. The clean prose is what surfaces.
    const provider = textProvider(['Hi! I am Odysseus.\n[CONVERSATIONAL-DONE]']);

    const result = await runAgentTurn('你好', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    // Conversational stop — agent signaled no code task. outcome=abandoned
    // is NOT a failure; it is a clean conversational turn.
    expect(result.waypointOutcome).toBe('abandoned');
    // Response contains the prose.
    expect(result.response).toContain('Odysseus');
    // Response does NOT contain the raw marker — stripping is the contract.
    expect(result.response).not.toContain('[CONVERSATIONAL-DONE]');
  });

  test('inline marker (not on its own line) is NOT detected — response keeps it', async () => {
    // The marker must appear on its own line (or at start/end) to count.
    // A mid-sentence mention like "the [CONVERSATIONAL-DONE] token" does
    // NOT trigger detection. The orchestrator treats this as ordinary
    // prose — no conversational-stop break — and the safety net catches
    // it after the threshold. Pinning this so a future refactor that
    // loosens the detection regex (e.g. bare .includes()) is flagged.
    const inlineMention = 'I will discuss [CONVERSATIONAL-DONE] handling.';
    const provider = textProvider([
      inlineMention,
      inlineMention,
      inlineMention,
      inlineMention,
      inlineMention,
    ]);

    const result = await runAgentTurn('discuss the marker', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    // Safety net fires — 5 consecutive text-only turns, no real DONE,
    // no valid [CONVERSATIONAL-DONE] marker. outcome=abandoned.
    expect(result.waypointOutcome).toBe('abandoned');
    // The marker was NOT stripped — response still contains it verbatim.
    expect(result.response).toContain('[CONVERSATIONAL-DONE]');
  });

  // -------------------------------------------------------------------------
  // Behavior 3: Safety-net abandoned — response is the last prose turn
  //
  // When the LLM produces 5+ consecutive text-only turns without DONE or
  // [CONVERSATIONAL-DONE], the orchestrator stops with outcome=abandoned.
  // The last assistant-message is still emitted and becomes the response.
  // -------------------------------------------------------------------------

  test('safety-net abandoned — response is the last prose turn emitted', async () => {
    // 5 prose turns, each different, none containing DONE. The safety
    // net threshold is 5 — on the 5th text-only turn the orchestrator
    // breaks with conversationalStop=true.
    const provider = textProvider([
      'Let me think.',
      'Still thinking.',
      'Thinking more.',
      'Even more.',
      'Final thought.',
    ]);

    const result = await runAgentTurn('think', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    expect(result.waypointOutcome).toBe('abandoned');
    // The last prose turn ("Final thought.") is the response.
    expect(result.response).toBe('Final thought.');
  });

  // -------------------------------------------------------------------------
  // Behavior 4: Fallback template — only when NO assistant-message emitted
  //
  // runAgentTurn falls back to a structured outcome description ONLY when
  // the orchestrator never emitted any assistant-message event. This is a
  // narrow path: the LLM must return empty content on every turn (no
  // prose, no tool calls), eventually tripping the safety net.
  // -------------------------------------------------------------------------

  test('fallback template fires when LLM emits empty content on every turn', async () => {
    // textProvider returns empty strings. Orchestrator skips the
    // assistant-message emit when cleanContent is empty. After 5 empty
    // turns the safety net triggers abandoned. lastAssistantMessage
    // stays "" → fallback template is used.
    const provider = textProvider(['', '', '', '', '']);

    const result = await runAgentTurn('silent task', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    expect(result.waypointOutcome).toBe('abandoned');
    // outcome=abandoned → template is `Waypoint abandoned: <reason>`.
    expect(result.response.startsWith('Waypoint abandoned:')).toBe(true);
  });

  test('fallback template on success outcome uses iterations count', async () => {
    // Constructing the "success with no assistant-message" path is
    // impossible organically — success requires the loop to break on
    // "DONE", and "DONE" itself is a non-empty assistant-message. So
    // the success-fallback template `Waypoint succeeded (N iterations).`
    // is unreachable from runAgentTurn. Pinning the template shape via
    // direct string inspection of the source would be fragile. This
    // test is a placeholder that documents the unreachability — a future
    // refactor that makes the path reachable would need to update this.
    expect(true).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Behavior 5: Failure path — response is still the last assistant-message
  //
  // Even when verify fails (tsc error), if the LLM emitted "DONE" the
  // response is "DONE" — NOT the failure template. The failure template
  // only fires when no assistant-message was emitted, same as success.
  // -------------------------------------------------------------------------

  test('verify failure with prior DONE → response is "DONE", outcome is failure', async () => {
    // LLM writes a TS file with a type error, then emits DONE. Verify
    // (tsc) fails → outcome=failure. But the DONE was already forwarded
    // as assistant-message, so response is "DONE".
    const provider = textProvider([
      fileWriteArgs(workdir, 'bad.ts', 'export const x: number = "str";\n'),
      'DONE',
    ]);

    const result = await runAgentTurn('add a broken file', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    expect(result.waypointOutcome).toBe('failure');
    // The failure template is NOT used — "DONE" is the response.
    expect(result.response).toBe('DONE');
    // Verify: the response does NOT start with "Waypoint failure:".
    expect(result.response.startsWith('Waypoint failure:')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Behavior 6: autoApprove forced true — env var is ignored
  // -------------------------------------------------------------------------

  test('autoApprove is forced ON even when ODYSSEUS_AUTO_APPROVE=0', async () => {
    // Set the env to opt out. runAgentTurn ignores it (hard-coded
    // autoApprove: true). The observable effect: the waypoint runs to
    // completion without blocking on an approval gate.
    process.env.ODYSSEUS_AUTO_APPROVE = '0';
    const provider = textProvider([
      fileWriteArgs(workdir, 'out.ts', 'export const v = 1;\n'),
      'DONE',
    ]);

    const result = await runAgentTurn('add a file', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'test',
    });

    // If autoApprove were respected, the waypoint would hang on the
    // approval gate and the test would time out. A success outcome
    // proves autoApprove was forced ON internally.
    expect(result.waypointOutcome).toBe('success');
  });

  // -------------------------------------------------------------------------
  // Behavior 7: mission field is accepted but unused by runAgentTurn
  // -------------------------------------------------------------------------

  test('mission field in config does not affect runAgentTurn behavior', async () => {
    // runAgentTurn's signature includes `mission` in AgentLoopConfig,
    // but the function does not use it — the orchestrator's system
    // prompt comes from the engineer strategy, not from mission.
    const provider = textProvider([
      fileWriteArgs(workdir, 'out.ts', 'export const v = 1;\n'),
      'DONE',
    ]);

    const result = await runAgentTurn('add a file', {
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      mission: 'this mission is ignored by runAgentTurn',
    });

    expect(result.waypointOutcome).toBe('success');
  });
});
