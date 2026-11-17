/**
 * /ithaca command surface — the ONLY explicit write channel into the
 * protected core. Conversation paths can never reach this module.
 *
 * Covers: empty-core hint, add/show/rm round trip, cross-command persistence
 * (same rootDir shares one core instance), delta export/import between two
 * rootDirs, and invalid-section errors.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleIthacaCommand } from '../../src/ithaca/commands.js';

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ithaca-cmd-'));
}

describe('handleIthacaCommand', () => {
  it('empty core shows the hint, not an error', async () => {
    const root = createTempRoot();
    try {
      const out = await handleIthacaCommand(root, '');
      expect(out).toContain('ITHACA CORE');
      expect(out).toContain('add tasks');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('add → show → rm round trip persists across invocations (same rootDir)', async () => {
    const root = createTempRoot();
    try {
      const added = await handleIthacaCommand(root, 'add tasks 完成硕士论文第四章');
      expect(added).toContain('✓');

      const shown = await handleIthacaCommand(root, 'show');
      expect(shown).toContain('完成硕士论文第四章');
      expect(shown).toContain('任务栈');

      // id prefix from the show output
      const idMatch = shown.match(/\[([0-9a-f]{8})\]/);
      expect(idMatch).not.toBeNull();

      const removed = await handleIthacaCommand(root, `rm tasks ${idMatch![1]}`);
      expect(removed).toContain('✓');

      const after = await handleIthacaCommand(root, 'show');
      expect(after).not.toContain('完成硕士论文第四章');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('invalid section is rejected with the valid section list', async () => {
    const root = createTempRoot();
    try {
      const out = await handleIthacaCommand(root, 'add diary 写日记');
      expect(out).toContain('✗');
      expect(out).toContain('tasks');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('export → import into another rootDir (delta migrates the personal layer)', async () => {
    const rootA = createTempRoot();
    const rootB = createTempRoot();
    try {
      await handleIthacaCommand(rootA, 'add values 不夸大进度');
      const exported = await handleIthacaCommand(rootA, 'export');
      expect(exported).toContain('ithaca.delta.v1');

      const deltaFile = path.join(rootA, 'ithaca-delta.json');
      expect(fs.existsSync(deltaFile)).toBe(true);

      const imported = await handleIthacaCommand(rootB, `import ${deltaFile}`);
      expect(imported).toContain('✓');

      const shownB = await handleIthacaCommand(rootB, 'show');
      expect(shownB).toContain('不夸大进度');
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });
});
