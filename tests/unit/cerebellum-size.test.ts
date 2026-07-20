import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Size caps for cerebellum source files.
 *
 * CLAUDE.md says: "Every file < 300 lines (violation triggers self-refactor
 * waypoint)". Several cerebellum modules pre-date this rule and accumulated
 * debt: dreamer.ts was 545 lines at Iteration 34. Iterations 33/35/36 are
 * paying down that debt incrementally (extract prompts → extract dedup
 → extract parser/buildUserPrompt next).
 *
 * The caps below pin *current* progress. If a file grows past its cap, this
 * test fails and forces the author to either:
 *   - reverse the growth (extract a module, compress content), OR
 *   - explicitly raise the cap with a comment explaining why the file's
 *     responsibilities expanded.
 *
 * Cap is NOT the same as the CLAUDE.md target. Caps here are checkpoints
 * on the path to <300. Lower the cap when a file shrinks — do not raise
 * it without a structural reason.
 */

const CEREBELLUM_DIR = join(process.cwd(), 'src', 'cerebellum');

interface FileCap {
  readonly filename: string;
  readonly lineCap: number;
  readonly rationale: string;
}

const FILE_CAPS: readonly FileCap[] = [
  {
    filename: 'dreamer.ts',
    lineCap: 390,
    rationale:
      'Iteration 38 extracted extractJson to extract-json.ts: 402 → 378. ' +
      'Cap at 390 to lock progress. Next extraction target: buildUserPrompt ' +
      '(~95 lines, depends on MemoryCategory/MemoryEntry types).',
  },
  {
    filename: 'prompts.ts',
    lineCap: 220,
    rationale:
      'Iteration 35 centralized ENGINEER_BASE_PROMPT and DREAM_SYSTEM_PROMPT here (190 lines). ' +
      'Cap at 220 leaves headroom for one more prompt extraction without forcing a split.',
  },
  {
    filename: 'dreamer-dedup.ts',
    lineCap: 120,
    rationale:
      'Iteration 36 extracted goal-dedup helpers here (85 lines). Cap at 120 — these are ' +
      'pure functions, should not grow.',
  },
  {
    filename: 'voyage-stats.ts',
    lineCap: 299,
    rationale:
      'Iteration 37 added computeIncrementalTokens (delta from voyage-cumulative). ' +
      'Current 291 lines. Cap at 299 — strictly under CLAUDE.md <300 ceiling. ' +
      'Any growth that crosses 300 must extract a module first (e.g. a ' +
      'voyage-stats-aggregate or voyage-stats-format split).',
  },
  {
    filename: 'extract-json.ts',
    lineCap: 80,
    rationale:
      'Iteration 38 — shared extractJsonObject<T> generic. Current 44 lines. ' +
      'Cap at 80 — pure function, should stay tight. Any larger and it is ' +
      'probably absorbing validation logic that belongs elsewhere.',
  },
];

describe('cerebellum source file size caps', () => {
  for (const cap of FILE_CAPS) {
    describe(`${cap.filename}`, () => {
      test('file exists', () => {
        const stat = statSync(join(CEREBELLUM_DIR, cap.filename));
        expect(stat.isFile()).toBe(true);
      });

      test(`stays under ${cap.lineCap} lines`, () => {
        const content = readFileSync(join(CEREBELLUM_DIR, cap.filename), 'utf8');
        const lines = content.split('\n').length;
        expect(
          lines,
          `${cap.filename} is ${lines} lines (cap ${cap.lineCap}). ${cap.rationale}`
        ).toBeLessThan(cap.lineCap);
      });
    });
  }
});
