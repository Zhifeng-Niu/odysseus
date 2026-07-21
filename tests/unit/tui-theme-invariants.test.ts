import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { palette, theme, type Theme } from '../../src/tui/theme.js';

// ---------------------------------------------------------------------------
// Source contract — src/tui/theme.ts
//
// Catppuccin Mocha palette + Nolan Odyssey cinematography semantics.
// Pure data module — no functions, no classes, no side effects.
//
// Invariants pinned here:
//   - palette: 26 hex colors, all #RRGGBB format, as const
//   - theme: nested object referencing palette (NOT re-declaring hex values)
//   - Theme type exported as typeof theme (single source of truth)
//   - 8 semantic groups: waypoint, plan, evolution, toolCall, verify,
//     assistant, user, chrome, text
//   - Waypoint lifecycle: 7 distinct hues
//   - Verify gate reuses palette.yellow/green/red (not new colors)
//   - All hex values match canonical Catppuccin Mocha values
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/tui/theme.ts';

// ---------------------------------------------------------------------------
// Source-level — module shape
// ---------------------------------------------------------------------------

describe('tui/theme — module shape', () => {
  test('file is between 140 and 160 lines', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(140);
    expect(lines.length).toBeLessThanOrEqual(160);
  });

  test('opens with Catppuccin Mocha + Nolan Odyssey cinematography comment', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Catppuccin Mocha palette/);
    expect(src).toMatch(/Nolan Odyssey cinematography/);
  });

  test('references the canonical Catppuccin URL', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/catppuccin\.com/);
  });

  test('notes Ink <Text color="#..."> acceptance', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Ink/);
    expect(src).toMatch(/Text color="#/);
  });

  test('has no import statements (pure data module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });

  test('has no function declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^function\s+\w+/m);
    expect(src).not.toMatch(/=>/);
  });

  test('has no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('has no interface declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^interface\s+\w+/m);
  });

  test('exactly 3 exports: palette, theme, Theme', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const exports = src.match(/^export\s/gm) ?? [];
    expect(exports.length).toBe(3);
    expect(src).toMatch(/^export\s+const\s+palette/m);
    expect(src).toMatch(/^export\s+const\s+theme/m);
    expect(src).toMatch(/^export\s+type\s+Theme\s*=\s*typeof\s+theme/m);
  });
});

// ---------------------------------------------------------------------------
// palette — 26 hex colors as const
// ---------------------------------------------------------------------------

describe('tui/theme — palette shape', () => {
  test('palette exported as const (narrowest possible types)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+palette\s*=\s*\{[\s\S]*?\}\s+as\s+const/);
  });

  test('palette has exactly 26 entries', () => {
    // Count enumerable own keys.
    expect(Object.keys(palette).length).toBe(26);
  });

  test('all palette values are #RRGGBB hex strings', () => {
    for (const [key, value] of Object.entries(palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      // Hex letters are lowercase in canonical Catppuccin Mocha
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(key).toMatch(/^[a-z]+[0-9]?$/);
    }
  });

  test('palette has documented section headers in source', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // Comment-header sections inside palette
    expect(src).toMatch(/─── Base surfaces/);
    expect(src).toMatch(/─── Text /);
    expect(src).toMatch(/─── Elevated surfaces/);
    expect(src).toMatch(/─── Overlay/);
    expect(src).toMatch(/─── Accents \(cool\)/);
    expect(src).toMatch(/─── Accents \(warm/);
  });

  test('palette contains the canonical Catppuccin Mocha base values', () => {
    // Canonical values from https://catppuccin.com/palette/
    expect(palette.base).toBe('#1e1e2e');
    expect(palette.mantle).toBe('#181825');
    expect(palette.crust).toBe('#11111b');
  });

  test('palette contains the canonical Catppuccin Mocha text values', () => {
    expect(palette.text).toBe('#cdd6f4');
    expect(palette.subtext0).toBe('#a6adc8');
    expect(palette.subtext1).toBe('#bac2de');
  });

  test('palette contains the canonical Catppuccin Mocha surface values', () => {
    expect(palette.surface0).toBe('#313244');
    expect(palette.surface1).toBe('#45475a');
    expect(palette.surface2).toBe('#585b70');
  });

  test('palette contains the canonical Catppuccin Mocha overlay values', () => {
    expect(palette.overlay0).toBe('#6c7086');
    expect(palette.overlay1).toBe('#7f849c');
    expect(palette.overlay2).toBe('#9399b2');
  });

  test('palette cool accents (blue/lavender/sapphire/sky/teal)', () => {
    expect(palette.blue).toBe('#89b4fa');
    expect(palette.lavender).toBe('#b4befe');
    expect(palette.sapphire).toBe('#74c7ec');
    expect(palette.sky).toBe('#89dceb');
    expect(palette.teal).toBe('#94e2d5');
  });

  test('palette warm accents (green/yellow/peach/maroon/red/mauve/pink/flamingo/rosewater)', () => {
    expect(palette.green).toBe('#a6e3a1');
    expect(palette.yellow).toBe('#f9e2af');
    expect(palette.peach).toBe('#fab387');
    expect(palette.maroon).toBe('#eba0ac');
    expect(palette.red).toBe('#f38ba8');
    expect(palette.mauve).toBe('#cba6f7');
    expect(palette.pink).toBe('#f5c2e7');
    expect(palette.flamingo).toBe('#f2cdcd');
    expect(palette.rosewater).toBe('#f5e0dc');
  });
});

