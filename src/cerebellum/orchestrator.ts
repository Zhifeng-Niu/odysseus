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

export interface OrchestratorConfig {
  cwd: string;
  provider: LLMProvider;
  registry: ToolRegistry;
  tracePath: string;
  verifyLayers: readonly VerifyLayer[];
  maxIterations?: number;
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

export class CerebellumOrchestrator {
  private readonly state: OrchestratorState = {
    allowedShas: new Set(),
    totalInput: 0,
    totalOutput: 0,
  };

  constructor(private readonly config: OrchestratorConfig) {}

  async runWaypoint(input: RunWaypointInput): Promise<RunWaypointResult> {
    const waypoint = createWaypoint({
      goal: input.goal,
      ...(input.parentWaypointId !== undefined
        ? { parentWaypointId: input.parentWaypointId }
        : {}),
    });
    const strategy = selectStrategy({ goal: input.goal });

    // CHECKPOINT
    const checkpoint = await createCheckpoint({
      cwd: this.config.cwd,
      label: `${waypoint.id}-start`,
    });
    if (!checkpoint.ok) {
      const abandoned = markAbandoned(waypoint, `checkpoint failed: ${checkpoint.error}`);
      await this.trace(abandoned, null, null);
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

    for (let iter = 1; iter <= maxIter; iter++) {
      iterationsUsed = iter;
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
        for (const call of completion.toolCalls) {
          const args = this.parseToolArgs(call);
          const result = await this.config.registry.dispatch(call.function.name, args, {
            cwd: this.config.cwd,
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
      if (completion.content.trim().toUpperCase() === 'DONE') {
        break;
      }
      history.push({ role: 'assistant', content: completion.content });
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
    const verify = await runVerify({
      cwd: this.config.cwd,
      layers: this.config.verifyLayers,
    });

    if (verify.passed) {
      const commit = await this.commitWaypoint(waypoint.id);
      if (!commit.ok) {
        const failed = markFailure(
          active,
          `verify passed but commit failed: ${commit.error}`,
          iterationsUsed
        );
        await this.trace(failed, checkpoint.sha, null);
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
    return {
      waypoint: failed,
      outcome: 'failure',
      checkpointSha: checkpoint.sha,
      failReason,
      iterationsUsed,
      tokensConsumed: { input: this.state.totalInput, output: this.state.totalOutput },
    };
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
