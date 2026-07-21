import type { BacklogOrigin } from '../orchestrator/events.js';
import { isCompleted } from './completedGoals.js';
import { isSeedExhausted } from './seedAttempts.js';
import { recordSkippedEnqueue } from './backlog-registries.js';
import {
  MAX_RETRY_ATTEMPTS,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
} from './retry-counter.js';
import {
  type BacklogItem,
  type EnqueueOptions,
  loadBacklogFile,
  saveBacklogFile,
  generateBacklogId,
  defaultPriorityForOrigin,
} from './backlog.js';

/**
 * Enqueue path for the backlog — extracted from backlog.ts (Iteration 49)
 * because enqueueBacklog had grown to ~110 lines with three pre-flight
 * checks (isSeedExhausted, isRetryExhausted, isCompleted) + dedup +
 * the enqueue audit trail. That block is a self-contained policy
 * module over storage primitives in backlog.ts.
 *
 * Mirrors Iter 42 (planner-policy), Iter 44 (curiosity-prompt), Iter 45
 * (retry-counter), Iter 47 (dreamer-prompt), Iter 48 (self-monitor-patterns):
 * extract a cohesive concern to a sibling file so backlog.ts shrinks
 * toward pure storage + queue ops (dequeue/peek/size/list/remove).
 *
 * The dedup gates exist to prevent the dreamer/reflection loop from
 * endlessly re-enqueueing flaky or already-done work. They are correct
 * for autonomous-origin items (dream, reflect, curiosity, system, plan).
 * User-origin items bypass them — see the comment in enqueueBacklog.
 */

