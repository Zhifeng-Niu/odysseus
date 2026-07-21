import { describe, test, expect } from 'vitest';
import {
  compressTranscript,
  type TranscriptEntry,
} from '../../src/cerebellum/transcript-compressor.js';

/**
 * transcript-compressor.ts — per-waypoint transcript compaction
 * (Aspiration 4).
 *
 * compressTranscript turns a list of tool-call records into a compact
 * one-line-per-call summary. Each line follows the shape:
 *
 *     <tool> | <target> → <outcome>
 *
 * Tests cover: empty input, single entry, multi-entry ordering,
 * truncation of long outcomes, multi-line outcome squashing, and
 * field-length edge cases.
 */

describe('compressTranscript', () => {
  test('empty array returns empty string', () => {
    expect(compressTranscript([])).toBe('');
  });

  test('single entry produces one line', () => {
    const entries: TranscriptEntry[] = [
      { tool: 'file-read', target: 'src/foo.ts', outcome: 'ok' },
    ];
    expect(compressTranscript(entries)).toBe('file-read | src/foo.ts → ok');
  });

  test('multiple entries are newline-joined in order', () => {
    const entries: TranscriptEntry[] = [
      { tool: 'file-read', target: 'src/a.ts', outcome: 'read 10 lines' },
      { tool: 'file-edit', target: 'src/a.ts', outcome: 'replaced 1 line' },
      { tool: 'bash', target: 'npm test', outcome: 'all passed' },
    ];
    expect(compressTranscript(entries)).toBe(
      [
        'file-read | src/a.ts → read 10 lines',
        'file-edit | src/a.ts → replaced 1 line',
        'bash | npm test → all passed',
      ].join('\n'),
    );
  });

  test('long outcome is truncated with ellipsis', () => {
    const longOutcome = 'x'.repeat(300);
    const result = compressTranscript([
      { tool: 'bash', target: 'ls', outcome: longOutcome },
    ]);
    const outcomePart = result.split(' → ')[1];
    // Truncated to MAX_OUTCOME_LEN (120): 119 chars + ellipsis.
    expect(outcomePart.length).toBe(120);
    expect(outcomePart.endsWith('…')).toBe(true);
  });

  test('multi-line outcome is squashed to single line', () => {
    const entries: TranscriptEntry[] = [
      {
        tool: 'bash',
        target: 'npm test',
        outcome: 'line one\nline two\nline three',
      },
    ];
    const result = compressTranscript(entries);
    expect(result).toBe('bash | npm test → line one line two line three');
    expect(result.includes('\n')).toBe(false);
  });

  test('tabs and multiple spaces in outcome collapse to single spaces', () => {
    const entries: TranscriptEntry[] = [
      { tool: 'bash', target: 'echo', outcome: 'a\t\tb   c' },
    ];
    expect(compressTranscript(entries)).toBe('bash | echo → a b c');
  });

  test('empty outcome still produces a line with arrow', () => {
    const entries: TranscriptEntry[] = [
      { tool: 'git', target: 'status', outcome: '' },
    ];
    expect(compressTranscript(entries)).toBe('git | status → ');
  });

  test('preserves order with mixed tools', () => {
    const entries: TranscriptEntry[] = [
      { tool: 'file-read', target: 'a', outcome: '1' },
      { tool: 'bash', target: 'b', outcome: '2' },
      { tool: 'file-write', target: 'c', outcome: '3' },
      { tool: 'git', target: 'commit', outcome: '4' },
    ];
    const lines = compressTranscript(entries).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('file-read');
    expect(lines[3]).toContain('git');
  });

  test('outcome exactly at max length is not truncated', () => {
    const exact = 'y'.repeat(120);
    const result = compressTranscript([
      { tool: 'bash', target: 't', outcome: exact },
    ]);
    const outcomePart = result.split(' → ')[1];
    expect(outcomePart).toBe(exact);
    expect(outcomePart.endsWith('…')).toBe(false);
  });

  test('outcome one char over max length is truncated', () => {
    const over = 'z'.repeat(121);
    const result = compressTranscript([
      { tool: 'bash', target: 't', outcome: over },
    ]);
    const outcomePart = result.split(' → ')[1];
    expect(outcomePart.length).toBe(120);
    expect(outcomePart.endsWith('…')).toBe(true);
  });

  test('leading/trailing whitespace in fields is trimmed', () => {
    const entries: TranscriptEntry[] = [
      { tool: '  bash  ', target: '  echo hi  ', outcome: '  hi  ' },
    ];
    expect(compressTranscript(entries)).toBe('bash | echo hi → hi');
  });
});
