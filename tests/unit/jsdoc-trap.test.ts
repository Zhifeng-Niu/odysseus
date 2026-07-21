import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * Meta-test: JSDoc early-closing trap.
 *
 * The pattern is a line inside a JSDoc block whose content contains the
 * two-character sequence (star immediately followed by slash). That
 * sequence prematurely closes the comment, and TypeScript then parses
 * whatever follows as code, producing confusing syntax errors far from
 * the actual source line.
 *
 * This trap has bitten the codebase twice:
 *
 *   - Iteration 41 (prompts.ts): prompt text mentioned the glob-style
 *     pattern inside what should have been a block comment.
 *   - Iteration 46 (llm-result.ts): module docstring mentioned
 *     Dream-and-Curiosity with the literal close-sequence in between.
 *
 * Both were caught quickly because typecheck ran immediately after the
 * edit. But the trap is easy to re-introduce: any time a JSDoc tries to
 * talk about C-style comment syntax, glob patterns, or regex patterns
 * containing star-then-slash, the bug returns.
 *
 * This test scans every TypeScript file under src and fails if it finds
 * a line matching the trap pattern. The check is conservative: it only
 * flags lines that START with a JSDoc continuation marker (space-star)
 * AND contain the close-sequence followed by non-whitespace content.
 *
 * Adding this test makes the trap impossible to re-introduce silently.
 */

interface TrapFinding {
  readonly file: string;
  readonly line: number;
  readonly line_content: string;
}

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectTypeScriptFiles(path);
      out.push(...nested);
    } else if (entry.isFile() && extname(entry.name) === '.ts') {
      out.push(path);
    }
  }
  return out;
}

/**
 * Match a JSDoc continuation line where the close-comment sequence
 * (star immediately followed by slash) appears before end-of-line AND
 * is followed by non-whitespace content. That trailing content is what
 * TypeScript parses as code — the actual bug.
 *
 * Why require trailing non-whitespace: a line like ` * text *` slash
 * (close-sequence at end-of-line) is the legitimate terminator of a
 * single-line JSDoc that wraps across lines (e.g. `/** foo * bar *`
 * slash). The close-sequence at end-of-line closes the comment cleanly
 * with nothing trailing to mis-parse. Only when non-whitespace content
 * follows the close-sequence does the bug bite.
 *
 * Written as a regex literal so the source text contains escaped-slash
 * (backslash then slash), NOT the literal close-comment sequence. This
 * is exactly the trap the test exists to catch — the test file itself
 * must not trip its own scanner, and a regex literal is code (not a
 * comment), so the escape is safe here.
 */
const TRAP_PATTERN = /^ *\* .*\*\/\s*\S/;

async function scanForTrap(rootDir: string): Promise<TrapFinding[]> {
  const files = await collectTypeScriptFiles(rootDir);
  const findings: TrapFinding[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (TRAP_PATTERN.test(line)) {
        findings.push({
          file: file.replace(`${process.cwd()}/`, ''),
          line: i + 1,
          line_content: line,
        });
      }
    }
  }
  return findings;
}

describe('JSDoc early-closing trap (meta-test)', () => {
  test('no source file contains the close-comment sequence inside a JSDoc continuation line', async () => {
    const findings = await scanForTrap(join(process.cwd(), 'src'));
    if (findings.length > 0) {
      const formatted = findings
        .map((f) => `  ${f.file}:${f.line} → ${f.line_content.trim()}`)
        .join('\n');
      throw new Error(
        `Found ${findings.length} JSDoc trap(s) — a line starting with " *" contains ` +
          `the close-comment sequence before end-of-line, which prematurely closes the comment. ` +
          `TypeScript will then parse the trailing content as code and fail. ` +
          `Rewrite to avoid the literal sequence (e.g. "Dream and Curiosity" ` +
          `instead of "Dream-close-Curiosity").\n\n${formatted}`,
      );
    }
    expect(findings).toEqual([]);
  });

  test('TRAP_PATTERN matches known bug samples (sanity check)', () => {
    // Construct the test samples at runtime to avoid tripping the
    // meta-test on this very file. The close-comment sequence is built
    // from parts so the source text never contains it literally.
    const close = `${'*'}${'/'}`;
    const bugs = [
      ` * This mentions Dream${close}Curiosity in passing.`,
      `  * glob like *.${close} is tricky`,
      ` * See Iter${close}count pattern.`,
    ];
    for (const bug of bugs) {
      expect(TRAP_PATTERN.test(bug), `should match: ${bug}`).toBe(true);
    }
  });

  test('TRAP_PATTERN does NOT match safe lines (no false positives)', () => {
    // Construct the close sequence at runtime so this test file does not
    // contain it literally (which would trip the very scanner it tests).
    const close = `${'*'}${'/'}`;
    const safe = [
      '/** short single-line comment */',
      ' * normal text without trailing close-sequence',
      ' ` * ` alone is not a terminator',
      ` */`,
      ` * regex: /ab\\${''}cd/`,
      ' * path: ./src/index.ts',
      // Legitimate single-line JSDoc wrapped across lines — the close
      // sequence at end-of-line is the proper terminator, not a trap.
      ` * text with no trailing content ${close}`,
      ` * more text that ends here ${close}   `,
    ];
    for (const line of safe) {
      expect(TRAP_PATTERN.test(line), `should NOT match: ${line}`).toBe(false);
    }
  });
});
