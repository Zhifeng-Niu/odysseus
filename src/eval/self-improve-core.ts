/**
 * M2 RSI runner 核心 — 自改一圈的留优汰劣状态机（依赖全注入，可直测）。
 *
 * 一圈的顺序契约（测试按此排序 mock）：measure(before) → runWaypoint →
 * changedFiles → [控制面守卫] → measure(after) → verdict。
 *
 * verdict 语义：
 *   improved                delta > 0 → 保留（checkpoint 提交已在）
 *   neutral / worse         delta ≤ 0 → revertToCheckpoint（保住历史最优基线）
 *   control-plane-rejected  diff 触及 orchestrator → 无论 fitness 多高强制回滚
 *   failure                 航点自身失败 → 保险性再回滚（waypoint 已自回滚，
 *                           重复调用是防御性的 no-op）
 */
import { guardControlPlane } from './control-plane.js';

export interface WaypointOutcomeLike {
  outcome: 'success' | 'failure' | 'abandoned';
  iterationsUsed: number;
  failReason?: string;
}

export interface SelfImproveDeps {
  runWaypoint(goal: string): Promise<WaypointOutcomeLike>;
  changedFilesSinceCheckpoint(): Promise<readonly string[]>;
  revertToCheckpoint(): Promise<void>;
  measure(): Promise<number>;
}

export type SelfImproveVerdict =
  | 'improved'
  | 'neutral'
  | 'worse'
  | 'failure'
  | 'control-plane-rejected';

export interface SelfImproveCycleResult {
  readonly verdict: SelfImproveVerdict;
  readonly fitnessBefore: number;
  readonly fitnessAfter?: number;
  readonly delta?: number;
  readonly changedFiles: readonly string[];
  readonly violations?: readonly string[];
}

export interface CycleOptions {
  /** 默认 true——控制面守卫是 RSI 的最后一道闸，只在显式关闭时跳过。 */
  readonly controlPlane?: boolean;
}

export async function runSelfImprovementCycle(
  goal: string,
  deps: SelfImproveDeps,
  options: CycleOptions = {}
): Promise<SelfImproveCycleResult> {
  const fitnessBefore = await deps.measure();
  const waypoint = await deps.runWaypoint(goal);
  const changedFiles = await deps.changedFilesSinceCheckpoint();

  if (waypoint.outcome !== 'success') {
    // 航点已自回滚；保险性再调用一次（幂等），把「确定没有遗留变更」变成契约。
    await deps.revertToCheckpoint();
    return {
      verdict: 'failure',
      fitnessBefore,
      fitnessAfter: fitnessBefore,
      changedFiles: [],
    };
  }

  if (options.controlPlane !== false) {
    const gate = guardControlPlane(changedFiles);
    if (gate.blocked) {
      await deps.revertToCheckpoint();
      return {
        verdict: 'control-plane-rejected',
        fitnessBefore,
        fitnessAfter: undefined,
        changedFiles,
        violations: gate.violations,
      };
    }
  }

  const fitnessAfter = await deps.measure();
  const delta = fitnessAfter - fitnessBefore;

  if (delta > 0) {
    return {
      verdict: 'improved',
      delta,
      fitnessBefore,
      fitnessAfter,
      changedFiles,
    };
  }

  // neutral/worse：真实航点已提交成功——手动回退，保住历史最优基线。
  await deps.revertToCheckpoint();
  return {
    verdict: delta === 0 ? 'neutral' : 'worse',
    delta,
    fitnessBefore,
    fitnessAfter,
    changedFiles,
  };
}
