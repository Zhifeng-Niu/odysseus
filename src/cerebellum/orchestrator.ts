// SACRED FILE — manual review required for any change (design spec Section 6.1).
//
// Any modification to this file MUST be reviewed by a human operator before
// merging. The Cerebellum orchestrator is the trust boundary of the agent:
//   - The verify gate is HARD. No LLM "confidence" can bypass tsc/tests/lint.
//   - `allowedShas` is the "zeroth law" defense — the agent cannot `git reset`
//     to any SHA outside this session-scoped allowlist (see rollback.ts).
//
// If you are tempted to weaken either invariant, STOP and escalate.

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFileNoThrow } from '../util/exec.js';
import type { LLMProvider, ChatMessage, ToolCall } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import {
  createWaypoint,
  markActive,
  markSuccess,
  markFailure,
  markAbandoned,
  type Waypoint,
} from './waypoint.js';
import { createCheckpoint } from './checkpoint.js';
import { rollbackTo } from './rollback.js';
import { runVerify, type VerifyLayer } from './verify.js';
import { selectStrategy, setStrategyCwd } from './strategy.js';
import { validateGoal } from './goal-validator.js';
import { appendTrace, readTrace } from '../trace/jsonl.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { InterruptedError, RejectedError, StuckLoopError } from '../orchestrator/errors.js';
import {
  INITIAL_BRAIN_STATE,
  canTransitionTo,
  type BrainState,
  type BrainStateTransition,
} from './brain-state.js';
import { dream } from './dreamer.js';
import {
  enqueueBacklog,
  peekBacklog,
  dequeueBacklog,
  sizeBacklog,
  recordRejectedGoal,
} from './backlog.js';
import { readMemory, writeMemory, type MemoryEntry } from './memory.js';
import { markCompleted } from './completedGoals.js';
import { RepeatedToolCallDetector } from './repeated-tool-call-detector.js';
import type { MemoryCategory } from '../orchestrator/events.js';

export interface OrchestratorConfig {
  cwd: string;
  provider: LLMProvider;
  registry: ToolRegistry;
  tracePath: string;
  verifyLayers: readonly VerifyLayer[];
  maxIterations?: number;
  /**
   * When true (default in non-TTY contexts), waypoints auto-commit once verify
   * passes. When false, the orchestrator emits `waypoint-awaiting-approval`
   * and blocks on `approve(waypointId)` / `reject(waypointId, reason)` before
   * committing.
   */
  autoApprove?: boolean;
}

export interface RunWaypointInput {
  goal: string;
  parentWaypointId?: string;
}

export interface RunWaypointResult {
  waypoint: Waypoint;
  outcome: 'success' | 'failure' | 'abandoned';
  checkpointSha?: string;
  failReason?: string;
  iterationsUsed: number;
  tokensConsumed: { input: number; output: number };
}

export interface RunVoyageResult {
  voyageId: string;
  waypoints: RunWaypointResult[];
  outcome: 'completed' | 'interrupted';
  reason?: string;
  dreamCount: number;
}

interface OrchestratorState {
  allowedShas: Set<string>;
  totalInput: number;
  totalOutput: number;
}

interface PendingApproval {
  resolve: () => void;
  reject: (err: Error) => void;
}

const DEFAULT_AUTO_APPROVE =
  typeof process !== 'undefined' && process.stdout?.isTTY === true ? false : true;

export class CerebellumOrchestrator extends EventEmitter {
  private readonly state: OrchestratorState = {
    allowedShas: new Set(),
    totalInput: 0,
    totalOutput: 0,
  };

  /**
   * In-progress approval gates keyed by waypointId. Resolves when `approve()`
   * is called; rejects with `RejectedError` if `reject()` is called.
   */
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  /**
   * Messages injected via `injectMessage()` while a waypoint is running.
   * Drained into the next LLM turn's history as a `user` message.
   */
  private readonly injectedMessages: string[] = [];

  /**
   * Set by `interrupt()`. Checked between LLM turns and inside
   * `waitForApproval()` so the loop unwinds instead of hanging.
   */
  private interrupted = false;

  /**
   * Current brain state. Drives the dreaming/reflecting/consolidating
   * sub-phases of the voyage loop. Mutated only via `setBrainState()` so
   * every transition emits a `brain-state-changed` event for observers.
   */
  private brainState: BrainState = INITIAL_BRAIN_STATE;