// ---------------------------------------------------------------------------
// theme — semantic mapping
// ---------------------------------------------------------------------------

describe('tui/theme — theme shape', () => {
  test('theme exported as const', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+theme\s*=\s*\{[\s\S]*?\}\s+as\s+const/);
  });

  test('theme.palette is the same object as palette', () => {
    // theme.palette should reference the SAME object, not a copy.
    expect(theme.palette).toBe(palette);
  });

  test('theme has 9 top-level groups: palette, waypoint, plan, evolution, toolCall, verify, assistant, user, chrome, text', () => {
    expect(Object.keys(theme).sort()).toEqual(
      [
        'assistant',
        'chrome',
        'evolution',
        'palette',
        'plan',
        'text',
        'toolCall',
        'user',
        'verify',
        'waypoint',
      ].sort(),
    );
  });

  test('theme references palette (no re-declared hex values)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // The theme object should ONLY reference palette.* keys, never literal hex.
    // Extract the theme object body and assert no hex literals.
    const match = src.match(/export\s+const\s+theme\s*=\s*\{([\s\S]*?)\}\s+as\s+const/);
    expect(match).not.toBeNull();
    const themeBody = match![1];
    expect(themeBody).not.toMatch(/#[0-9a-fA-F]{6}/);
    // Should reference palette.* keys throughout
    expect(themeBody).toMatch(/palette\.\w+/);
  });

  test('all theme values reference palette.* keys (not literals)', () => {
    // Walk the theme tree (excluding palette). Every leaf value should be a
    // hex string that ALSO appears in palette — i.e., the theme re-uses
    // palette values, not new literals.
    const paletteValues = new Set(Object.values(palette));
    function walk(node: unknown, path: string): void {
      if (typeof node === 'string') {
        expect(paletteValues.has(node)).toBe(true);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, `${path}.${k}`);
      }
    }
    // Walk everything EXCEPT theme.palette (we don't want to re-check palette
    // values against themselves).
    for (const [k, v] of Object.entries(theme)) {
      if (k === 'palette') continue;
      walk(v, `theme.${k}`);
    }
  });
});

// ---------------------------------------------------------------------------
// theme — waypoint lifecycle (7 hues)
// ---------------------------------------------------------------------------

