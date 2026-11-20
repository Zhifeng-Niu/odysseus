/**
 * P1 learning element — the missing 5th component of the learning agent
 * (IBM ai-agent-learning six-component model: critic≈verify, problem
 * generator≈dreamer, performance element≈loop, sensors/actuators≈tools —
 * but experience never became persisted knowledge). This recorder closes
 * the loop: on a TERMINAL waypoint failure it writes a structured lesson
 * (症状/根因/修法方向) into long-term memory (category 'lessons', source
 * 'failure'), which loadLongTermMemoryMarkdown already injects into every
 * subsequent waypoint's system prompt. Experience → persisted knowledge →
 * behavior change.
 *
 * Subscribes to the orchestrator event stream — orchestrator.ts itself is
 * untouched (project rule: its edits require human review). Best-effort by
 * design: registration and writes must never take down a waypoint (same
 * spirit as agent/guards.ts). Dedup via `fp:` fingerprint tags so repeated
 * identical failures do not flood lessons.md.
 */
import { createHash } from 'node:crypto';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { readMemory, writeMemory } from './memory.js';

export interface LessonRecorderHandle {
  detach: () => void;
  /** Resolves when all in-flight lesson writes settle (test determinism). */
  pending: () => Promise<void>;
}

interface EventSource {
  on(type: 'event', handler: (event: OrchestratorEvent) => void): unknown;
  off?(type: 'event', handler: (event: OrchestratorEvent) => void): unknown;
}

/** Symptom excerpt budget — lessons stay scannable, not log dumps. */
const DETAIL_BUDGET = 600;
const GOAL_BUDGET = 60;

export function attachLessonRecorder(
  source: EventSource,
  memoryRoot: string
): LessonRecorderHandle {
  const goals = new Map<string, string>();
  const firstFailures = new Map<string, string>();
  const inflight: Array<Promise<unknown>> = [];

  const track = (task: Promise<unknown>): void => {
    // A failed lesson write must never reject the event stream consumer.
    inflight.push(task.catch(() => undefined));
  };

  const handler = (event: OrchestratorEvent): void => {
    try {
      switch (event.type) {
        case 'waypoint-started':
          goals.set(event.waypointId, event.goal);
          break;
        case 'verify-completed':
          // Keep the FIRST failure detail — later failures in the same
          // waypoint are usually cascades, not new root causes.
          if (
            !event.passed &&
            event.detail !== undefined &&
            !firstFailures.has(event.waypointId)
          ) {
            firstFailures.set(event.waypointId, event.detail);
          }
          break;
        case 'waypoint-rolled-back':
        case 'waypoint-failed': {
          const goal = goals.get(event.waypointId) ?? 'unknown goal';
          const detail =
            firstFailures.get(event.waypointId) ??
            (event.type === 'waypoint-failed' ? event.error : event.reason);
          goals.delete(event.waypointId);
          firstFailures.delete(event.waypointId);
          track(recordLesson(memoryRoot, goal, detail, event.waypointId));
          break;
        }
        default:
          break;
      }
    } catch {
      // Recorder must never break the event-stream consumer chain.
    }
  };

  try {
    source.on('event', handler);
  } catch {
    // Best-effort: a source without event support simply gets no recorder.
    return { detach: () => undefined, pending: () => Promise.resolve() };
  }

  return {
    detach: () => {
      try {
        source.off?.('event', handler);
      } catch {
        // detach must never throw either.
      }
      goals.clear();
      firstFailures.clear();
    },
    pending: () => Promise.all(inflight).then(() => undefined),
  };
}

async function recordLesson(
  memoryRoot: string,
  goal: string,
  detail: string,
  waypointId: string
): Promise<void> {
  const fingerprint = createHash('sha1')
    .update(`${goal}|${normalizeForFingerprint(detail)}`)
    .digest('hex')
    .slice(0, 12);
  const fpTag = `fp:${fingerprint}`;

  const existing = await readMemory(memoryRoot, 'lessons');
  if (existing.some((entry) => entry.tags?.includes(fpTag) === true)) {
    return; // identical failure already recorded — no flood
  }

  const layer = extractLayer(detail);
  const title = `verify失败: ${layer} · ${truncate(goal, GOAL_BUDGET)}`;
  // Bold labels, NOT `## ` headings — splitSections treats any line starting
  // with `## ` as a new entry boundary (see memory-parse.ts), so heading-form
  // bodies would fragment the lesson on read-back.
  const body = [
    '**症状**',
    truncate(detail, DETAIL_BUDGET) || '(无验证输出)',
    '',
    '**根因**',
    rootCauseFor(layer),
    '',
    '**修法方向**',
    fixDirectionFor(layer),
  ].join('\n');

  await writeMemory(memoryRoot, {
    category: 'lessons',
    source: 'failure',
    title,
    body,
    tags: ['autolearn', fpTag],
    relatedWaypointId: waypointId,
  });
}

/** Verify details carry `--- <layer> ---` prefixes (see cerebellum/verify.ts). */
function extractLayer(detail: string): string {
  if (detail.includes('--- syntax ---')) return 'syntax';
  if (detail.includes('--- tests ---')) return 'tests';
  if (detail.includes('--- progress ---')) return 'progress';
  return 'unknown';
}

function rootCauseFor(layer: string): string {
  switch (layer) {
    case 'syntax':
      return '本次改动引入了编译错误（tsc 输出见症状），提交前未通过语法验证层。';
    case 'tests':
      return '改动破坏了既有测试（失败用例输出见症状），提交前未通过测试验证层。';
    case 'progress':
      return 'waypoint 未产生可验证的实际进展（如空提交/无变更），进度验证层先行拒绝。';
    default:
      return '验证失败的具体层未知（无层前缀），需结合症状判断。';
  }
}

function fixDirectionFor(layer: string): string {
  switch (layer) {
    case 'syntax':
      return '按症状中的 tsc 报错逐条修复类型/语法问题；修复后再走验证流程。';
    case 'tests':
      return '先让症状中的失败用例转绿；若属预期行为变化，同步更新测试并说明理由。';
    case 'progress':
      return '确保每个迭代产出真实变更（文件修改/提交内容），避免只声明不落盘。';
    default:
      return '复现失败场景，定位失败层后按对应策略修复。';
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…(截断)`;
}

/**
 * Fingerprint input normalization — the RAW detail still goes into the
 * lesson body (paths are evidence); only the hash sees this. Two steps:
 *  1. temp dirs (macOS /var/folders, *nix /tmp) → <TMPDIR>, so the SAME
 *     failure in a different repo/temp-dir dedups (lesson-loop finding);
 *  2. (line,col) positions → dropped, so error-position drift between
 *     otherwise-identical failures doesn't fork the fingerprint either.
 */
function normalizeForFingerprint(detail: string): string {
  return detail
    .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s:']*/g, '<TMPDIR>')
    .replace(/\(\d+,\d+\)/g, '');
}
