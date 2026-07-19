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
import { dirname } from 'node:path';
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
import { appendTrace } from '../trace/jsonl.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { InterruptedError, RejectedError } from '../orchestrator/errors.js';

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
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const interrupted = err instanceof InterruptedError;
      const rejected = err instanceof RejectedError;
      if (interrupted || rejected) {
        // Roll back to checkpoint so the workspace is clean for the next voyage.
        await rollbackTo({
          cwd: this.config.cwd,
          sha: checkpoint.sha,
          allowedShas: Array.from(this.state.allowedShas),
        });
        this.pendingApprovals.delete(waypoint.id);
        const failed = markFailure(active, reason, iterationsUsed);
        await this.trace(failed, checkpoint.sha, null);
        this.emitEvent({
          type: interrupted ? 'waypoint-rolled-back' : 'waypoint-failed',
          waypointId: waypoint.id,
          ...(interrupted ? {} : { error: reason }),
          ...(interrupted ? { reason } : {}),
          iterationsUsed,
          ts: Date.now(),
        } as OrchestratorEvent);
        return {
          waypoint: failed,
          outcome: 'failure',
          checkpointSha: checkpoint.sha,
          failReason: reason,
          iterationsUsed,
          tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
        };
      }
      throw err;
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

  // ─── Internals ─────────────────────────────────────────────────────────

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
