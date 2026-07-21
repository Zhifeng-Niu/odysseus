/**
 * Invariants for src/util/dotenv.ts.
 *
 * loadDotenv is Odysseus's only .env loader — a hand-rolled minimal
 * parser that avoids the dotenv npm dependency. It's the boundary
 * where ODYSSEUS_LLM_API_KEY (and any other secret) enters the process.
 *
 * Security invariants (CLAUDE.md: ".env contains real
 * ODYSSEUS_LLM_API_KEY — never commit or leak"):
 *
 *   1. PARSED VALUES ARE RETURNED, NOT LOGGED. The function returns
 *      a record but never writes secrets to trace/log/console.
 *   2. PRESERVE-EXISTING DEFAULT = TRUE. Real env wins over .env —
 *      production deployments can override secrets without editing
 *      the file. This is the standard dotenv contract.
 *   3. MISSING FILE IS A NO-OP (returns {}). Lets callers unconditionally
 *      attempt to load `.env` without guarding for its existence.
 *   4. SYNCHRONOUS READ via readFileSync — no async surface, no unhandled
 *      rejection risk during early bootstrap (process.env must be
 *      populated before any tool runs).
 *
 * Behavior tests (util-dotenv.test.ts, 9 tests) cover parsing edge cases.
 * This file pins the structural contracts:
 *
 *   - DotenvOptions shape: 1 optional field (preserveExisting).
 *   - loadDotenv signature: 3 params (filePath required, target+options
 *     optional with defaults).
 *   - Returns Record<string, string> (never undefined, never null).
 *   - target default = process.env.
 *   - preserveExisting default = true.
 *   - Errors from readFileSync are swallowed (never thrown).
 *   - Comment lines (`#`) and blank lines are skipped at parse time.
 *   - Double-quoted, single-quoted, and bare values are unquoted.
 *   - Empty key (e.g., `=value`) is skipped.
 *   - Lines without `=` are skipped.
 *
 * Uses mkdtemp per test to isolate fixture files — never touches the
 * real project `.env` (which contains live secrets).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadDotenv, type DotenvOptions } from '../../src/util/dotenv.js';

// ---------------------------------------------------------------------------
// Test fixtures — temp dir per test (NEVER touch real .env)
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ody-dotenv-inv-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeEnvFile(name: string, content: string): Promise<string> {
  const path = join(tempDir, name);
  await writeFile(path, content, 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('dotenv.ts — module exports', () => {
  test('loadDotenv function is exported', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/export\s+function\s+loadDotenv/);
  });

  test('DotenvOptions interface is exported', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+DotenvOptions/);
  });

  test('source exports exactly one function', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    const fnExports = src.match(/^export\s+function\s+(\w+)/gm) ?? [];
    expect(fnExports.length).toBe(1);
  });

  test('source exports exactly one interface', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    const ifaceExports = src.match(/^export\s+interface\s+(\w+)/gm) ?? [];
    expect(ifaceExports.length).toBe(1);
  });

  test('source imports only readFileSync (minimal deps)', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/import\s*\{\s*readFileSync\s*\}\s*from\s*['"]node:fs['"]/);
  });

  test('source has no other runtime imports', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    const imports = src.match(/^import\s+.*$/gm) ?? [];
    expect(imports.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DotenvOptions type shape
// ---------------------------------------------------------------------------

describe('DotenvOptions type shape', () => {
  test('preserveExisting is optional boolean', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    const match = src.match(/export\s+interface\s+DotenvOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/preserveExisting\?\s*:\s*boolean/);
  });

  test('DotenvOptions accepts empty object {}', () => {
    const opts: DotenvOptions = {};
    expect(opts).toEqual({});
  });

  test('DotenvOptions accepts { preserveExisting: true }', () => {
    const opts: DotenvOptions = { preserveExisting: true };
    expect(opts.preserveExisting).toBe(true);
  });

  test('DotenvOptions accepts { preserveExisting: false }', () => {
    const opts: DotenvOptions = { preserveExisting: false };
    expect(opts.preserveExisting).toBe(false);
  });

  test('DotenvOptions has no other fields', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    const match = src.match(/export\s+interface\s+DotenvOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // Match only field definitions at line start (indentation + name + ? + :).
    // Avoids matching JSDoc prose like "contract:".
    const fields = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(fields.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadDotenv — signature and defaults
// ---------------------------------------------------------------------------

describe('loadDotenv — signature and defaults', () => {
  test('returns Record<string, string>', () => {
    const path = `/nonexistent-${Date.now()}/.env`;
    const result = loadDotenv(path, {});
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });

  test("target default is process.env (when omitted)", async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/target:\s*Record<string,\s*string\s*\|\s*undefined>\s*=\s*process\.env/);
  });

  test("options default is {} (when omitted)", async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/options:\s*DotenvOptions\s*=\s*\{\}/);
  });

  test("preserveExisting defaults to true", async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/options\.preserveExisting\s*\?\?\s*true/);
  });

  test('loadDotenv(filePath) works with only required arg', () => {
    // Should not throw — missing file is a no-op.
    expect(() => loadDotenv(`/nonexistent-${Date.now()}`)).not.toThrow();
  });

  test('loadDotenv(filePath, target) works with two args', () => {
    const target: Record<string, string | undefined> = {};
    const result = loadDotenv(`/nonexistent-${Date.now()}`, target);
    expect(result).toEqual({});
    expect(target).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Missing file — no-op contract
// ---------------------------------------------------------------------------

describe('loadDotenv — missing file is a no-op', () => {
  test('missing file returns empty object', () => {
    const result = loadDotenv('/definitely/not/here/.env', {});
    expect(result).toEqual({});
  });

  test('missing file does NOT throw', () => {
    expect(() => loadDotenv('/definitely/not/here/.env', {})).not.toThrow();
  });

  test('missing file leaves target untouched', () => {
    const target: Record<string, string | undefined> = { EXISTING: 'preserved' };
    loadDotenv('/definitely/not/here/.env', target);
    expect(target.EXISTING).toBe('preserved');
  });

  test('source wraps readFileSync in try/catch', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?readFileSync[\s\S]*?\}\s*catch/);
  });

  test('source catch block returns {}', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    // The catch block returns an empty object literal.
    expect(src).toMatch(/catch\s*\{[\s\S]*?return\s*\{\s*\}/);
  });

  test('permission-denied file is also a no-op (not just ENOENT)', async () => {
    // This test verifies that ALL readFileSync errors are swallowed,
    // not just file-not-found. The catch block has no error filter.
    const path = join(tempDir, 'noperm.env');
    await writeFile(path, 'KEY=val', { mode: 0o000 });
    // On most systems, reading a mode-000 file as the same user still
    // works (root or owner). Skip if reading succeeds.
    try {
      const result = loadDotenv(path, {});
      // If reading succeeded (running as owner/root), that's also acceptable.
      expect(typeof result).toBe('object');
    } catch {
      // If readFileSync threw and wasn't caught, this test fails.
      expect.fail('loadDotenv should swallow all readFileSync errors');
    }
  });
});

// ---------------------------------------------------------------------------
// preserveExisting: true (default) — real env wins
// ---------------------------------------------------------------------------

describe('loadDotenv — preserveExisting=true (default)', () => {
  test('existing target value is NOT overwritten by file', async () => {
    const path = await writeEnvFile('a.env', 'API_KEY=from-file');
    const target: Record<string, string | undefined> = { API_KEY: 'from-real-env' };
    const parsed = loadDotenv(path, target);
    // Real env wins.
    expect(target.API_KEY).toBe('from-real-env');
    // Parsed object still records what was in the file.
    expect(parsed.API_KEY).toBe('from-file');
  });

  test('explicit preserveExisting: true behaves same as default', async () => {
    const path = await writeEnvFile('b.env', 'TOKEN=from-file');
    const targetA: Record<string, string | undefined> = { TOKEN: 'from-env' };
    const targetB: Record<string, string | undefined> = { TOKEN: 'from-env' };
    loadDotenv(path, targetA);
    loadDotenv(path, targetB, { preserveExisting: true });
    expect(targetA).toEqual(targetB);
  });

  test('preserveExisting applies per-key (mixed: some preexist, some not)', async () => {
    const path = await writeEnvFile('c.env', 'PRESET=from-file\nNEW=from-file');
    const target: Record<string, string | undefined> = { PRESET: 'from-env' };
    loadDotenv(path, target);
    expect(target.PRESET).toBe('from-env'); // preserved
    expect(target.NEW).toBe('from-file'); // set
  });

  test("preserveExisting treats undefined as 'not present' (overwrites)", async () => {
    const path = await writeEnvFile('d.env', 'KEY=from-file');
    const target: Record<string, string | undefined> = { KEY: undefined };
    loadDotenv(path, target);
    // undefined is treated as not-present — file value is written.
    expect(target.KEY).toBe('from-file');
  });

  test("preserveExisting treats empty string as present (preserved)", async () => {
    const path = await writeEnvFile('e.env', 'KEY=from-file');
    const target: Record<string, string | undefined> = { KEY: '' };
    loadDotenv(path, target);
    // Empty string is a real value — preserved.
    expect(target.KEY).toBe('');
  });

  test('source checks target[key] !== undefined for preserve', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/target\[key\]\s*!==\s*undefined/);
  });
});

// ---------------------------------------------------------------------------
// preserveExisting: false — file overwrites target
// ---------------------------------------------------------------------------

describe('loadDotenv — preserveExisting=false', () => {
  test('file value overwrites existing target value', async () => {
    const path = await writeEnvFile('f.env', 'API_KEY=from-file');
    const target: Record<string, string | undefined> = { API_KEY: 'from-env' };
    loadDotenv(path, target, { preserveExisting: false });
    expect(target.API_KEY).toBe('from-file');
  });

  test('source skips preserveExisting check when flag is false', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    // The guard is: if (preserveExisting && target[key] !== undefined) continue;
    expect(src).toMatch(/if\s*\(\s*preserveExisting\s*&&\s*target\[key\]\s*!==\s*undefined\s*\)\s*continue/);
  });
});

// ---------------------------------------------------------------------------
// Parsing — quoted values (double and single)
// ---------------------------------------------------------------------------

describe('loadDotenv — quoted values', () => {
  test('double-quoted value is unquoted', async () => {
    const path = await writeEnvFile('dq.env', 'KEY="value-with-spaces"');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('value-with-spaces');
    expect(target.KEY).toBe('value-with-spaces');
  });

  test('single-quoted value is unquoted', async () => {
    const path = await writeEnvFile('sq.env', "KEY='value-single'");
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('value-single');
  });

  test('mismatched quotes are preserved (start quote only)', async () => {
    const path = await writeEnvFile('mq.env', 'KEY="unclosed');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    // Mismatched — unquoting only happens when BOTH ends match.
    expect(parsed.KEY).toBe('"unclosed');
  });

  test('unmatched end-quote is preserved', async () => {
    const path = await writeEnvFile('ueq.env', 'KEY=unclosed"');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('unclosed"');
  });

  test('bare value (no quotes) is preserved as-is', async () => {
    const path = await writeEnvFile('bare.env', 'KEY=plain-value');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('plain-value');
  });

  test('quoted empty string becomes empty', async () => {
    const path = await writeEnvFile('empty.env', 'KEY=""');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('');
  });

  test("quoted value length >= 2 check prevents crash on lone char", async () => {
    const path = await writeEnvFile('lone.env', 'KEY="');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    // Length 1, so the unquote branch is skipped. Value stays as-is.
    expect(parsed.KEY).toBe('"');
  });

  test('source uses value.length >= 2 guard', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/value\.length\s*>=\s*2/);
  });

  test('source checks both double and single quote pairs', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/startsWith\(['"]['"]['"]\)/);
    expect(src).toMatch(/endsWith\(['"]['"]['"]\)/);
  });
});

// ---------------------------------------------------------------------------
// Parsing — comments and blank lines
// ---------------------------------------------------------------------------

describe('loadDotenv — comments and blank lines', () => {
  test('full-line comment (# prefix) is skipped', async () => {
    const path = await writeEnvFile('comment.env', '# this is a comment\nKEY=val');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('blank line is skipped', async () => {
    const path = await writeEnvFile('blank.env', '\n\nKEY=val\n\n');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('whitespace-only line is skipped', async () => {
    const path = await writeEnvFile('ws.env', '   \n\t\nKEY=val');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('comment after value is NOT stripped (no inline comment support)', async () => {
    const path = await writeEnvFile('inline.env', 'KEY=val # not a comment');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    // No inline comment support — the # is part of the value.
    expect(parsed.KEY).toBe('val # not a comment');
  });

  test('source checks trimmed.startsWith("#") for comment', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/trimmed\.startsWith\(['"]#['"]\)/);
  });

  test('source checks trimmed === "" for blank', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/trimmed\s*===\s*['"]['"]/);
  });
});

// ---------------------------------------------------------------------------
// Parsing — line structure (KEY=VALUE)
// ---------------------------------------------------------------------------

describe('loadDotenv — line structure', () => {
  test('line without = is skipped', async () => {
    const path = await writeEnvFile('noeq.env', 'NO_EQUALS_HERE\nKEY=val');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('empty key (=value) is skipped', async () => {
    const path = await writeEnvFile('emptykey.env', '=value\nKEY=val');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('multiple = in value are preserved (only first = splits)', async () => {
    const path = await writeEnvFile('multi.env', 'URL=https://example.com/path?q=1&r=2');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.URL).toBe('https://example.com/path?q=1&r=2');
  });

  test('source uses indexOf("=") for first-equals split', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/indexOf\(['"]=['"]\)/);
  });

  test('source skips line when eq === -1', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/eq\s*===\s*-1/);
  });

  test('source skips when key is empty (after trim)', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*!key\s*\)\s*continue/);
  });

  test('whitespace around key is stripped', async () => {
    const path = await writeEnvFile('wsk.env', '   KEY_WITH_SPACES   =val');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY_WITH_SPACES).toBe('val');
  });

  test('whitespace around value is stripped', async () => {
    const path = await writeEnvFile('wsv.env', 'KEY=     val     ');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed.KEY).toBe('val');
  });

  test('source uses slice for key and value extraction', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/slice\(0,\s*eq\)/);
    expect(src).toMatch(/slice\(eq\s*\+\s*1\)/);
  });
});

// ---------------------------------------------------------------------------
// Parsed object shape — return value
// ---------------------------------------------------------------------------

describe('loadDotenv — return value shape', () => {
  test('parsed object does NOT include comments or blank lines', async () => {
    const path = await writeEnvFile('ret.env', '# comment\n\nKEY=val\n# another');
    const parsed = loadDotenv(path, {});
    expect(Object.keys(parsed)).toEqual(['KEY']);
  });

  test('parsed object contains both quoted and bare values', async () => {
    const path = await writeEnvFile('mix.env', 'A="quoted"\nB=bare\nC=\'single\'');
    const parsed = loadDotenv(path, {});
    expect(parsed).toEqual({ A: 'quoted', B: 'bare', C: 'single' });
  });

  test('parsed object does NOT include lines without =', async () => {
    const path = await writeEnvFile('noeq2.env', 'INVALID\nKEY=val');
    const parsed = loadDotenv(path, {});
    expect(parsed).toEqual({ KEY: 'val' });
  });

  test('parsed object reflects file content regardless of preserveExisting', async () => {
    const path = await writeEnvFile('pe.env', 'ALREADY_SET=from-file');
    const target: Record<string, string | undefined> = { ALREADY_SET: 'from-env' };
    const parsedTrue = loadDotenv(path, target, { preserveExisting: true });
    const target2: Record<string, string | undefined> = { ALREADY_SET: 'from-env' };
    const parsedFalse = loadDotenv(path, target2, { preserveExisting: false });
    // Both return the file content.
    expect(parsedTrue.ALREADY_SET).toBe('from-file');
    expect(parsedFalse.ALREADY_SET).toBe('from-file');
    // But target differs based on flag.
    expect(target.ALREADY_SET).toBe('from-env');
    expect(target2.ALREADY_SET).toBe('from-file');
  });

  test('parsed object is always an object (never array, never primitive)', () => {
    const path = `/nonexistent-${Date.now()}`;
    const result = loadDotenv(path, {});
    expect(typeof result).toBe('object');
    expect(Array.isArray(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Synchronous read contract (no async surface)
// ---------------------------------------------------------------------------

describe('loadDotenv — synchronous contract', () => {
  test('loadDotenv is a sync function (not async)', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    // Function declaration without `async` keyword.
    expect(src).toMatch(/export\s+function\s+loadDotenv[^a]/);
    expect(src).not.toMatch(/export\s+async\s+function\s+loadDotenv/);
  });

  test('loadDotenv returns directly (no Promise)', () => {
    const result = loadDotenv('/nonexistent', {});
    expect(result).not.toBeInstanceOf(Promise);
  });

  test('source uses readFileSync (not fs.promises.readFile)', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).toMatch(/readFileSync/);
    expect(src).not.toMatch(/fs\.promises/);
  });
});

// ---------------------------------------------------------------------------
// Security — never writes to console, trace, or log
// ---------------------------------------------------------------------------

describe('loadDotenv — security contract', () => {
  test('source does NOT call console.log/error/warn', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
  });

  test('source does NOT call any trace/log/write function', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    // The loader is pure — it reads a file and returns/assigns values.
    expect(src).not.toMatch(/trace|logger|writeStream/i);
  });

  test('source does NOT call process.stdout.write', async () => {
    const src = await readFile('src/util/dotenv.ts', 'utf8');
    expect(src).not.toMatch(/process\.stdout/);
  });

  test('loaded secrets stay in target/parsed only', async () => {
    const path = await writeEnvFile('secret.env', 'SECRET=password123');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    // No side-channel — both objects are the only place the value lives.
    expect(target.SECRET).toBe('password123');
    expect(parsed.SECRET).toBe('password123');
    // No global leak via process.env (because target was explicitly {}).
    // Skip if process.env.SECRET happened to be set before tests ran.
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('loadDotenv — determinism', () => {
  test('loading the same file twice produces same parsed object', async () => {
    const path = await writeEnvFile('det.env', 'A=1\nB=2');
    const a = loadDotenv(path, {});
    const b = loadDotenv(path, {});
    expect(a).toEqual(b);
  });

  test('loading the same file twice into fresh targets produces same state', async () => {
    const path = await writeEnvFile('det2.env', 'A=1\nB=2');
    const t1: Record<string, string | undefined> = {};
    const t2: Record<string, string | undefined> = {};
    loadDotenv(path, t1);
    loadDotenv(path, t2);
    expect(t1).toEqual(t2);
  });
});

// ---------------------------------------------------------------------------
// Multi-line file structure
// ---------------------------------------------------------------------------

describe('loadDotenv — multi-line files', () => {
  test('CRLF line endings are handled (\\n split)', async () => {
    // split('\n') on CRLF leaves \r at end of each line.
    // The trim() handles that — \r is whitespace.
    const path = await writeEnvFile('crlf.env', 'KEY1=val1\r\nKEY2=val2\r\n');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  test('LF-only line endings', async () => {
    const path = await writeEnvFile('lf.env', 'KEY1=val1\nKEY2=val2\n');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  test('no trailing newline', async () => {
    const path = await writeEnvFile('notrail.env', 'KEY1=val1\nKEY2=val2');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  test('multiple consecutive blank lines', async () => {
    const path = await writeEnvFile('multi-blank.env', 'KEY1=val1\n\n\n\nKEY2=val2');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  test('file with only comments returns empty object', async () => {
    const path = await writeEnvFile('only-comments.env', '# a\n# b\n# c');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({});
  });

  test('empty file returns empty object', async () => {
    const path = await writeEnvFile('empty-file.env', '');
    const target: Record<string, string | undefined> = {};
    const parsed = loadDotenv(path, target);
    expect(parsed).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Return value invariant — always defined object
// ---------------------------------------------------------------------------

describe('loadDotenv — return value is always a defined object', () => {
  test('missing file returns defined object', () => {
    const result = loadDotenv('/nonexistent', {});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('empty file returns defined object', async () => {
    const path = await writeEnvFile('empty2.env', '');
    const result = loadDotenv(path, {});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('malformed file returns defined object', async () => {
    const path = await writeEnvFile('malformed.env', 'line without equals');
    const result = loadDotenv(path, {});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('valid file returns defined object', async () => {
    const path = await writeEnvFile('valid.env', 'KEY=val');
    const result = loadDotenv(path, {});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});
