import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Source contract — src/scripts/probe-curiosity.ts
//
// Live curiosity probe script. Loads .env, sets ODYSSEUS_AUTO_APPROVE=0, runs
// ONE curiosity pass against the real GLM provider, prints the result.
//
// Top-level await + immediate execution means we CANNOT import the module —
// doing so triggers a real LLM call and side effects. All tests are
// source-level.
//
// Invariants pinned:
//   - Shebang + docstring (run after build, ODYSSEUS_AUTO_APPROVE=0 contract)
//   - 7 imports (1 node:path + 6 local modules)
//   - loadDotenv with .env path
//   - .odysseus/trace.jsonl path
//   - GLMProvider constructed from loadConfig() output
//   - 4 memory categories hardcoded: patterns, lessons, preferences, dreams
//   - ODYSSEUS_AUTO_APPROVE = '0' consent gate (BEFORE curiosity call)
//   - curiosity() call with {rootDir, provider, recentTrace, memorySnapshot}
//   - 6 result fields printed: parseOk, parseError, backlogItemsAdded/Skipped,
//     memoryEntriesAdded, durationMs
//   - Raw response truncated to 1200 chars
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/scripts/probe-curiosity.ts';

describe('scripts/probe-curiosity — module shape', () => {
  test('starts with node shebang', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  test('has docstring explaining purpose', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Live curiosity probe/);
    expect(src).toMatch(/verifies the curiosity phase works end-to-end/);
  });

  test('documents run command after build', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/node dist\/scripts\/probe-curiosity\.js/);
    expect(src).toMatch(/npm run build/);
  });

  test('documents ODYSSEUS_AUTO_APPROVE=0 consent gate', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/ODYSSEUS_AUTO_APPROVE=0/);
    expect(src).toMatch(/pending-review\.json/);
  });

  test('has exactly 7 import statements', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(7);
  });

  test('imports resolve, join from node:path', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*resolve,\s*join\s*\}\s+from\s+'node:path'/);
  });

  test('imports curiosity from cerebellum', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*curiosity\s*\}\s+from\s+'\.\.\/cerebellum\/curiosity\.js'/);
  });

  test('imports GLMProvider from llm/glm', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*GLMProvider\s*\}\s+from\s+'\.\.\/llm\/glm\.js'/);
  });

  test('imports loadConfig from config', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*loadConfig\s*\}\s+from\s+'\.\.\/config\.js'/);
  });

  test('imports readTrace from trace/jsonl', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*readTrace\s*\}\s+from\s+'\.\.\/trace\/jsonl\.js'/);
  });

  test('imports readMemory from cerebellum/memory', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*readMemory\s*\}\s+from\s+'\.\.\/cerebellum\/memory\.js'/);
  });

  test('imports loadDotenv from util/dotenv', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*loadDotenv\s*\}\s+from\s+'\.\.\/util\/dotenv\.js'/);
  });

  test('all local imports use .js ESM extension', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const localImports = src.match(/^import[^;]+from\s+'\.[^']+'/gm) ?? [];
    for (const imp of localImports) {
      expect(imp).toMatch(/\.js'/);
    }
  });
});

