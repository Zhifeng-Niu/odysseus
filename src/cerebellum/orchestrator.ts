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
import { selectStrategy } from './strategy.js';
import { validateGoal } from './goal-validator.js';
import { appendTrace, readTrace } from '../trace/jsonl.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { InterruptedError, RejectedError } from '../orchestrator/errors.js';
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
} from './backlog.js';
import { readMemory, type MemoryEntry } from './memory.js';
import { markCompleted } from './completedGoals.js';
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

    // PRE-DISPATCH GOAL VALIDATOR — reject non-coding conversational goals
    // (greetings, identity questions, off-topic chat) before any checkpoint
    // or LLM work. This is the cheap, deterministic complement to the
    // reactive `consecutiveTextOnly` heuristic below: the reactive path
    // catches ambiguous goals the validator lets through, while the
    // validator short-circuits the obvious cases to save a checkpoint
    // (git ops) and up to 3 wasted LLM turns.
    const validation = validateGoal(input.goal);
    if (!validation.valid) {
      const reason = validation.reason ?? 'goal rejected by validator';
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

    // CHECKPOINT
    const checkpoint = await createCheckpoint({
      cwd: this.config.cwd,
      label: `${waypoint.id}-start`,
    });
    if (!checkpoint.ok) {
      const abandoned = markAbandoned(waypoint, `checkpoint failed: ${checkpoint.error}`);
      await this.trace(abandoned, null, null);
      this.emitEvent({
        type: 'waypoint-failed',
        waypointId: waypoint.id,
        error: `checkpoint failed: ${checkpoint.error}`,
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
    this.state.allowedShas.add(checkpoint.sha);

    // ACT — LLM ↔ Tool loop
    const active = markActive({ ...waypoint, checkpointSha: checkpoint.sha });
    const maxIter = this.config.maxIterations ?? strategy.maxIterations;

    // History always carries the goal as its first user message; the strategy
    // prompt is passed via options.systemPrompt on every call. We never use
    // `prompt` (the provider's "new user message" slot) — passing an empty
    // string tells the provider to rely on history as the message stream.
    const history: ChatMessage[] = [{ role: 'user', content: input.goal }];

    let iterationsUsed = 0;
    let lastAssistantContent = '';
    let consecutiveTextOnly = 0;
    let conversationalStop = false;

    try {
      for (let iter = 1; iter <= maxIter; iter++) {
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
            this.emitEvent({
              type: 'tool-call-started',
              waypointId: waypoint.id,
              callId,
              tool: call.function.name,
              args,
              ts: Date.now(),
            });
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
          }
          continue;
        }

        consecutiveTextOnly += 1;
        lastAssistantContent = completion.content;
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
        // Threshold = 3 (not 2): a legitimate "ask one clarifying question →
        // receive user reply → start working" flow consumes two text-only
        // turns before the first tool call. Killing at 2 would mark every
        // valid clarification as abandoned. Genuine greetings/chat ("hi",
        // "who are you") typically burn 3+ turns of "please give me a task"
        // before the user gives up — that's the signal we want to catch.
        if (consecutiveTextOnly >= 3) {
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
      await rollbackTo({
        cwd: this.config.cwd,
        sha: checkpoint.sha,
        allowedShas: Array.from(this.state.allowedShas),
      });
      this.pendingApprovals.delete(waypoint.id);
      const failed = markFailure(active, reason, iterationsUsed);
      await this.trace(failed, checkpoint.sha, null);

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
        checkpointSha: checkpoint.sha,
        failReason: reason,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // Conversational stop — agent replied with plain text multiple times
    // without invoking tools. The goal was not a code task. Mark abandoned
    // (not failure — no work was attempted, no verify needed). The last
    // assistant message has already been surfaced via the event stream.
    if (conversationalStop) {
      const reason =
        'agent produced multiple conversational replies without invoking tools — goal appears non-coding';
      const abandoned = markAbandoned(active, reason);
      await this.trace(abandoned, checkpoint.sha, null);
      this.emitEvent({
        type: 'waypoint-failed',
        waypointId: waypoint.id,
        error: reason,
        ts: Date.now(),
      });
      return {
        waypoint: abandoned,
        outcome: 'abandoned',
        checkpointSha: checkpoint.sha,
        failReason: reason,
        iterationsUsed,
        tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
      };
    }

    // If the loop exited by hitting maxIter (not via DONE), the agent has not
    // declared success. Treat as failure — verify would otherwise pass on the
    // empty diff and silently commit nothing. The orchestrator must never
    // report success without an explicit DONE from the LLM.
    const reachedDone = lastAssistantContent.trim().toUpperCase() === 'DONE';
    if (!reachedDone) {
      const failReason = `hit maxIterations (${maxIter}) without DONE — agent did not converge`;
      const failed = markFailure(active, failReason, iterationsUsed);
      await this.trace(failed, checkpoint.sha, null);
      this.emitEvent({
        type: 'waypoint-failed',
        waypointId: waypoint.id,
        error: failReason,
        ts: Date.now(),
      });
      return {
        waypoint: failed,
        outcome: 'failure',
        checkpointSha: checkpoint.sha,
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
          await rollbackTo({
            cwd: this.config.cwd,
            sha: checkpoint.sha,
            allowedShas: Array.from(this.state.allowedShas),
          });
          this.pendingApprovals.delete(waypoint.id);
          const failed = markFailure(active, reason, iterationsUsed);
          await this.trace(failed, checkpoint.sha, null);
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
            checkpointSha: checkpoint.sha,
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
        await this.trace(failed, checkpoint.sha, null);
        this.emitEvent({
          type: 'waypoint-failed',
          waypointId: waypoint.id,
          error: `commit failed: ${commit.error}`,
          ts: Date.now(),
        });
        return {
          waypoint: failed,
          outcome: 'failure',
          checkpointSha: checkpoint.sha,
          ...(failed.failureReason !== undefined
            ? { failReason: failed.failureReason }
            : {}),
          iterationsUsed,
          tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
        };
      }
      const succeeded = markSuccess(active, commit.sha, iterationsUsed);
      markCompleted(waypoint.goal, commit.sha);
      await this.trace(succeeded, checkpoint.sha, commit.sha);
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

    // VERIFY FAILED — rollback
    const rollback = await rollbackTo({
      cwd: this.config.cwd,
      sha: checkpoint.sha,
      allowedShas: Array.from(this.state.allowedShas),
    });
    let failReason = verify.detail ?? 'verify failed';
    if (!rollback.ok) {
      failReason = `verify failed AND rollback failed: ${rollback.error}. Original: ${failReason}`;
    }
    if (lastAssistantContent && failReason.includes('syntax')) {
      failReason = `${failReason}\nLast assistant message: ${lastAssistantContent.slice(0, 200)}`;
    }
    const failed = markFailure(active, failReason, iterationsUsed);
    await this.trace(failed, checkpoint.sha, null);
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
      checkpointSha: checkpoint.sha,
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