export async function enqueueBacklog(
  rootDir: string,
  goal: string,
  origin: BacklogOrigin,
  options?: EnqueueOptions
): Promise<BacklogItem> {
  const trimmedGoal = goal.trim();
  if (trimmedGoal.length === 0) {
    throw new Error('backlog goal cannot be empty');
  }
  // Iteration 18 — user-origin items bypass every dedup check.
  //
  // The three checks below (isSeedExhausted, isRetryExhausted, isCompleted)
  // exist to prevent the dreamer/reflection loop from endlessly re-enqueueing
  // flaky or already-done work. They are correct for autonomous-origin items
  // (dream, reflect, curiosity, system, plan).
  //
  // But when origin === 'user', the item is an explicit, intentional request
  // from the operator. Silently dropping it because the same string was seen
  // before breaks the agent's most fundamental contract: when a user sends
  // input, the agent MUST respond. Without this bypass, resending "你好" or
  // any prior message causes enqueueBacklog to return a phantom item without
  // writing to the file, peekBacklog returns null on the next tick, and
  // voyage-idle fires immediately — the user sees zero response. From their
  // perspective the agent has died.
  //
  // If the user re-sends the exact same goal, that is itself signal: either
  // the prior response was unsatisfying, or they lost track of state. Either
  // way the agent must produce another waypoint. The dedup machinery stays
  // in place for autonomous origins.
  if (origin === 'user') {
    return enqueueUserOrigin(rootDir, trimmedGoal, options);
  }

  // Block re-seeding when this goal has already been attempted
  // MAX_SEED_ATTEMPTS times regardless of outcome (success/failure/abandon).
  if (isSeedExhausted(trimmedGoal)) {
    recordSkippedEnqueue(trimmedGoal, origin, 'seed-exhausted');
    return {
      id: options?.id ?? generateBacklogId(),
      goal: trimmedGoal,
      origin,
      priority: options?.priority ?? defaultPriorityForOrigin(origin),
      createdAt: options?.createdAt ?? new Date().toISOString(),
      ...(options?.sourceWaypointId !== undefined
        ? { sourceWaypointId: options.sourceWaypointId }
        : {}),
    };
  }
  // Block re-seeding when the per-goal retry counter (tracked in this
  // module) has exceeded MAX_RETRY_ATTEMPTS enqueues.
  if (isRetryExhausted(trimmedGoal)) {
    console.warn(
      `[backlog] blocking re-seed: retry counter exhausted (${getRetryCount(trimmedGoal)}/${MAX_RETRY_ATTEMPTS}) for goal: "${trimmedGoal}"`
    );
    recordSkippedEnqueue(trimmedGoal, origin, 'retry-exhausted');
    return {
      id: options?.id ?? generateBacklogId(),
      goal: trimmedGoal,
      origin,
      priority: options?.priority ?? defaultPriorityForOrigin(origin),
      createdAt: options?.createdAt ?? new Date().toISOString(),
      ...(options?.sourceWaypointId !== undefined
        ? { sourceWaypointId: options.sourceWaypointId }
        : {}),
    };
  }
  // Skip enqueueing when this goal has already been recorded as completed by
  // markCompleted — prevents the voyage loop from re-seeding done work.
  if (isCompleted(trimmedGoal)) {
    recordSkippedEnqueue(trimmedGoal, origin, 'already-completed');
    return {
      id: options?.id ?? generateBacklogId(),
      goal: trimmedGoal,
      origin,
      priority: options?.priority ?? defaultPriorityForOrigin(origin),
      createdAt: options?.createdAt ?? new Date().toISOString(),
      ...(options?.sourceWaypointId !== undefined
        ? { sourceWaypointId: options.sourceWaypointId }
        : {}),
    };
  }
  const file = await loadBacklogFile(rootDir);
  const item: BacklogItem = {
    id: options?.id ?? generateBacklogId(),
    goal: trimmedGoal,
    origin,
    priority: options?.priority ?? defaultPriorityForOrigin(origin),
    createdAt: options?.createdAt ?? new Date().toISOString(),
    ...(options?.sourceWaypointId !== undefined
      ? { sourceWaypointId: options.sourceWaypointId }
      : {}),
  };
  const nextFile = {
    version: 1 as const,
    items: [...file.items, item],
  };
  await saveBacklogFile(rootDir, nextFile);
  // Iteration 24 — increment the retry counter AFTER save succeeds. The
  // original code incremented before save, so a failed save (disk full,
  // permissions) would bump the counter without the item landing in the
  // queue — three such failures and isRetryExhausted would silently block
  // all future enqueues of this goal, permanently freezing the agent on
  // a goal that was never actually queued.
  incrementRetryCounter(trimmedGoal);
  return item;
}

/**
 * User-origin enqueue path — bypasses all dedup checks.
 *
 * See the comment at the top of `enqueueBacklog` for the rationale: the
 * dedup registry is for autonomous-loop protection, not for filtering user
 * input. This helper still increments the retry counter (so the autonomous
 * loops can observe "this goal has been seen N times" via getRetryCount)
 * but always writes to the backlog file.
 *
 * The retry counter increment is informational here, not a gate — a user
 * resending the same input 50 times should still get 50 waypoints. The
 * counter just lets other modules see the activity.
 */
async function enqueueUserOrigin(
  rootDir: string,
  trimmedGoal: string,
  options?: EnqueueOptions
): Promise<BacklogItem> {
  const file = await loadBacklogFile(rootDir);
  const item: BacklogItem = {
    id: options?.id ?? generateBacklogId(),
    goal: trimmedGoal,
    origin: 'user',
    priority: options?.priority ?? defaultPriorityForOrigin('user'),
    createdAt: options?.createdAt ?? new Date().toISOString(),
    ...(options?.sourceWaypointId !== undefined
      ? { sourceWaypointId: options.sourceWaypointId }
      : {}),
  };
  const nextFile = {
    version: 1 as const,
    items: [...file.items, item],
  };
  await saveBacklogFile(rootDir, nextFile);
  // Iteration 24 — increment after save succeeds (see enqueueBacklog fix).
  incrementRetryCounter(trimmedGoal);
  return item;
}