// ---------------------------------------------------------------------------
// Setup — dotenv, paths, config, provider
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — setup', () => {
  test('calls loadDotenv with join(process.cwd(), ".env")', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/loadDotenv\(\s*join\(\s*process\.cwd\(\),\s*'\.env'\s*\)\s*\)/);
  });

  test('rootDir resolves .odysseus under cwd', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+rootDir\s*=\s*resolve\(\s*process\.cwd\(\),\s*'\.odysseus'\s*\)/);
  });

  test('tracePath resolves trace.jsonl under rootDir', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+tracePath\s*=\s*resolve\(\s*rootDir,\s*'trace\.jsonl'\s*\)/);
  });

  test('calls loadConfig() with no args', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+cfg\s*=\s*loadConfig\(\)/);
  });

  test('constructs GLMProvider with apiKey, model, baseUrl from cfg', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/new\s+GLMProvider\(\s*\{[\s\S]*?apiKey:\s*cfg\.apiKey,[\s\S]*?model:\s*cfg\.model,[\s\S]*?baseUrl:\s*cfg\.baseUrl,[\s\S]*?\}\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Memory snapshot — 4 categories
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — memory snapshot', () => {
  test('hardcodes 4 memory categories as const tuple', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+categories\s*=\s*\[\s*'patterns',\s*'lessons',\s*'preferences',\s*'dreams'\s*\]\s+as\s+const/);
  });

  test('reads trace via await readTrace(tracePath)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+recentTrace\s*=\s*await\s+readTrace\(\s*tracePath\s*\)/);
  });

  test('builds memorySnapshot via Promise.all over categories', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+memorySnapshot\s*=\s*await\s+Promise\.all\(/);
  });

  test('maps each category to {category, entries}', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/categories\.map\(\s*async\s+\(category\)\s*=>\s*\(\s*\{\s*category,\s*entries:\s*await\s+readMemory\(\s*rootDir,\s*category\s*\),\s*\}\s*\)\s*\)/);
  });

  test('prints trace record count', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`trace records:\s*\$\{recentTrace\.length\}`\s*\)/);
  });

  test('iterates memory snapshot for category counts', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*const\s+snap\s+of\s+memorySnapshot\s*\)/);
    expect(src).toMatch(/console\.log\(\s*`\s+\$\{\s*snap\.category\s*\}:\s*\$\{\s*snap\.entries\.length\s*\}\s+entries`\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Consent gate + curiosity call
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — consent gate + curiosity call', () => {
  test('sets process.env.ODYSSEUS_AUTO_APPROVE = "0" BEFORE curiosity call', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const gateIdx = src.indexOf("process.env.ODYSSEUS_AUTO_APPROVE = '0'");
    const callIdx = src.indexOf('await curiosity(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(callIdx);
  });

  test('awaits curiosity() with {rootDir, provider, recentTrace, memorySnapshot}', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+result\s*=\s*await\s+curiosity\(\s*\{[\s\S]*?rootDir,[\s\S]*?provider,[\s\S]*?recentTrace,[\s\S]*?memorySnapshot,[\s\S]*?\}\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Result printing
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — result printing', () => {
  test('prints parseOk', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`parseOk:\s*\$\{result\.parseOk\}`\s*\)/);
  });

  test('prints parseError with ?? "-" fallback', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // Use plain string checks to avoid regex-literal gotchas with the
    // multi-line template literal in the source.
    expect(src).toContain('`parseError: ${result.parseError ?? \'-\'}');
  });

  test('prints backlogItemsAdded', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`backlogItemsAdded:\s*\$\{result\.backlogItemsAdded\}`\s*\)/);
  });

  test('prints backlogItemsSkipped', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`backlogItemsSkipped:\s*\$\{result\.backlogItemsSkipped\}`\s*\)/);
  });

  test('prints memoryEntriesAdded', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`memoryEntriesAdded:\s*\$\{result\.memoryEntriesAdded\}`\s*\)/);
  });

  test('prints durationMs', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*`durationMs:\s*\$\{result\.durationMs\}`\s*\)/);
  });

  test('iterates addedBacklogItems with [priority] goal format', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*const\s+item\s+of\s+result\.addedBacklogItems\s*\)/);
    expect(src).toMatch(/console\.log\(\s*`\s+\[\$\{item\.priority\}\]\s+\$\{item\.goal\}`\s*\)/);
  });

  test('iterates addedMemoryEntries with [category] title format', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*const\s+entry\s+of\s+result\.addedMemoryEntries\s*\)/);
    expect(src).toMatch(/console\.log\(\s*`\s+\[\$\{entry\.category\}\]\s+\$\{entry\.title\}`\s*\)/);
  });

  test('prints raw response sliced to 1200 chars', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*result\.rawResponse\.slice\(\s*0,\s*1200\s*\)\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — source-level safety', () => {
  test('no child_process import', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no direct fetch (provider owns network access)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no process.exit (this script is expected to complete naturally)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('scripts/probe-curiosity — structural fingerprint', () => {
  test('file is between 60 and 90 lines', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(60);
    expect(lines.length).toBeLessThanOrEqual(90);
  });

  test('has no top-level function declarations (script is straight-line)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^function\s+\w+/m);
    expect(src).not.toMatch(/^async\s+function\s+\w+/m);
  });

  test('has no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('has no interface or type declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^(export\s+)?(interface|type)\s+\w+/m);
  });

  test('has no exports (entry-point script)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^export\s/m);
  });

  test('top-level await is used (script runs at module load)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // at least two top-level awaits: readTrace, curiosity
    const topLevelAwaits = src.match(/^const\s+\w+\s*=\s*await\s/gm) ?? [];
    expect(topLevelAwaits.length).toBeGreaterThanOrEqual(2);
  });
});
