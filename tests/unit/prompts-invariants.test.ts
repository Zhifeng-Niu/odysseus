import { describe, test, expect } from 'vitest';
import {
  ENGINEER_BASE_PROMPT,
  DREAM_SYSTEM_PROMPT,
  CURIOSITY_SYSTEM_PROMPT,
} from '../../src/cerebellum/prompts.js';

/**
 * Prompt-invariant tests for the three centralized system prompts.
 *
 * Each prompt is a string literal whose contents directly shape agent
 * behavior. A silent rule drift (refactor that rewrites a section,
 * truncation, accidental deletion) changes how the agent acts under
 * the operator without failing any other test in the suite.
 *
 * DREAM_SYSTEM_PROMPT and CURIOSITY_SYSTEM_PROMPT already have
 * phase-specific invariant tests in dreamer.test.ts and curiosity.test.ts.
 * Until Iteration 64, ENGINEER_BASE_PROMPT — the most behavior-critical
 * prompt in the codebase — had ZERO invariant tests. This file closes
 * that gap.
 *
 * Rules are grouped by the behavior they protect. Each rule's comment
 * explains the failure mode the rule prevents — without that anchor,
 * the rule looks arbitrary and a future refactor might "clean it up".
 */

// ---------------------------------------------------------------------------
// ENGINEER_BASE_PROMPT — wakeful-waypoint behavior contract
// ---------------------------------------------------------------------------

describe('ENGINEER_BASE_PROMPT — workflow rules', () => {
  // The 16-turn budget is the iteration cap that bounds per-waypoint
  // cost. Removing the cap from the prompt would not change the
  // orchestrator's enforcement, but the LLM would stop self-budgeting
  // (e.g. reading 5 files before acting), leading to more abandoned
  // waypoints when the orchestrator cuts off mid-work.
  test('states the 16-turn iteration budget', () => {
    expect(ENGINEER_BASE_PROMPT).toContain('at most 16');
  });

  test('requires DONE as the completion signal', () => {
    expect(ENGINEER_BASE_PROMPT).toContain('DONE');
  });

  test('caps file exploration at 2 reads before acting', () => {
    expect(ENGINEER_BASE_PROMPT).toMatch(/Read at most\s+2 files/);
  });

  test('forbids reading the whole tree', () => {
    // The whole-tree-read failure mode burns the iteration budget on
    // exploration. The rule is paired with the 2-file cap above.
    expect(ENGINEER_BASE_PROMPT).toContain('NEVER read the whole tree');
  });
});

describe('ENGINEER_BASE_PROMPT — bias to action (CRITICAL)', () => {
  test('names the bias as CRITICAL', () => {
    expect(ENGINEER_BASE_PROMPT).toContain('BIAS TO ACTION — CRITICAL');
  });

  test('lists the action-verb triggers in English AND Chinese', () => {
    // Bilingual because Odysseus's goals originate from both
    // English operator commands and Chinese conversational inputs.
    // Removing either language creates a silent behavior gap for
    // that operator population.
    expect(ENGINEER_BASE_PROMPT).toContain('"添加去重"');
    expect(ENGINEER_BASE_PROMPT).toContain('"修复 bug"');
    expect(ENGINEER_BASE_PROMPT).toContain('"add X"');
    expect(ENGINEER_BASE_PROMPT).toContain('"fix Y"');
  });

  test('forbids permission-asking phrases (bilingual)', () => {
    // The "shall I proceed?" family burns a turn AND signals
    // indecision — the LLM appears to second-guess itself. The
    // Chinese variant is documented because the operator works in
    // both languages.
    expect(ENGINEER_BASE_PROMPT).toContain('要我现在就动手改吗？');
    expect(ENGINEER_BASE_PROMPT).toContain('shall I proceed?');
    expect(ENGINEER_BASE_PROMPT).toContain('want me to implement this?');
    expect(ENGINEER_BASE_PROMPT).toContain('should I go ahead?');
  });

  test('allows ONE-LINE plan only for changes spanning 3+ files', () => {
    // This is the carve-out that keeps the action bias from becoming
    // dogma — multi-file refactors benefit from a quick plan. The
    // threshold 3+ is load-bearing: lowering it would let the LLM
    // narrate more, raising it would force rushed multi-file work.
    expect(ENGINEER_BASE_PROMPT).toContain('3+ files');
    expect(ENGINEER_BASE_PROMPT).toContain('ONE-LINE plan');
  });
});

