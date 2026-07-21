/**
 * Fuzzy goal de-duplication — Levenshtein-distance-based check against
 * recently completed and in-progress goals before seeding.
 *
 * The existing dedup layers in enqueueBacklog (seed-exhausted,
 * retry-exhausted, already-completed) use exact or substring matching.
 * They miss near-duplicates that differ by a few characters — the
 * dreamer can re-seed "add retry to glm" after "add retry logic to glm"
 * shipped, because the substring check in completedGoals.ts requires one
 * string to be a substring of the other.
 *
 * dreamer-dedup.ts already has a Jaccard token-overlap check (threshold
 * 0.5), but that runs inside the dreamer only — it does not guard
 * enqueueBacklog, which is the single chokepoint all origins pass
 * through. This module provides a Levenshtein-based check that
 * enqueueBacklog calls as a fourth dedup gate.
 *
 * Why Levenshtein over Jaccard here:
 *   - Jaccard on tokens loses word-order and small-word sensitivity.
 *     "fix bug in parser" vs "fix bugs in parser" → Jaccard ~0.75 but
 *     these are genuinely the same task.
 *   - Levenshtein on the normalized string catches character-level edits
 *     (typos, plurals, minor rewording) that token overlap misses.
 *   - We use a RATIO threshold (distance / max-length) so it scales with
 *     goal length — a distance of 3 is significant for a 10-char goal
 *     but noise for a 100-char goal.
 *
 * Pure functions, no I/O. Tests in tests/unit/fuzzy-dedup.test.ts.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic Wagner-Fischer dynamic programming algorithm with
 * O(m×n) time and O(min(m,n)) space (two-row optimization).
 *
 * @returns the minimum number of single-character edits (insertions,
 *          deletions, substitutions) needed to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure `a` is the shorter string so the row buffer is smaller.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;
  let prevRow = new Array<number>(aLen + 1);
  let currRow = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i++) {
    prevRow[i] = i;
  }

  for (let j = 1; j <= bLen; j++) {
    currRow[0] = j;
    const bChar = b.charCodeAt(j - 1);
    for (let i = 1; i <= aLen; i++) {
      const cost = a.charCodeAt(i - 1) === bChar ? 0 : 1;
      const deletion = prevRow[i]! + 1;
      const insertion = currRow[i - 1]! + 1;
      const substitution = prevRow[i - 1]! + cost;
      currRow[i] = Math.min(deletion, insertion, substitution);
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[aLen]!;
}

/**
 * Normalize a goal for fuzzy comparison.
 *
 * Mirrors the normalization in dreamer-dedup.ts: lowercase, strip
 * punctuation, collapse whitespace. Kept independent (not imported) so
 * this module has zero coupling to dreamer internals — the two
 * normalization strategies could diverge intentionally.
 */
export function normalizeForFuzzy(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute the Levenshtein similarity ratio between two strings.
 *
 * @returns a value in [0, 1] where 1.0 means identical and 0.0 means
 *          completely different. Ratio = 1 - (distance / maxLength).
 */
export function levenshteinRatio(a: string, b: string): number {
  const normA = normalizeForFuzzy(a);
  const normB = normalizeForFuzzy(b);
  if (normA.length === 0 && normB.length === 0) return 1.0;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(normA, normB);
  return 1 - dist / maxLen;
}

/**
 * Default similarity threshold for considering two goals duplicates.
 *
 * 0.85 means up to 15% character-level edits are tolerated. This is
 * stricter than the dreamer-dedup Jaccard threshold (0.5) because
 * enqueueBacklog is the final gate before a waypoint is seeded — false
 * positives here directly drop work. The dreamer can afford to be loose
 * (it proposes candidates); the enqueue gate must be conservative.
 */
export const FUZZY_DEDUP_THRESHOLD = 0.85;

/**
 * Check whether `newGoal` is a fuzzy duplicate of any goal in
 * `existingGoals`.
 *
 * A match occurs when the Levenshtein similarity ratio between the
 * normalized forms is >= `threshold` (default 0.85).
 *
 * @param newGoal       The candidate goal being enqueued.
 * @param existingGoals Set of goals already completed or in-progress.
 * @param threshold     Similarity ratio threshold (default 0.85).
 * @returns the matching existing goal string, or `null` if no match.
 */
export function findFuzzyDuplicate(
  newGoal: string,
  existingGoals: ReadonlySet<string>,
  threshold: number = FUZZY_DEDUP_THRESHOLD
): string | null {
  const normalized = normalizeForFuzzy(newGoal);
  if (normalized.length === 0) return null;

  for (const existing of existingGoals) {
    const ratio = levenshteinRatio(newGoal, existing);
    if (ratio >= threshold) {
      return existing;
    }
  }
  return null;
}

/**
 * Convenience boolean wrapper around {@link findFuzzyDuplicate}.
 */
export function isFuzzyDuplicate(
  newGoal: string,
  existingGoals: ReadonlySet<string>,
  threshold: number = FUZZY_DEDUP_THRESHOLD
): boolean {
  return findFuzzyDuplicate(newGoal, existingGoals, threshold) !== null;
}
