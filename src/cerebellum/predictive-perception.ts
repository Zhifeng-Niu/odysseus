/**
 * M4 predictive perception 最小版 — recurring failure patterns surface as
 * PROACTIVE work instead of waiting to hurt again.
 *
 * Signal (v0): TypeScript error codes in verify details — the dominant,
 * mechanically extractable failure class for a coding agent. When stored
 * lessons sharing one signature cross PREDICTIVE_THRESHOLD, exactly one
 * 'perception'-origin backlog item is enqueued (edge-triggered on the
 * crossing count: hit 3 fires, hit 4 doesn't — no spam).
 *
 * The enqueued goal asks the agent to investigate the pattern in a future
 * waypoint — closing the loop between recording (P1) and doing something
 * about recurrences without human pattern-spotting.
 */
import { readMemory } from './memory.js';
import { enqueueBacklog } from './backlog-enqueue.js';

export const PREDICTIVE_THRESHOLD = 3;

/** Extract the TS error code from a verify detail ('error TS2322: …'). */
export function extractErrorSignature(detail: string): string | null {
  const match = detail.match(/\berror\s+(TS\d+)/);
  return match?.[1] ?? null;
}

/**
 * Count stored lessons sharing this signature (including the incoming
 * failure); on crossing the threshold, enqueue one perception item.
 * Returns whether an item was enqueued.
 */
export async function maybeEnqueuePredictive(
  memoryRoot: string,
  detail: string,
  goal: string
): Promise<boolean> {
  const signature = extractErrorSignature(detail);
  if (!signature) return false;

  const lessons = await readMemory(memoryRoot, 'lessons');
  const priorHits = lessons.filter((entry) =>
    entry.body.includes(`error ${signature}`)
  ).length;
  const totalHits = priorHits + 1;
  if (totalHits !== PREDICTIVE_THRESHOLD) return false; // edge-trigger only

  await enqueueBacklog(
    memoryRoot,
    `重复失败模式预警：error ${signature} 已出现 ${totalHits} 次（含目标「${goal.slice(0, 60)}」）——` +
      '请检查是否存在系统性问题，并考虑一次性修复该类错误',
    'perception'
  );
  return true;
}