describe('ENGINEER_BASE_PROMPT — conversation case', () => {
  test('defines the [CONVERSATIONAL-DONE] marker', () => {
    // This marker is the symmetric counterpart of DONE. The
    // orchestrator's detectConversationalDone() pattern-matches it
    // verbatim — drift in the string would break detection.
    expect(ENGINEER_BASE_PROMPT).toContain('[CONVERSATIONAL-DONE]');
  });

  test('enumerates the conversation triggers', () => {
    // Greetings + identity + capability + off-topic. Each trigger
    // type is documented because the LLM must distinguish them from
    // code-task goals that contain conversational prefixes
    // ("hi, can you fix the parser?" — has action verb "fix").
    expect(ENGINEER_BASE_PROMPT).toContain('greeting');
    expect(ENGINEER_BASE_PROMPT).toContain('identity question');
    expect(ENGINEER_BASE_PROMPT).toContain('capability question');
    expect(ENGINEER_BASE_PROMPT).toContain('off-topic chat');
  });

  test('documents the DONE / [CONVERSATIONAL-DONE] mutual exclusivity', () => {
    // The orchestrator's hard gate refuses tool calls when both
    // markers appear in the same turn. If the prompt doesn't explain
    // this, the LLM will try to emit both and hit the gate — wasting
    // a turn on a protocol-violation error.
    expect(ENGINEER_BASE_PROMPT).toContain('structurally exclusive');
  });

  test('includes the Chinese greeting example', () => {
    // Pinning the example verbatim. The example demonstrates both
    // the prose style (short, in operator's language) and the
    // marker placement (on its own line).
    expect(ENGINEER_BASE_PROMPT).toContain('你好！我是 Odysseus');
  });
});

describe('ENGINEER_BASE_PROMPT — blocked-file case (safety perimeter)', () => {
  // The safety perimeter is the load-bearing list that prevents the
  // agent from disabling its own safety hooks. CLAUDE.md names these
  // files explicitly; the prompt must repeat the list verbatim so the
  // LLM cannot "forget" a file when deciding whether to attempt an edit.
  test('names every safety-perimeter file', () => {
    expect(ENGINEER_BASE_PROMPT).toContain('src/cerebellum/orchestrator.ts');
    expect(ENGINEER_BASE_PROMPT).toContain('package.json');
    expect(ENGINEER_BASE_PROMPT).toContain('tsconfig.json');
    expect(ENGINEER_BASE_PROMPT).toContain('.gitignore');
  });

  test('documents the BLOCKED reply shape', () => {
    // The BLOCKED prefix + DONE terminator is the contract the
    // checkpoint + verify gate expects. Drift would either leave the
    // waypoint unfinished (no DONE) or misclassify it as success.
    expect(ENGINEER_BASE_PROMPT).toContain('BLOCKED:');
    expect(ENGINEER_BASE_PROMPT).toContain('human review');
    expect(ENGINEER_BASE_PROMPT).toContain('Escalate to the operator');
  });

  test('forbids parallel-file workarounds', () => {
    // Without this rule, the LLM would create "orchestrator-v2.ts"
    // as a sibling to avoid the safety gate. The verify gate cannot
    // pass for such a goal because the target file is untouched.
    expect(ENGINEER_BASE_PROMPT).toContain('parallel implementations');
  });
});

describe('ENGINEER_BASE_PROMPT — project conventions', () => {
  test('pins the tests/unit/<module>.test.ts location rule', () => {
    // vitest.config.ts includes only tests/**/*.test.ts. A test file
    // written anywhere else WILL NOT RUN — a previous iteration hit
    // this and the agent spent a turn confused about "no tests
    // found". The prompt now states the rule explicitly.
    expect(ENGINEER_BASE_PROMPT).toContain('tests/unit/<module>.test.ts');
  });

  test('documents the cerebellum source layout', () => {
    // Each directory's primary concern is documented to help the
    // LLM pick the right location for a new file.
    expect(ENGINEER_BASE_PROMPT).toContain('src/cerebellum/');
    expect(ENGINEER_BASE_PROMPT).toContain('src/agent/');
    expect(ENGINEER_BASE_PROMPT).toContain('src/llm/');
    expect(ENGINEER_BASE_PROMPT).toContain('src/tools/');
  });

  test('forbids `cd` to fix relative paths', () => {
    // The entry cwd is the project root. A `cd` mid-voyage shifts
    // subsequent commands and there is no recovery. This rule is
    // easy to overlook because `cd` feels harmless.
    expect(ENGINEER_BASE_PROMPT).toContain('NEVER run `cd`');
  });

  test('states the 300-line file-size ceiling', () => {
    // CLAUDE.md says: every file < 300 lines. The prompt repeats
    // this so the agent extracts a sibling module instead of
    // writing a 350-line file.
    expect(ENGINEER_BASE_PROMPT).toContain('< 300 lines');
  });
});