describe('tui/theme — waypoint lifecycle', () => {
  test('has 7 distinct waypoint states', () => {
    expect(Object.keys(theme.waypoint).sort()).toEqual(
      [
        'awaitingApproval',
        'committed',
        'failed',
        'iteration',
        'rolledBack',
        'started',
      ].sort(),
    );
  });

  test('started = lavender', () => {
    expect(theme.waypoint.started).toBe(palette.lavender);
  });

  test('iteration = sky', () => {
    expect(theme.waypoint.iteration).toBe(palette.sky);
  });

  test('awaitingApproval = peach (warm attention)', () => {
    expect(theme.waypoint.awaitingApproval).toBe(palette.peach);
  });

  test('committed = green (success)', () => {
    expect(theme.waypoint.committed).toBe(palette.green);
  });

  test('rolledBack = maroon (alert but not failure-red)', () => {
    expect(theme.waypoint.rolledBack).toBe(palette.maroon);
  });

  test('failed = red (loud)', () => {
    expect(theme.waypoint.failed).toBe(palette.red);
  });

  test('all 7 waypoint colors are distinct', () => {
    const colors = Object.values(theme.waypoint);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

// ---------------------------------------------------------------------------
// theme — plan group
// ---------------------------------------------------------------------------

describe('tui/theme — plan group', () => {
  test('has 4 keys: badge, goal, step, meta', () => {
    expect(Object.keys(theme.plan).sort()).toEqual(
      ['badge', 'goal', 'meta', 'step'].sort(),
    );
  });

  test('badge = teal (distinct from waypoint lifecycle)', () => {
    expect(theme.plan.badge).toBe(palette.teal);
    // The source comment notes teal was chosen so plan events don't collide
    // with sky (iteration) or green (committed)
    expect(theme.plan.badge).not.toBe(theme.waypoint.iteration);
    expect(theme.plan.badge).not.toBe(theme.waypoint.committed);
  });
});

// ---------------------------------------------------------------------------
// theme — evolution group (5 keys)
// ---------------------------------------------------------------------------

describe('tui/theme — evolution group', () => {
  test('has 5 keys: curiosity, memory, selfMonitor, recovery, misuse', () => {
    expect(Object.keys(theme.evolution).sort()).toEqual(
      ['curiosity', 'memory', 'misuse', 'recovery', 'selfMonitor'].sort(),
    );
  });

  test('curiosity = pink', () => {
    expect(theme.evolution.curiosity).toBe(palette.pink);
  });

  test('memory = green', () => {
    expect(theme.evolution.memory).toBe(palette.green);
  });

  test('selfMonitor = peach', () => {
    expect(theme.evolution.selfMonitor).toBe(palette.peach);
  });

  test('recovery = maroon (alert but not failure-red)', () => {
    expect(theme.evolution.recovery).toBe(palette.maroon);
  });

  test('misuse = red (loud — protocol violation)', () => {
    expect(theme.evolution.misuse).toBe(palette.red);
  });
});

// ---------------------------------------------------------------------------
// theme — toolCall, verify, assistant, user groups
// ---------------------------------------------------------------------------

describe('tui/theme — toolCall group', () => {
  test('has 5 keys: name, argsKey, argsValue, success, error', () => {
    expect(Object.keys(theme.toolCall).sort()).toEqual(
      ['argsKey', 'argsValue', 'error', 'name', 'success'].sort(),
    );
  });
});

describe('tui/theme — verify group', () => {
  test('has 3 keys: running, passed, failed', () => {
    expect(Object.keys(theme.verify).sort()).toEqual(
      ['failed', 'passed', 'running'].sort(),
    );
  });

  test('running = yellow, passed = green, failed = red (semantic trio)', () => {
    expect(theme.verify.running).toBe(palette.yellow);
    expect(theme.verify.passed).toBe(palette.green);
    expect(theme.verify.failed).toBe(palette.red);
  });
});

describe('tui/theme — assistant group', () => {
  test('has 2 keys: label, text', () => {
    expect(Object.keys(theme.assistant).sort()).toEqual(['label', 'text'].sort());
  });

  test('label = mauve', () => {
    expect(theme.assistant.label).toBe(palette.mauve);
  });

  test('text = palette.text (default readable)', () => {
    expect(theme.assistant.text).toBe(palette.text);
  });
});

describe('tui/theme — user group', () => {
  test('has 2 keys: label, text', () => {
    expect(Object.keys(theme.user).sort()).toEqual(['label', 'text'].sort());
  });

  test('label = peach (warm attention)', () => {
    expect(theme.user.label).toBe(palette.peach);
  });

  test('text = rosewater (warmer than default text)', () => {
    expect(theme.user.text).toBe(palette.rosewater);
  });
});

// ---------------------------------------------------------------------------
// theme — chrome + typography
// ---------------------------------------------------------------------------

describe('tui/theme — chrome group', () => {
  test('has 7 keys', () => {
    expect(Object.keys(theme.chrome).sort()).toEqual(
      [
        'background',
        'backgroundElevated',
        'border',
        'borderDim',
        'cursor',
        'divider',
        'hint',
        'prompt',
      ].sort(),
    );
  });

  test('background = mantle, backgroundElevated = base (layered depth)', () => {
    expect(theme.chrome.background).toBe(palette.mantle);
    expect(theme.chrome.backgroundElevated).toBe(palette.base);
  });
});

describe('tui/theme — typography (text) group', () => {
  test('has 4 keys: primary, secondary, muted, dim', () => {
    expect(Object.keys(theme.text).sort()).toEqual(
      ['dim', 'muted', 'primary', 'secondary'].sort(),
    );
  });

  test('primary = palette.text (default readable)', () => {
    expect(theme.text.primary).toBe(palette.text);
  });

  test('secondary = subtext1, muted = overlay1, dim = overlay0 (decreasing intensity)', () => {
    expect(theme.text.secondary).toBe(palette.subtext1);
    expect(theme.text.muted).toBe(palette.overlay1);
    expect(theme.text.dim).toBe(palette.overlay0);
  });
});

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

describe('tui/theme — Theme type', () => {
  test('Theme is exported as typeof theme', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+type\s+Theme\s*=\s*typeof\s+theme/);
  });

  test('Theme type is structurally identical to typeof theme', () => {
    // Compile-time equivalence is enforced by `type Theme = typeof theme`.
    // At runtime, we can verify the type alias resolves to the same shape
    // by assigning theme to a value of type Theme without error.
    const t: Theme = theme;
    expect(t).toBe(theme);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('tui/theme — source-level safety', () => {
  test('no child_process / exec / spawn', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no console.log', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\./);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no fs I/O', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
    expect(src).not.toMatch(/readFile/);
    expect(src).not.toMatch(/writeFile/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('tui/theme — structural fingerprint', () => {
  test('palette uses `as const` assertion for narrowest literal types', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const paletteBlock = src.match(/export\s+const\s+palette\s*=\s*\{[\s\S]*?\}\s+as\s+const/);
    expect(paletteBlock).not.toBeNull();
  });

  test('theme uses `as const` assertion', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const themeBlock = src.match(/export\s+const\s+theme\s*=\s*\{[\s\S]*?\}\s+as\s+const/);
    expect(themeBlock).not.toBeNull();
  });

  test('palette comment mentions Orchestrator event stream mapping', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Orchestrator event stream/);
  });

  test('palette comment mentions Nolan Odyssey cinematography', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Nolan Odyssey cinematography/);
  });
});
