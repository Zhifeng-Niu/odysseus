import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import { shouldAutoApprove } from '../../src/cerebellum/pending-review-auto.js';

/**
 * pending-review-auto.ts — autonomous-mode policy gate.
 *
 * shouldAutoApprove() is the single function that decides whether
 * dreamer output bypasses pending-review and goes straight to backlog.
 * The env-var parser is deceptively simple but full of string-matching
 * edge cases: the default-ON semantics (absent → true, '' → true)
 * combined with the explicit opt-OUT vocabulary ('0', 'false', 'no')
 * make this a magnet for "I changed one line and now my demo runs
 * autonomously" regressions.
 *
 * Iteration 59 — pins every documented branch and several adjacent
 * inputs that have caught bugs in similar env-var parsers elsewhere.
 */

const ENV_KEY = 'ODYSSEUS_AUTO_APPROVE';
const originalValue = process.env[ENV_KEY];

afterEach(() => {
  // Restore the original env state so tests are hermetic regardless
  // of how the developer's shell is configured.
  if (originalValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalValue;
  }
});

beforeEach(() => {
  // Start each test from a clean slate. The afterEach restoration
  // handles the post-test cleanup.
  delete process.env[ENV_KEY];
});

describe('shouldAutoApprove — default-ON semantics', () => {
  test('returns true when env var is absent', () => {
    delete process.env[ENV_KEY];
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true when env var is empty string', () => {
    process.env[ENV_KEY] = '';
    expect(shouldAutoApprove()).toBe(true);
  });
});

describe('shouldAutoApprove — explicit opt-OUT vocabulary', () => {
  // These three values are the documented opt-OUT surface. The parser
  // matches them literally — if a future refactor adds case-folding
  // or whitespace trimming, behavior changes silently.
  test('returns false for "0"', () => {
    process.env[ENV_KEY] = '0';
    expect(shouldAutoApprove()).toBe(false);
  });

  test('returns false for "false"', () => {
    process.env[ENV_KEY] = 'false';
    expect(shouldAutoApprove()).toBe(false);
  });

  test('returns false for "no"', () => {
    process.env[ENV_KEY] = 'no';
    expect(shouldAutoApprove()).toBe(false);
  });
});

describe('shouldAutoApprove — case-sensitivity', () => {
  // Pinning the current contract: the parser is CASE-SENSITIVE. This
  // is a known asymmetry — operators typing `FALSE` or `NO` get
  // autonomous mode, not supervised. If the parser ever learns to
  // accept case-variants, these tests flag the change.
  test('returns true for "FALSE" (uppercase — case-sensitive parser)', () => {
    process.env[ENV_KEY] = 'FALSE';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "NO" (uppercase)', () => {
    process.env[ENV_KEY] = 'NO';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "False" (title case)', () => {
    process.env[ENV_KEY] = 'False';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "No" (title case)', () => {
    process.env[ENV_KEY] = 'No';
    expect(shouldAutoApprove()).toBe(true);
  });
});

describe('shouldAutoApprove — explicit opt-IN vocabulary', () => {
  // Anything that's not one of {undefined, '', '0', 'false', 'no'} is
  // truthy. The usual opt-IN spellings therefore pass through.
  test('returns true for "1"', () => {
    process.env[ENV_KEY] = '1';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "true"', () => {
    process.env[ENV_KEY] = 'true';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "yes"', () => {
    process.env[ENV_KEY] = 'yes';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "on"', () => {
    process.env[ENV_KEY] = 'on';
    expect(shouldAutoApprove()).toBe(true);
  });
});

describe('shouldAutoApprove — malformed input is opt-IN (fail-open)', () => {
  // The parser is deliberately fail-open: unrecognized strings fall
  // through to "autonomous mode". This matches the operator-opted-in
  // default. Pinning so a future "strict validation" refactor doesn't
  // silently flip the fail direction.
  test('returns true for "maybe"', () => {
    process.env[ENV_KEY] = 'maybe';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "  0  " (whitespace-padding defeats opt-out)', () => {
    // A shell-exported `ODYSSEUS_AUTO_APPROVE="  0  "` does NOT opt
    // out — the parser compares literally. Documented here so the
    // behavior is at least discoverable.
    process.env[ENV_KEY] = '  0  ';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for "false\n" (trailing newline)', () => {
    // Another literal-comparison gotcha. Operators piping from echo
    // without -n have hit this in adjacent env-var parsers.
    process.env[ENV_KEY] = 'false\n';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for arbitrary text', () => {
    process.env[ENV_KEY] = 'banana';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns true for numeric values other than 0', () => {
    for (const v of ['2', '42', '-1', '0.0', '00']) {
      process.env[ENV_KEY] = v;
      // '0.0' and '00' are NOT recognized as falsey — only literal '0'.
      // Pinning this so the parser doesn't drift toward numeric coercion.
      const expected = v === '0' ? false : true;
      expect(shouldAutoApprove(), `for env value ${JSON.stringify(v)}`).toBe(
        expected,
      );
    }
  });
});
