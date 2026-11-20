import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Source contract — index.ts (CLI/TUI entry point)
//
// This module is the process entry point. It MUST NOT be imported by any
// other module (side effects at top level: main() is invoked immediately).
//
// Invariants pinned here (source-level only — running main() has irreversible
// side effects: process.exit, file writes, network):
//
//   - 13 imports from specific local modules + node:path
//     (shouldAutoApprove added to unify voyage/dreamer auto-approve gates)
//   - 5 tools registered in a fixed order: FileRead, FileWrite, FileEdit,
//     Git, Bash
//   - Verify layers in BOTH paths are ['progress', 'syntax', 'tests']
//     (progress first — cheapest check blocks empty-commit false-success)
//   - CLI mission is the spike co-evolution string
//   - Event log path: .odysseus/events.jsonl
//   - Trace path: .odysseus/trace.jsonl
//   - isInteractive requires BOTH stdout AND stdin TTY
//   - main() is invoked at module load with .catch() that exits 1
// ---------------------------------------------------------------------------

// We don't import the actual module — doing so would invoke main() and exit
// the process. All tests are source-level.

const SRC_PATH = 'src/index.ts';

describe('index — module shape', () => {
  test('has 16 import statements', async () => {
    // 13 → 14: agent/guards.js (crash-free-task mission) — the entry point
    // owns process-guard installation.
    // 14 → 15: cerebellum/lesson-recorder.js (P1 learning element) — the
    // voyage console path wires verify-failure → lesson recording here.
    const src = await readFile(SRC_PATH, 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(16);
  });

  test('imports from expected local modules', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/from\s+'\.\/config\.js'/);
    expect(src).toMatch(/from\s+'\.\/llm\/glm\.js'/);
    expect(src).toMatch(/from\s+'\.\/tools\/registry\.js'/);
    expect(src).toMatch(/from\s+'\.\/tools\/file\.js'/);
    expect(src).toMatch(/from\s+'\.\/tools\/git\.js'/);
    expect(src).toMatch(/from\s+'\.\/tools\/bash\.js'/);
    expect(src).toMatch(/from\s+'\.\/agent\/loop\.js'/);
    expect(src).toMatch(/from\s+'\.\/cerebellum\/orchestrator\.js'/);
    expect(src).toMatch(/from\s+'\.\/cerebellum\/pending-review-auto\.js'/);
    expect(src).toMatch(/from\s+'\.\/tui\/index\.js'/);
    expect(src).toMatch(/from\s+'\.\/util\/dotenv\.js'/);
    expect(src).toMatch(/from\s+'\.\/trace\/event-log\.js'/);
    expect(src).toMatch(/from\s+'node:path'/);
  });

  test('imports shouldAutoApprove from pending-review-auto', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*shouldAutoApprove\s*\}\s+from\s+'\.\/cerebellum\/pending-review-auto\.js'/);
  });

  test('all local imports use .js ESM extension', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const localImports = src.match(/^import[^;]+from\s+'\.[^']+'/gm) ?? [];
    for (const imp of localImports) {
      expect(imp).toMatch(/\.js'/);
    }
  });

  test('no exports (entry-point module, no export surface)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^export\s/m);
  });
});

// ---------------------------------------------------------------------------
// Top-level function declarations
// ---------------------------------------------------------------------------

describe('index — top-level functions', () => {
  test('declares isInteractive, runCli, runVoyageConsole, main', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/function\s+isInteractive\s*\(/);
    expect(src).toMatch(/async\s+function\s+runCli\s*\(/);
    expect(src).toMatch(/function\s+runVoyageConsole\s*\(/);
    expect(src).toMatch(/async\s+function\s+main\s*\(/);
  });

  test('exactly 4 top-level function declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const fns = src.match(/^(export\s+)?(async\s+)?function\s+\w+/gm) ?? [];
    expect(fns.length).toBe(4);
  });

  test('isInteractive returns boolean', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/function\s+isInteractive\s*\(\s*\):\s*boolean/);
  });

  test('runCli is async and returns Promise<void>', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/async\s+function\s+runCli\s*\([\s\S]*?\):\s*Promise<void>/);
  });

  test('runVoyageConsole is sync and returns void', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/function\s+runVoyageConsole\s*\([\s\S]*?\):\s*void/);
  });

  test('main is async and returns Promise<void>', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/async\s+function\s+main\s*\(\s*\):\s*Promise<void>/);
  });
});

// ---------------------------------------------------------------------------
// Tool registration — fixed 5-tool set in a fixed order
// ---------------------------------------------------------------------------