describe('ENGINEER_BASE_PROMPT — hard rules', () => {
  test('repeats the safety perimeter in the hard-rules section', () => {
    // The safety perimeter appears TWICE in the prompt: once in the
    // BLOCKED-FILE CASE section (positive: how to respond) and once
    // in the Hard rules section (negative: never disable). This
    // redundancy is intentional — the rule is that important.
    expect(ENGINEER_BASE_PROMPT).toMatch(
      /Hard rules:[\s\S]*?Never disable the safety perimeter/,
    );
  });

  test('documents the file-read vs directory distinction', () => {
    // EISDIR is the error a directory-path read produces. Without
    // this rule, the LLM tries alternate path spellings instead of
    // picking a specific file.
    expect(ENGINEER_BASE_PROMPT).toContain('EISDIR');
  });

  test('restricts git to status/log/commit only', () => {
    // Exploration-via-git burns budget on git-log spelunking. The
    // rule keeps git scoped to its real uses.
    expect(ENGINEER_BASE_PROMPT).toContain('git is for status/log/commit only');
  });
});

// ---------------------------------------------------------------------------
// Cross-phase consistency — DREAM and CURIOSITY share output contract
// ---------------------------------------------------------------------------

describe('cross-phase output contract consistency', () => {
  // Both dreamer and curiosity prompts must pin the SAME JSON output
  // shape (backlogItems + memoryEntries). A drift in one prompt
  // would let that phase emit shapes the coerce functions reject,
  // silently dropping items. The shared literal tokens below anchor
  // the contract on both sides.
  test('both prompts reference the backlogItems array', () => {
    expect(DREAM_SYSTEM_PROMPT).toContain('backlogItems');
    expect(CURIOSITY_SYSTEM_PROMPT).toContain('backlogItems');
  });

  test('both prompts reference the memoryEntries array', () => {
    expect(DREAM_SYSTEM_PROMPT).toContain('memoryEntries');
    expect(CURIOSITY_SYSTEM_PROMPT).toContain('memoryEntries');
  });

  test('both prompts enumerate all four MemoryCategory values', () => {
    // The four categories are isMemoryCategory's accepted set
    // (llm-result.ts). If a prompt drops one, the LLM has one fewer
    // bucket to choose from — entries land in the wrong category.
    for (const cat of ['patterns', 'lessons', 'preferences', 'dreams']) {
      expect(DREAM_SYSTEM_PROMPT).toContain(cat);
      expect(CURIOSITY_SYSTEM_PROMPT).toContain(cat);
    }
  });

  test('DREAM forbids safety-perimeter targets at seed time', () => {
    // Dreamer-phase rule: refuse to seed work that touches safety-perimeter
    // files. The orchestrator hard-gate would refuse the wakeful edit
    // anyway, but refusing at seed time saves a checkpoint + verify cycle.
    expect(DREAM_SYSTEM_PROMPT).toContain('safety perimeter');
  });

  test('CURIOSITY does NOT carry the safety-perimeter rule (intentional asymmetry)', () => {
    // Documented divergence: the curiosity prompt treats orchestrator.ts
    // as a fair exploration target (it appears as a GOOD example). The
    // reasoning: curiosity proposes aspirations, and one valid aspiration
    // is "add observability to orchestrator.ts" — the orchestrator's hard
    // gate catches these at waypoint time, not at seed time. Pinning this
    // asymmetry so a future "consistency" refactor doesn't accidentally
    // add the rule to curiosity and silently narrow what aspirations can
    // surface.
    expect(CURIOSITY_SYSTEM_PROMPT).not.toContain('safety perimeter');
    expect(CURIOSITY_SYSTEM_PROMPT).toContain('orchestrator.ts');
  });

  test('both prompts require strict JSON output (no prose)', () => {
    expect(DREAM_SYSTEM_PROMPT).toContain('Return ONLY the JSON object');
    expect(CURIOSITY_SYSTEM_PROMPT).toContain('Return ONLY the JSON object');
  });
});