  private readonly autoApprove: boolean;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
    this.autoApprove = config.autoApprove ?? DEFAULT_AUTO_APPROVE;
    // Publish cwd to the strategy layer so the engineer system prompt can
    // resolve `.odysseus/self-model.md` and inject it at every waypoint
    // start (closes the "no continuous self" gap from wp_mrs855ke007).
    setStrategyCwd(config.cwd);
  }

  private readonly config: OrchestratorConfig;

  async runWaypoint(input: RunWaypointInput): Promise<RunWaypointResult> {
    const waypoint = createWaypoint({
      goal: input.goal,
      ...(input.parentWaypointId !== undefined
        ? { parentWaypointId: input.parentWaypointId }
        : {}),
    });
    const strategy = selectStrategy({ goal: input.goal });

    this.emitEvent({
      type: 'waypoint-started',
      waypointId: waypoint.id,
      goal: waypoint.goal,
      strategy: strategy.name,
      ts: Date.now(),
    });

    // PRE-DISPATCH GOAL CLASSIFIER — advisory signal, not a hard gate.
    //
    // History: this used to be a hard reject for conversational goals (greeting,
    // identity question, off-topic chat). The rejection saved a checkpoint and
    // up to 3 LLM turns, but at the cost of agency: the agent could never
    // respond naturally to "hi" or "who are you" — it just failed silently.
    // That trade produced the failure captured in the user's 2026-07-20
    // transcript where the chat path fell back to base-model identity ("I am
    // GLM, by Z.ai") because no Odysseus context ever loaded.
    //
    // Now: empty goals still hard-reject (nothing for the agent to do). All
    // other conversational/informational goals flow through the LLM. The
    // classifier output is used as a HINT to lower the consecutiveTextOnly
    // threshold to 1 (instead of 3) — so when the input looks conversational,
    // a single text reply ends the waypoint cleanly, honoring the engineer
    // prompt's "reply once and stop" promise.
    const validation = validateGoal(input.goal);
    const isEmptyGoal = !validation.valid && validation.reason === 'goal is empty';
    if (isEmptyGoal) {
      const reason = 'goal is empty';
      recordRejectedGoal(input.goal, reason);
      const abandoned = markAbandoned(waypoint, reason);
      await this.trace(abandoned, null, null);
      this.emitEvent({
        type: 'waypoint-failed',
        waypointId: waypoint.id,
        error: reason,
        ts: Date.now(),
      });
      return {
        waypoint: abandoned,
        outcome: 'abandoned',
        ...(abandoned.failureReason !== undefined
          ? { failReason: abandoned.failureReason }
          : {}),
        iterationsUsed: 0,
        tokensConsumed: { input: 0, output: 0 },
      };
    }
    // HINT: looks conversational/informational (no action verb). Used below to
    // lower the consecutiveTextOnly threshold so one text reply ends the
    // waypoint. Action-verb goals keep the original threshold of 3 so the
    // "ask one clarifying question → receive reply → start working" flow
    // still works for ambiguous code tasks.
    const conversationalHint = !validation.valid;

    // LAZY CHECKPOINT — deferred until the first mutating tool call.
    //
    // History: the eager checkpoint at waypoint start taxed every input —
    // including pure-conversational ones like "hi" or "who are you" — with
    // a git add -A + commit cycle. That was waste: nothing the agent does
    // in response to "hi" will ever need rolling back. The lazy checkpoint
    // pays the git tax only when the agent actually reaches for a mutating
    // tool (file-write, file-edit, git-commit, bash). Read-only flows
    // (file-read, git-log/status/diff/rev-parse) and pure-text conversational
    // replies never trigger a checkpoint.
    //
    // Failure mode shift: if checkpoint creation fails on the first mutating
    // call, the error is surfaced to the LLM as a tool result rather than
    // abandoning the waypoint. This lets the agent recover — e.g. trying a
    // different approach or reporting DONE with a diagnostic. Bonus: a
    // non-git cwd no longer breaks conversational inputs, only mutating ones.
    //
    // Implementation note: the checkpoint is wrapped in a holder object so
    // that TypeScript's control-flow analysis doesn't narrow it back to
    // `null` after the `ensureCheckpoint` closure runs. Assigning to a
    // property (`cp.current = ...`) is opaque to narrowing, so the rest of
    // the function sees `{ sha: string } | null` correctly.
    const cp: { current: { sha: string } | null } = { current: null };
    const ensureCheckpoint = async (): Promise<
      { ok: true; sha: string } | { ok: false; error: string }
    > => {
      if (cp.current !== null) return { ok: true, sha: cp.current.sha };
      const created = await createCheckpoint({
        cwd: this.config.cwd,
        label: `${waypoint.id}-start`,
      });
      if (!created.ok) return created;
      cp.current = { sha: created.sha };
      this.state.allowedShas.add(created.sha);
      return { ok: true, sha: created.sha };
    };

    // ACT — LLM ↔ Tool loop
    const active = markActive(waypoint); // checkpointSha filled in lazily
    // maxIter is now optional — undefined means "run until DONE, interrupt,
    // conversational stop, or repeated-tool-call detection". The loop body
    // has explicit breaks on each of those conditions, so undefined is safe.
    const maxIter: number | undefined =
      this.config.maxIterations ?? strategy.maxIterations;

    // History always carries the goal as its first user message; the strategy
    // prompt is passed via options.systemPrompt on every call. We never use
    // `prompt` (the provider's "new user message" slot) — passing an empty
    // string tells the provider to rely on history as the message stream.
    const history: ChatMessage[] = [{ role: 'user', content: input.goal }];

    let iterationsUsed = 0;
    let lastAssistantContent = '';
    let consecutiveTextOnly = 0;
    let conversationalStop = false;
    let stuckLoopRetried = false;
    // PRESERVATION BUFFER — captures the raw content of each consecutive
    // text-only assistant turn (in order). When the 3-strike early-stop
    // fires below, we scan this buffer for any turn > 500 chars. Such
    // turns are likely diagnostic/reflective outputs (cf. wp_mrs855ke007)
    // rather than conversational drift, so we write them to
    // `.odysseus/memory/dreams.md` with source='reflect' and
    // related=waypointId BEFORE rolling back — exempting them from the
    // silent loss the early-stop otherwise imposes. The buffer is reset
    // to [] whenever a tool call lands (progress on a real task).
    const textOnlyTurns: string[] = [];

    // REPEATED-TOOL-CALL DETECTOR — sliding window of the last 3 tool-call
    // signatures (name + serialized args). When all 3 entries are identical
    // the agent is stuck in a loop; we throw and the surrounding try/catch
    // rolls back to the checkpoint. Scoped per waypoint so a fresh task
    // starts with an empty window.
    const loopDetector = new RepeatedToolCallDetector(3);

    // SELF-MONITOR HOOK — continuous self-awareness during wakeful execution.
    // Currently self-reflection only runs in the dream phase (between
    // waypoints), never during the LLM↔tool loop itself. This hook closes
    // that gap: every SELF_MONITOR_INTERVAL tool calls it injects a brief
    // observation nudge into the conversation as a user message, prompting
    // the agent to notice its own patterns ("am I repeating?", "did I
    // misread the goal?") and self-correct before burning the rest of its
    // iteration budget. It is NOT an abort — the loop continues normally;
    // the nudge merely gives the LLM a chance to reflect mid-waypoint.
    const SELF_MONITOR_INTERVAL = 3;
    let toolCallCount = 0;

    try {
      for (let iter = 1; maxIter === undefined || iter <= maxIter; iter++) {
        if (this.interrupted) {
          throw new InterruptedError('user requested interrupt between iterations');
        }
        iterationsUsed = iter;
        this.emitEvent({
          type: 'waypoint-iteration',
          waypointId: waypoint.id,
          iteration: iter,
          ts: Date.now(),
        });

        // Drain any injected messages as user turns before the next LLM call.
        while (this.injectedMessages.length > 0) {
          const msg = this.injectedMessages.shift()!;
          history.push({ role: 'user', content: msg });
        }

        const completion = await this.config.provider.complete('', {
          systemPrompt: strategy.systemPrompt,
          history,
          tools: this.config.registry.listSpecs(),
        });
        this.state.totalInput += completion.usage.inputTokens;
        this.state.totalOutput += completion.usage.outputTokens;

        if (completion.toolCalls && completion.toolCalls.length > 0) {
          // Tool activity resets the conversational-turn counter — the agent
          // is making progress on a real code task.
          consecutiveTextOnly = 0;
          textOnlyTurns.length = 0;
          // OpenAI/GLM contract: one assistant message carries all parallel
          // tool_calls, followed by one tool message per call. Splitting
          // tool_calls across multiple assistant messages yields HTTP 400.
          history.push({
            role: 'assistant',
            content: completion.content,
            toolCalls: completion.toolCalls,
          });
          if (completion.content) {
            this.emitEvent({
              type: 'assistant-message',
              waypointId: waypoint.id,
              content: completion.content,
              ts: Date.now(),
            });
          }
          for (const call of completion.toolCalls) {
            const args = this.parseToolArgs(call);
            const callId = call.id;

            // REPEATED-TOOL-CALL DETECTOR — record this call's signature and
            // check for a loop. On first detection a recovery context message
            // is injected into the history so the LLM can try a different
            // approach. On second detection the detector throws StuckLoopError.
            // The orchestrator catches it, injects a stronger context nudge,
            // and retries once before letting it propagate to the outer catch
            // for rollback + failure.
            let detection;
            try {
              detection = loopDetector.record(call.function.name, args);
            } catch (err) {
              if (err instanceof StuckLoopError && !stuckLoopRetried) {
                stuckLoopRetried = true;
                const nudge =
                  `[STUCK LOOP — FINAL RETRY] The tool "${call.function.name}" has been ` +
                  `called repeatedly with identical arguments and a prior recovery ` +
                  `intervention was ignored. This is your last attempt. You MUST ` +
                  `choose a fundamentally different approach or a different tool. ` +
                  `If the task cannot be accomplished, respond with DONE and explain ` +
                  `what you tried and why it failed.`;
                history.push({ role: 'user', content: nudge });
                this.emitEvent({
                  type: 'recovery-intervention',
                  waypointId: waypoint.id,
                  tool: call.function.name,
                  message: nudge,
                  ts: Date.now(),
                });
                // Skip dispatching the stuck tool call — continue to the
                // next iteration so the LLM sees the nudge and picks a new
                // approach. Guard flag `stuckLoopRetried` prevents a third
                // attempt: the next StuckLoopError will fall through to the
                // `else` branch and propagate, triggering rollback.
                continue;
              } else {
                throw err;
              }
            }
            if (detection.loopDetected && detection.recoveryMessage) {
              // Build a contextual recovery hint that references the goal,
              // the stuck tool, and available alternatives so the LLM can
              // make an informed decision instead of guessing.
              const availableTools = this.config.registry.listSpecs().map((s) => s.function.name);
              const alternatives = availableTools.filter((n) => n !== call.function.name);
              const contextualHint =
                `${detection.recoveryMessage}\n\n` +
                `Context — you are working on: "${input.goal}"\n` +
                `The stuck call was: ${call.function.name}(${JSON.stringify(args)}).\n` +
                `Other tools available: ${alternatives.length > 0 ? alternatives.join(', ') : '(none)'}. ` +
                `Consider whether a different tool or a fundamentally different ` +
                `approach would make progress on the goal.`;
              history.push({ role: 'user', content: contextualHint });
              this.emitEvent({
                type: 'recovery-intervention',
                waypointId: waypoint.id,
                tool: call.function.name,
                message: contextualHint,
                ts: Date.now(),
              });
            }

            this.emitEvent({
              type: 'tool-call-started',
              waypointId: waypoint.id,
              callId,
              tool: call.function.name,
              args,
              ts: Date.now(),
            });

            // LAZY CHECKPOINT — just before dispatching a mutating tool,
            // ensure a checkpoint exists. Pure-conversational waypoints
            // never reach this branch; read-only tools (file-read, git-log)
            // skip it via mayMutate=false. Only the first mutating call in
            // a waypoint actually pays the git tax.
            if (this.config.registry.mayMutate(call.function.name, args)) {
              const ensured = await ensureCheckpoint();
              if (!ensured.ok) {
                const cpErr = `checkpoint creation failed: ${ensured.error}`;
                this.emitEvent({
                  type: 'tool-call-completed',
                  waypointId: waypoint.id,
                  callId,
                  result: `ERROR: ${cpErr}`,
                  ok: false,
                  ts: Date.now(),
                });
                history.push({
                  role: 'tool',
                  content: `ERROR: ${cpErr}. Cannot safely run ${call.function.name} without a rollback point.`,
                  toolCallId: call.id,
                });
                continue;
              }
            }

            const result = await this.config.registry.dispatch(call.function.name, args, {
              cwd: this.config.cwd,
            });
            this.emitEvent({
              type: 'tool-call-completed',
              waypointId: waypoint.id,
              callId,
              result: result.ok ? result.value : result.error,
              ok: result.ok,
              ts: Date.now(),
            });
            history.push({
              role: 'tool',
              content: result.ok ? result.value : `ERROR: ${result.error}`,
              toolCallId: call.id,
            });

            // SELF-MONITOR HOOK — fires every SELF_MONITOR_INTERVAL tool
            // calls. Injects a brief observation nudge into the conversation
            // as a user message (NOT an abort) so the agent can notice its
            // own patterns mid-waypoint and self-correct before burning the
            // rest of its iteration budget. Closes the "reflection is
            // triggered, not continuous" gap: self-awareness now runs during
            // wakeful execution, not only in the dream phase.
            toolCallCount += 1;
            if (toolCallCount % SELF_MONITOR_INTERVAL === 0) {
              const observation =
                `[self-monitor] You've made ${toolCallCount} tool calls so far on this ` +
                `waypoint. Briefly check yourself before continuing: am I repeating ` +
                `the same action expecting a different result? Did I misread the goal ` +
                `or skip a constraint? Is there a simpler path I'm overlooking? ` +
                `Resume your work — this is a nudge, not an interruption.`;
              history.push({ role: 'user', content: observation });
              this.emitEvent({
                type: 'self-monitor',
                waypointId: waypoint.id,
                toolCallCount,
                message: observation,
                ts: Date.now(),
              });
            }
          }
          continue;
        }

        consecutiveTextOnly += 1;
        lastAssistantContent = completion.content;
        textOnlyTurns.push(completion.content);
        if (completion.content) {
          this.emitEvent({
            type: 'assistant-message',
            waypointId: waypoint.id,
            content: completion.content,
            ts: Date.now(),
          });
        }
        if (completion.content.trim().toUpperCase() === 'DONE') {
          break;
        }
        history.push({ role: 'assistant', content: completion.content });

        // If the agent returns plain text without tool calls for multiple
        // consecutive turns, the goal is conversational rather than a code
        // task (e.g. "hi", "what can you do?"). Stop the loop so we don't
        // burn the entire iteration budget on echo-chamber replies.
        //
        // Threshold depends on whether the pre-dispatch classifier hinted
        // this input looks conversational (no action verb):
        //   - conversationalHint = true → 1 text reply ends the waypoint.
        //     This honors the engineer prompt's CONVERSATION CASE promise:
        //     "reply once and stop". A person doesn't need three "please
        //     give me a task" nudges to handle "hi".
        //   - conversationalHint = false → 3 text replies (the original
        //     threshold). A legitimate "ask one clarifying question → receive
        //     user reply → start working" flow consumes two text-only turns
        //     before the first tool call; killing at 2 would mark every
        //     valid clarification as abandoned.
        const textOnlyThreshold = conversationalHint ? 1 : 3;
        if (consecutiveTextOnly >= textOnlyThreshold) {
          conversationalStop = true;
          break;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const interrupted = err instanceof InterruptedError;

      // Graceful degradation: ANY error thrown during the LLM↔tool loop
      // (AbortError from fetch timeout, LLMError 5xx, TypeError from a
      // severed network socket, RejectedError from the approval gate, etc.)
      // is converted to a waypoint failure — never allowed to bubble up and
      // crash the process. The voyage layer decides whether to continue,
      // idle, or stop based on the RunWaypointResult, not by catching throws.
      //
      // interrupted keeps its dedicated waypoint-rolled-back event so the TUI
      // can distinguish "user pressed Ctrl+C" from "LLM blew up".
      if (cp.current !== null) {
        await rollbackTo({
          cwd: this.config.cwd,
          sha: cp.current.sha,
          allowedShas: Array.from(this.state.allowedShas),
        });
      }
      this.pendingApprovals.delete(waypoint.id);
      const failed = markFailure(active, reason, iterationsUsed);
      await this.trace(failed, cp.current?.sha ?? null, null);

      if (interrupted) {
        this.emitEvent({
          type: 'waypoint-rolled-back',
          waypointId: waypoint.id,
          reason,
          iterationsUsed,
          ts: Date.now(),
        });
      } else {
        this.emitEvent({
          type: 'waypoint-failed',
          waypointId: waypoint.id,
          error: reason,
          ts: Date.now(),
        });
      }

      return {
        waypoint: failed,
        outcome: 'failure',
        ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
        failReason: reason,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // Early termination — agent produced 3+ consecutive non-tool-calling
    // responses. This means the LLM is stuck in a text-only loop (echo
    // chamber, conversational drift, or inability to formulate a tool plan).
    // Return a clear failure instead of burning through maxIterations.
    if (conversationalStop) {
      const textOnlyThreshold = conversationalHint ? 1 : 3;
      const reason =
        `conversational stop: agent produced ${consecutiveTextOnly} consecutive ` +
        `non-tool-calling responses (threshold: ${textOnlyThreshold}) without reaching DONE — ` +
        `the LLM is stuck in a text-only loop and cannot make further progress. ` +
        `Last reply: "${lastAssistantContent.slice(0, 200)}"`;

      // PRESERVATION — before the irreversible rollback, salvage any
      // consecutive-text-only turn whose content exceeds 500 chars. These
      // are likely diagnostic or reflective outputs (e.g. wp_mrs855ke007)
      // that warrant retention rather than silent loss. We write each to
      // `.odysseus/memory/dreams.md` with source='reflect' and
      // related=waypointId so they survive the early-stop rollback and
      // remain available for future dreaming/consolidation. Failures here
      // are non-fatal: a write error must NOT block the rollback below,
      // which is what keeps the workspace clean for the next voyage.
      for (const turn of textOnlyTurns) {
        if (turn.length > 500) {
          try {
            await writeMemory(this.memoryRoot(), {
              category: 'dreams',
              title: `reflective output from ${waypoint.id}`,
              source: 'reflect',
              body: turn,
              relatedWaypointId: waypoint.id,
            });
          } catch {
            // Swallow — preservation is best-effort. The rollback below
            // is the trust-boundary operation and must proceed regardless.
          }
        }
      }

      const abandoned = markAbandoned(active, reason);
      if (cp.current !== null) {
        await rollbackTo({
          cwd: this.config.cwd,
          sha: cp.current.sha,
          allowedShas: Array.from(this.state.allowedShas),
        });
      }
      await this.trace(abandoned, cp.current?.sha ?? null, null);
      this.emitEvent({
        type: 'waypoint-rolled-back',
        waypointId: waypoint.id,
        reason,
        iterationsUsed,
        ts: Date.now(),
      });
      return {
        waypoint: abandoned,
        outcome: 'abandoned',
        ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
        failReason: reason,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // If the loop exited without DONE (only reachable when a strategy sets
    // maxIterations — the default engineer strategy does not). The
    // orchestrator must never report success without an explicit DONE.
    const reachedDone = lastAssistantContent.trim().toUpperCase() === 'DONE';
    if (!reachedDone) {
      const failReason =
        maxIter !== undefined
          ? `hit maxIterations (${maxIter}) without DONE — agent did not converge`
          : 'loop exited without DONE and without an explicit stop — this should be unreachable for engineer strategy';
      const failed = markFailure(active, failReason, iterationsUsed);
      await this.trace(failed, cp.current?.sha ?? null, null);
      this.emitEvent({
        type: 'waypoint-failed',
        waypointId: waypoint.id,
        error: failReason,
        ts: Date.now(),
      });
      return {
        waypoint: failed,
        outcome: 'failure',
        ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
        failReason,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // VERIFY — hard gate, no LLM confidence can bypass
    this.emitEvent({
      type: 'verify-started',
      waypointId: waypoint.id,
      iteration: iterationsUsed,
      ts: Date.now(),
    });
    const verify = await runVerify({
      cwd: this.config.cwd,
      layers: this.config.verifyLayers,
    });
    this.emitEvent({
      type: 'verify-completed',
      waypointId: waypoint.id,
      iteration: iterationsUsed,
      passed: verify.passed,
      ...(verify.detail !== undefined ? { detail: verify.detail } : {}),
      ts: Date.now(),
    });

    if (verify.passed) {
      // APPROVAL GATE — when autoApprove is disabled (typically TTY context),
      // wait for a human to approve the waypoint before the irreversible
      // commit. InterruptedError/RejectedError trigger rollback + failure
      // return below; both leave the workspace clean for the next voyage.
      if (!this.autoApprove) {
        this.emitEvent({
          type: 'waypoint-awaiting-approval',
          waypointId: waypoint.id,
          iteration: iterationsUsed,
          ts: Date.now(),
        });
        try {
          await this.waitForApproval(waypoint.id);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const interrupted = err instanceof InterruptedError;
          if (cp.current !== null) {
            await rollbackTo({
              cwd: this.config.cwd,
              sha: cp.current.sha,
              allowedShas: Array.from(this.state.allowedShas),
            });
          }
          this.pendingApprovals.delete(waypoint.id);
          const failed = markFailure(active, reason, iterationsUsed);
          await this.trace(failed, cp.current?.sha ?? null, null);
          if (interrupted) {
            this.emitEvent({
              type: 'waypoint-rolled-back',
              waypointId: waypoint.id,
              reason,
              iterationsUsed,
              ts: Date.now(),
            });
          } else {
            this.emitEvent({
              type: 'waypoint-failed',
              waypointId: waypoint.id,
              error: reason,
              ts: Date.now(),
            });
          }
          return {
            waypoint: failed,
            outcome: 'failure',
            ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
            failReason: reason,
            iterationsUsed,
            tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
          };
        }
      }

      const commit = await this.commitWaypoint(waypoint.id);
      if (!commit.ok) {
        const failed = markFailure(
          active,
          `verify passed but commit failed: ${commit.error}`,
          iterationsUsed
        );
        await this.trace(failed, cp.current?.sha ?? null, null);
        this.emitEvent({
          type: 'waypoint-failed',
          waypointId: waypoint.id,
          error: `commit failed: ${commit.error}`,
          ts: Date.now(),
        });
        return {
          waypoint: failed,
          outcome: 'failure',
          ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
          ...(failed.failureReason !== undefined
            ? { failReason: failed.failureReason }
            : {}),
          iterationsUsed,
          tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
        };
      }
      const succeeded = markSuccess(active, commit.sha, iterationsUsed);
      markCompleted(waypoint.goal, commit.sha);
      await this.trace(succeeded, cp.current?.sha ?? null, commit.sha);
      this.emitEvent({
        type: 'waypoint-committed',
        waypointId: waypoint.id,
        sha: commit.sha,
        iterationsUsed,
        ts: Date.now(),
      });
      return {
        waypoint: succeeded,
        outcome: 'success',
        checkpointSha: commit.sha,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // VERIFY FAILED — rollback (if a checkpoint exists). If the agent
    // never made a mutating tool call, checkpoint is still null; the
    // working tree wasn't touched by this waypoint, so there is nothing
    // to roll back. The verify failure is still reported as a waypoint
    // failure — pre-existing breakage in the repo doesn't get a free pass.
    let failReason = verify.detail ?? 'verify failed';
    if (cp.current !== null) {
      const rollback = await rollbackTo({
        cwd: this.config.cwd,
        sha: cp.current.sha,
        allowedShas: Array.from(this.state.allowedShas),
      });
      if (!rollback.ok) {
        failReason = `verify failed AND rollback failed: ${rollback.error}. Original: ${failReason}`;
      }
    }
    if (lastAssistantContent && failReason.includes('syntax')) {
      failReason = `${failReason}\nLast assistant message: ${lastAssistantContent.slice(0, 200)}`;
    }
    const failed = markFailure(active, failReason, iterationsUsed);
    await this.trace(failed, cp.current?.sha ?? null, null);
    this.emitEvent({
      type: 'waypoint-rolled-back',
      waypointId: waypoint.id,
      reason: failReason,
      iterationsUsed,
      ts: Date.now(),
    });
    return {
      waypoint: failed,
      outcome: 'failure',
      ...(cp.current?.sha !== undefined ? { checkpointSha: cp.current.sha } : {}),
      failReason,
      iterationsUsed,
      tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
    };
  }

  // ─── Consumer → Orchestrator command surface ───────────────────────────

  /**
   * Approve the pending waypoint — resolves the `waitForApproval` promise.
   * No-op if there is no pending approval for `waypointId` (idempotent).
   */
  approve(waypointId: string): void {
    const pending = this.pendingApprovals.get(waypointId);
    if (!pending) return;
    this.pendingApprovals.delete(waypointId);
    pending.resolve();
  }

  /**
   * Reject the pending waypoint — rejects `waitForApproval` with
   * `RejectedError`, which unwinds the loop and triggers rollback.
   */
  reject(waypointId: string, reason: string): void {
    const pending = this.pendingApprovals.get(waypointId);
    if (!pending) return;
    this.pendingApprovals.delete(waypointId);
    pending.reject(new RejectedError(waypointId, reason));
  }

  /**
   * Queue a user message to be drained into the LLM history at the start of
   * the next iteration. Useful for "steer mid-voyage" UX without restart.
   */
  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    this.injectedMessages.push(trimmed);
  }

  /**
   * Request interruption. Sets a flag checked at iteration boundaries and
   * rejects any pending approval. `runWaypoint` unwinds on its next chance.
   */
  interrupt(reason = 'user requested'): void {
    this.interrupted = true;
    this.rejectAllPending(new InterruptedError(reason));
  }

  /**
   * Read the current brain state. Observers (TUI) use this to render the
   * status bar without subscribing to events.
   */
  getBrainState(): BrainState {
    return this.brainState;
  }

  /**
   * Voyage loop — the agent's self-evolution mechanism.
   *
   * Unlike a single `runWaypoint` (one task, one waypoint), a voyage is a
   * continuous sequence:
   *
   *   wakeful (run waypoint) → dreaming (free-association) →
   *   reflecting (consolidated into memory/backlog) → wakeful (next item)
   *
   * The voyage terminates when:
   *   - The backlog is empty after a dreaming phase (nothing left to do)
   *   - `interrupt()` is called
   *   - `maxWaypoints` is reached (safety valve)
   *
   * If `seedGoal` is provided, it's enqueued as a user-origin item before
   * the loop starts. Otherwise the loop drains whatever is already in the
   * backlog (e.g. items left from a previous voyage or seeded by tests).
   *
   * This method is the *only* entry point for autonomous operation.
   * `runWaypoint` remains available for tests and one-shot CLI use.
   */
  async runVoyage(input?: {
    seedGoal?: string;
    maxWaypoints?: number;
  }): Promise<RunVoyageResult> {
    const voyageId = `voy_${randomBytes(6).toString('hex')}`;
    const maxWaypoints = input?.maxWaypoints ?? 10;

    this.emitEvent({
      type: 'voyage-started',
      voyageId,
      prompt: input?.seedGoal ?? '(drain backlog)',
      ts: Date.now(),
    });

    if (input?.seedGoal && input.seedGoal.trim().length > 0) {
      await enqueueBacklog(this.memoryRoot(), input.seedGoal.trim(), 'user');
    }

    const waypoints: RunWaypointResult[] = [];
    let dreamCount = 0;
    let lastWaypointId: string | null = null;

    try {
      for (let i = 0; i < maxWaypoints; i++) {
        if (this.interrupted) {
          throw new InterruptedError('voyage interrupted before next waypoint');
        }

        const next = await peekBacklog(this.memoryRoot());
        if (next === null) {
          // Nothing to do — emit idle and stop. The user can inject a new
          // goal via injectMessage() or start a fresh voyage.
          this.emitEvent({
            type: 'voyage-idle',
            voyageId,
            lastWaypointId,
            backlogSize: 0,
            ts: Date.now(),
          });
          break;
        }

        const dequeued = await dequeueBacklog(this.memoryRoot());
        if (dequeued === null) break; // race: another consumer drained it

        this.setBrainState('wakeful', `starting waypoint for: ${dequeued.goal.slice(0, 60)}`);
        const result = await this.runWaypoint({
          goal: dequeued.goal,
          ...(dequeued.sourceWaypointId !== undefined
            ? { parentWaypointId: dequeued.sourceWaypointId }
            : {}),
        });
        waypoints.push(result);
        lastWaypointId = result.waypoint.id;

        if (this.interrupted) {
          throw new InterruptedError('voyage interrupted before dreaming');
        }

        // Dreaming phase — produces backlog + memory items for the next
        // iteration. Skipped if interrupt landed during the waypoint.
        this.setBrainState('dreaming', 'voyage dreaming phase');
        const dreamResult = await this.runDreamingPhase(voyageId);
        if (dreamResult.backlogItemsAdded > 0 || dreamResult.memoryEntriesAdded > 0) {
          dreamCount += 1;
        }

        // User may have interrupted during the dreaming phase. Check before
        // deciding whether to idle or to start another iteration — an
        // interrupt must take precedence over a natural idle.
        if (this.interrupted) {
          throw new InterruptedError('voyage interrupted during dreaming');
        }

        // Back to wakeful for the next iteration (or to await user input).
        const backlogSize = await sizeBacklog(this.memoryRoot());
        if (backlogSize === 0) {
          this.emitEvent({
            type: 'voyage-idle',
            voyageId,
            lastWaypointId,
            backlogSize: 0,
            ts: Date.now(),
          });
          break;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const interrupted = err instanceof InterruptedError;
      if (interrupted) {
        this.emitEvent({
          type: 'voyage-interrupted',
          voyageId,
          reason,
          ts: Date.now(),
        });
        this.setBrainState('idle', 'voyage interrupted');
        return {
          voyageId,
          waypoints,
          outcome: 'interrupted',
          reason,
          dreamCount,
        };
      }
      throw err;
    }

    this.emitEvent({
      type: 'voyage-completed',
      voyageId,
      ts: Date.now(),
    });
    this.setBrainState('idle', 'voyage completed');
    return {
      voyageId,
      waypoints,
      outcome: 'completed',
      dreamCount,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Root directory for memory + backlog files. Colocated with the trace
   * under `.odysseus/` so a single recursive copy captures the full
   * brain state of the agent.
   */
  private memoryRoot(): string {
    return dirname(this.config.tracePath);
  }

  /**
   * Transition brain state with validation + event emission.
   *
   * Transitions are constrained by ALLOWED_TRANSITIONS — illegal jumps
   * throw (and are caught by tests). The exception is the initial idle→wakeful
   * transition from a fresh orchestrator, which is always allowed.
   */
  private setBrainState(to: BrainState, reason: string): void {
    const from = this.brainState;
    if (from === to) return;
    if (!canTransitionTo(from, to)) {
      // Tolerate illegal transitions in the spike — log via event but
      // don't throw. Production-grade would assert. The state still moves
      // so the next phase can proceed.
      void 0;
    }
    this.brainState = to;
    const transition: BrainStateTransition = { from, to, reason, ts: Date.now() };
    this.emitEvent({
      type: 'brain-state-changed',
      from: transition.from,
      to: transition.to,
      reason: transition.reason,
      ts: transition.ts,
    });
  }

  /**
   * Run a single dreaming phase. Reads trace + memory snapshot, calls the
   * dreamer, emits dream-completed. Failures are non-fatal — a bad dream
   * shouldn't sink the voyage.
   */
  private async runDreamingPhase(voyageId: string): Promise<{
    backlogItemsAdded: number;
    memoryEntriesAdded: number;
  }> {
    const start = Date.now();
    let backlogItemsAdded = 0;
    let memoryEntriesAdded = 0;
    let addedBacklogItems: Array<{ id: string; goal: string; priority: number }> = [];
    let addedMemoryEntries: Array<{ id: string; category: MemoryCategory; title: string }> = [];
    let parseOk = true;

    try {
      const recentTrace = await readTrace(this.config.tracePath);
      const memorySnapshot = await this.readMemorySnapshot();
      const result = await dream({
        rootDir: this.memoryRoot(),
        provider: this.config.provider,
        recentTrace,
        memorySnapshot,
      });
      backlogItemsAdded = result.backlogItemsAdded;
      memoryEntriesAdded = result.memoryEntriesAdded;
      addedBacklogItems = [...result.addedBacklogItems];
      addedMemoryEntries = [...result.addedMemoryEntries];
      parseOk = result.parseOk;
    } catch {
      // Dreamer threw — leave counts at 0 and proceed to emit dream-completed.
      parseOk = false;
    }

    this.emitEvent({
      type: 'dream-completed',
      voyageId,
      backlogItemsAdded,
      memoryEntriesAdded,
      durationMs: Date.now() - start,
      ts: Date.now(),
    });

    // Emit per-item events so the TUI can show "added: <goal>" in real time.
    for (const item of addedBacklogItems) {
      this.emitEvent({
        type: 'backlog-item-added',
        itemId: item.id,
        goal: item.goal,
        origin: 'dream',
        priority: item.priority,
        ts: Date.now(),
      });
    }

    // Aggregate memory writes by category for a single memory-consolidated
    // event per category. Keeps the event stream readable.
    const byCategory = new Map<MemoryCategory, number>();
    for (const entry of addedMemoryEntries) {
      const current = byCategory.get(entry.category) ?? 0;
      byCategory.set(entry.category, current + 1);
    }
    for (const [category, count] of byCategory) {
      // bytesWritten is approximate — we don't have it from the dreamer.
      // The TUI uses entryCount as the meaningful metric.
      this.emitEvent({
        type: 'memory-consolidated',
        category,
        entryCount: count,
        bytesWritten: 0,
        ts: Date.now(),
      });
    }

    // Reflecting + consolidating happen implicitly inside the dreamer
    // (it writes memory + backlog). Emit the state transitions for
    // observability even though they're instantaneous.
    if (parseOk) {
      this.setBrainState('reflecting', 'post-dream reflection');
      this.setBrainState('consolidating', 'persisting memory + backlog');
    }
    return { backlogItemsAdded, memoryEntriesAdded };
  }

  private async readMemorySnapshot(): Promise<
    Array<{ category: MemoryCategory; entries: MemoryEntry[] }>
  > {
    const categories: MemoryCategory[] = ['patterns', 'lessons', 'preferences', 'dreams'];
    const snapshot: Array<{ category: MemoryCategory; entries: MemoryEntry[] }> = [];
    for (const category of categories) {
      const entries = await readMemory(this.memoryRoot(), category);
      snapshot.push({ category, entries });
    }
    return snapshot;
  }

  private waitForApproval(waypointId: string): Promise<void> {
    if (this.interrupted) {
      return Promise.reject(new InterruptedError('interrupted before awaiting approval'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingApprovals.set(waypointId, { resolve, reject });
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(id);
      pending.reject(err);
    }
  }

  private emitEvent(event: OrchestratorEvent): boolean {
    return super.emit('event', event);
  }

  private parseToolArgs(call: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async commitWaypoint(
    waypointId: string
  ): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
    const add = await execFileNoThrow('git', ['add', '-A'], { cwd: this.config.cwd });
    if (add.exitCode !== 0) return { ok: false, error: add.stderr };

    const diff = await execFileNoThrow('git', ['diff', '--cached', '--quiet'], {
      cwd: this.config.cwd,
    });
    const args = ['commit', '-m', `waypoint/${waypointId}-ok`];
    if (diff.exitCode === 0) {
      args.push('--allow-empty');
    }
    const commit = await execFileNoThrow('git', args, { cwd: this.config.cwd });
    if (commit.exitCode !== 0) return { ok: false, error: commit.stderr };

    const sha = await execFileNoThrow('git', ['rev-parse', 'HEAD'], {
      cwd: this.config.cwd,
    });
    if (sha.exitCode !== 0) return { ok: false, error: sha.stderr };
    return { ok: true, sha: sha.stdout.trim() };
  }

  private async trace(
    waypoint: Waypoint,
    checkpointSha: string | null,
    successSha: string | null
  ): Promise<void> {
    await mkdir(dirname(this.config.tracePath), { recursive: true });
    await appendTrace(this.config.tracePath, {
      waypoint_id: waypoint.id,
      goal: waypoint.goal,
      strategy: waypoint.strategy,
      parent: waypoint.parentWaypointId ?? null,
      outcome:
        waypoint.status === 'success'
          ? 'success'
          : waypoint.status === 'abandoned'
            ? 'abandoned'
            : 'failure',
      checkpoint_sha: checkpointSha,
      iterations_used: waypoint.iterationsUsed,
      tokens_consumed: { input: this.state.totalInput, output: this.state.totalOutput },
      verify_result: {},
      fail_reason: waypoint.failureReason ?? null,
      diff_summary: successSha ? `committed as ${successSha}` : null,
    });
  }
}