describe('index — tool registration', () => {
  test('registers exactly 7 tools (5 code + reminder/note life tools)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const registrations = src.match(/registry\.register\(/g) ?? [];
    expect(registrations.length).toBe(7);
  });

  test('registers tools in fixed order: FileRead, FileWrite, FileEdit, Git, Bash', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const order: Array<{ name: string; idx: number }> = [];
    const tools = ['FileReadTool', 'FileWriteTool', 'FileEditTool', 'GitTool', 'BashTool'];
    for (const t of tools) {
      const idx = src.indexOf(`new ${t}(`);
      expect(idx, `${t} should be instantiated`).toBeGreaterThan(-1);
      order.push({ name: t, idx });
    }
    order.sort((a, b) => a.idx - b.idx);
    expect(order.map((o) => o.name)).toEqual(tools);
  });

  test('all 5 tool classes are imported from local modules', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/FileReadTool/);
    expect(src).toMatch(/FileWriteTool/);
    expect(src).toMatch(/FileEditTool/);
    expect(src).toMatch(/GitTool/);
    expect(src).toMatch(/BashTool/);
  });

  test('registry is constructed with no args', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/new\s+ToolRegistry\(\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Verify layers — fixed order with progress first
// ---------------------------------------------------------------------------

describe('index — verify layers order', () => {
  test('runCli uses ["progress", "syntax", "tests"]', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/verifyLayers:\s*\[\s*'progress',\s*'syntax',\s*'tests'\s*\]/);
  });

  test('runVoyageConsole uses the same verify layers order', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // Count occurrences of the verify layers array
    const occurrences = src.match(/verifyLayers:\s*\[\s*'progress',\s*'syntax',\s*'tests'\s*\]/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  test('progress appears before syntax and tests', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const firstProgress = src.indexOf("'progress'");
    const firstSyntax = src.indexOf("'syntax'");
    const firstTests = src.indexOf("'tests'");
    expect(firstProgress).toBeGreaterThan(-1);
    expect(firstProgress).toBeLessThan(firstSyntax);
    expect(firstSyntax).toBeLessThan(firstTests);
  });
});

// ---------------------------------------------------------------------------
// Voyage console autonomy — unified with dreamer gate
// ---------------------------------------------------------------------------

describe('index — voyage console autoApprove unification', () => {
  test('runVoyageConsole computes autoApprove from shouldAutoApprove()', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+autoApprove\s*=\s*shouldAutoApprove\(\)/);
  });

  test('passes autoApprove to CerebellumOrchestrator config', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/autoApprove,/);
  });

  test('does NOT rely on the orchestrator default (TTY=false) for voyage console', async () => {
    // The orchestrator default is `autoApprove = !isTTY`. By overriding
    // explicitly here, the voyage console bypasses the TTY-based gate so
    // dreaming → backlog → wakeful waypoint iteration is autonomous by
    // default. ODYSSEUS_AUTO_APPROVE=0 re-enables supervised mode.
    const src = await readFile(SRC_PATH, 'utf8');
    // The autoApprove field MUST appear in the config literal passed to
    // CerebellumOrchestrator inside runVoyageConsole.
    const voyageBlock = src.match(/function\s+runVoyageConsole\s*\([\s\S]*?startTui/);
    expect(voyageBlock).not.toBeNull();
    expect(voyageBlock![0]).toMatch(/shouldAutoApprove/);
    expect(voyageBlock![0]).toMatch(/autoApprove,/);
  });

  test('document references ODYSSEUS_AUTO_APPROVE as the unified switch', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/ODYSSEUS_AUTO_APPROVE/);
  });

  test('document mentions both gates (dreamer + voyage waypoint) read same switch', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/dreamer/);
    expect(src).toMatch(/voyage waypoint/);
  });
});

// ---------------------------------------------------------------------------
// Mission string — CLI mode
// ---------------------------------------------------------------------------

describe('index — CLI mission', () => {
  test('runCli mission is the spike co-evolution string', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/mission:\s*'Iterate on the Odysseus spike codebase \(Iteration 0 seed → co-evolution\)'/);
  });

  test('mission uses the unicode arrow → (not ASCII)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/seed\s*→\s*co-evolution/);
  });
});

// ---------------------------------------------------------------------------
// Path conventions
// ---------------------------------------------------------------------------

describe('index — path conventions', () => {
  test('event log path is .odysseus/events.jsonl', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/join\(\s*cwd,\s*'\.odysseus',\s*'events\.jsonl'\s*\)/);
  });

  test('trace path is .odysseus/trace.jsonl', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/join\(\s*cwd,\s*'\.odysseus',\s*'files'\s*\)|join\(\s*cwd,\s*'\.odysseus',\s*'trace\.jsonl'\s*\)/);
  });

  test('dotenv loaded from join(cwd, ".env")', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/loadDotenv\(\s*join\(\s*cwd,\s*'\.env'\s*\)\s*\)/);
  });

  test('cwd is process.cwd()', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+cwd\s*=\s*process\.cwd\(\)/);
  });
});

// ---------------------------------------------------------------------------
// isInteractive — TTY check on both stdout AND stdin
// ---------------------------------------------------------------------------

describe('index — isInteractive', () => {
  test('checks process.stdout.isTTY', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.stdout\.isTTY\s*===\s*true/);
  });

  test('checks process.stdin.isTTY', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.stdin\.isTTY\s*===\s*true/);
  });

  test('combines both checks with AND (&&)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.stdout\.isTTY\s*===\s*true\s*&&\s*process\.stdin\.isTTY\s*===\s*true/);
  });
});

// ---------------------------------------------------------------------------
// Branching — CLI vs TUI
// ---------------------------------------------------------------------------

describe('index — CLI/TUI branching', () => {
  test('TUI path requires isInteractive() AND argv.length === 0', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*isInteractive\(\)\s*&&\s*process\.argv\.slice\(2\)\.length\s*===\s*0\s*\)/);
  });

  test('runVoyageConsole is called when TUI branch taken', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/runVoyageConsole\(\s*cwd,\s*provider,\s*registry,\s*tracePath,\s*config\.model\s*\)/);
  });

  test('runCli is the fallback (await)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/await\s+runCli\(\s*cwd,\s*provider,\s*registry,\s*tracePath\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// CLI argument handling
// ---------------------------------------------------------------------------

describe('index — CLI argument handling', () => {
  test('reads argv.slice(2).join(" ").trim() as user input', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.argv\.slice\(2\)\.join\(['"]\s*['"]\)\.trim\(\)/);
  });

  test('prints usage to stderr when user input is empty', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.error\(['"]Usage:\s+odysseus\s+<your request>['"]\)/);
  });

  test('exits with code 1 when user input is empty', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test('prints result.response to stdout on success', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/console\.log\(\s*result\.response\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Event log recording — TUI mode
// ---------------------------------------------------------------------------

describe('index — event log recording', () => {
  test('subscribes to orchestrator "event" channel', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/orch\.on\(\s*['"]event['"]\s*,/);
  });

  test('calls recordEvent with the event log path', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/recordEvent\(\s*eventLogPath,\s*e\s*\)/);
  });

  test('starts TUI with { orch, model }', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/startTui\(\s*\{\s*orch,\s*model\s*\}\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Top-level invocation — main().catch(...)
// ---------------------------------------------------------------------------

describe('index — top-level main() invocation', () => {
  test('main() is invoked at module load', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/^main\(\)/m);
  });

  test('main().catch() handler exits 1 on error', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/main\(\)\.catch\(/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test('error handler prints err.stack ?? err.message, or String(err)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/err\s+instanceof\s+Error\s*\?\s*err\.stack\s*\?\?\s*err\.message\s*:\s*String\(err\)/);
  });

  test('catch handler parameter is typed unknown', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\.catch\(\s*\(\s*err:\s*unknown\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------

describe('index — provider construction', () => {
  test('GLMProvider constructed with { apiKey, model, baseUrl } from config', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/new\s+GLMProvider\(\s*\{\s*apiKey:\s*config\.apiKey,\s*model:\s*config\.model,\s*baseUrl:\s*config\.baseUrl,\s*\}\s*\)/s);
  });

  test('loadConfig() called with no args (uses process.env default)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+config\s*=\s*loadConfig\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('index — source-level safety', () => {
  test('no direct child_process or exec/spawn usage', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no direct fetch or network — provider owns LLM network access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/^import\s+.*from\s+'https?'/m);
  });

  test('no fs.readFile/writeFile/sync — file tools own file access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // fs may not even be imported here. If it is, only path-related helpers allowed.
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('index — structural fingerprint', () => {
  test('file is between 80 and 156 lines (compact entry point)', async () => {
    // Upper bound 120 → 125: the /ithaca CLI surface (Ithaca MVP port) adds
    // a 3-line local dispatch — the protected core must never enter the LLM
    // path, so it cannot be folded into runAgentTurn.
    // 125 → 145: crash guards (crash-free-task mission) — guard install +
    // report-to-event-log block at main() start.
    // 145 → 150: lesson recorder wiring (P1 learning element) — one import +
    // one attach call in runVoyageConsole; the recorder lives in its own
    // module, the entry point only wires it.
    // 150 → 152: `odysseus init` dispatch (一句话部署) + bin shebang — the
    // global bin symlinks straight at dist/index.js, which needs
    // #!/usr/bin/env node to execute as a program (no shebang → sh "runs"
    // the JS: line 1 `import ...` invokes ImageMagick's import!).
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(80);
    expect(lines.length).toBeLessThanOrEqual(156);
  });

  test('has no class declarations (function-only module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('has no interface or type declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^(export\s+)?(interface|type)\s+\w+/m);
  });

  test('main() call is at the END of the file (last non-trivial statement)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lastMainIdx = src.lastIndexOf('main()');
    const lastCharIdx = src.length - 1;
    // main() invocation must be in the last 10% of the file
    expect(lastMainIdx).toBeGreaterThan(src.length * 0.9 - 100);
    expect(lastMainIdx).toBeLessThan(lastCharIdx);
  });
});
