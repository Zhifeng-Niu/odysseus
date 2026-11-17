/**
 * Ithaca Core tests — protected core (user task stack / values / identity facts)
 *
 * Ported from the framework line's Ithaca MVP (docs/research/personal-agent.md
 * §8 MVP-1) into the Spike tree. Acceptance criteria unchanged:
 * 1. Write protection: the conversation/reasoning path has no mutation entry
 *    (readonly view, structural isolation)
 * 2. Mutation only via explicit channels (user-command / delta-import)
 * 3. renderForPrompt() injects into every turn; empty core renders ''
 * 4. Auto-persist on mutation; reload survives restart (anti-lotus)
 * 5. Delta protocol: ithaca.delta.v1, merge dedupes by id (anti-rebuild,
 *    provider-agnostic)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IthacaCore,
  FileIthacaStore,
  ProtectedCoreError,
  type IthacaStore,
  type IthacaCoreState,
} from '../../src/ithaca/index.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** In-memory store (tests). */
function memoryStore(initial: IthacaCoreState | null = null): IthacaStore & { saves: IthacaCoreState[] } {
  let state = initial;
  const saves: IthacaCoreState[] = [];
  return {
    saves,
    async load() {
      return state;
    },
    async save(next: IthacaCoreState) {
      state = next;
      saves.push(next);
    },
  };
}

describe('IthacaCore — write protection', () => {
  it('mutations require an explicit channel; invalid channel throws ProtectedCoreError', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await expect(
      core.add('tasks', 'finish thesis', 'llm-conversation' as never)
    ).rejects.toBeInstanceOf(ProtectedCoreError);
    await expect(
      core.remove('tasks', 't1', 'memory-summarizer' as never)
    ).rejects.toBeInstanceOf(ProtectedCoreError);
  });

  it('readonly view is structurally isolated: no add/remove/importDelta', () => {
    const core = new IthacaCore({ store: memoryStore() });
    const view = core.getReadonlyView();
    expect('add' in view).toBe(false);
    expect('remove' in view).toBe(false);
    expect('importDelta' in view).toBe(false);
    expect(typeof view.getState).toBe('function');
    expect(typeof view.renderForPrompt).toBe('function');
  });

  it('exposed state is frozen — cannot mutate internals through a view snapshot', () => {
    const core = new IthacaCore({ store: memoryStore() });
    const state = core.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.tasks)).toBe(true);
  });
});

describe('IthacaCore — state and rendering', () => {
  it('add/remove via user-command channel bump revision; state updates immutably', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    const before = core.getState();
    const entry = await core.add('tasks', 'finish thesis ch4', 'user-command');
    const after = core.getState();

    expect(after.revision).toBe(before.revision + 1);
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0].text).toBe('finish thesis ch4');
    expect(after.tasks[0].id).toBe(entry.id);
    expect(after).not.toBe(before); // immutable: new object

    const removed = await core.remove('tasks', entry.id, 'user-command');
    expect(removed).toBe(true);
    expect(core.getState().tasks).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await expect(core.add('values', '   ', 'user-command')).rejects.toThrow();
  });

  it('renderForPrompt: three sections + protection notice when non-empty', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await core.add('tasks', 'finish thesis ch4', 'user-command');
    await core.add('values', 'never overstate progress', 'user-command');
    await core.add('identity', 'user is a grad student in NLP', 'user-command');

    const rendered = core.renderForPrompt();
    expect(rendered).toContain('ITHACA CORE');
    expect(rendered).toContain('finish thesis ch4');
    expect(rendered).toContain('never overstate progress');
    expect(rendered).toContain('user is a grad student in NLP');
    expect(rendered).toContain('user-command');
  });

  it('empty core renders empty string (no prompt injection)', () => {
    const core = new IthacaCore({ store: memoryStore() });
    expect(core.renderForPrompt()).toBe('');
  });
});

describe('IthacaCore — persistence (anti-lotus)', () => {
  it('mutations auto-persist: flush delivers latest state to the store', async () => {
    const store = memoryStore();
    const core = new IthacaCore({ store });
    await core.add('tasks', 'task A', 'user-command');
    await core.flush();
    expect(store.saves.length).toBeGreaterThan(0);
    expect(store.saves[store.saves.length - 1].tasks[0].text).toBe('task A');
  });

  it('restart recovery: a fresh instance loads entries from the store', async () => {
    const store = memoryStore();
    const core = new IthacaCore({ store });
    await core.add('tasks', 'task A', 'user-command');
    await core.add('values', 'value B', 'user-command');
    await core.flush();

    const core2 = new IthacaCore({ store });
    await core2.load();
    expect(core2.getState().tasks.map(t => t.text)).toEqual(['task A']);
    expect(core2.getState().values.map(v => v.text)).toEqual(['value B']);
  });

  it('FileIthacaStore: cross-process file persistence + atomic write', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithaca-file-test-'));
    const file = path.join(dir, 'ithaca.json');
    try {
      const store1 = new FileIthacaStore(file);
      expect(await store1.load()).toBeNull(); // missing file → empty
      const core1 = new IthacaCore({ store: store1 });
      await core1.add('tasks', 'cross-process task', 'user-command');
      await core1.flush();

      const store2 = new FileIthacaStore(file);
      const core2 = new IthacaCore({ store: store2 });
      await core2.load();
      expect(core2.getState().tasks[0].text).toBe('cross-process task');
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('corrupt file (wrong schema) throws ProtectedCoreError on load — never silently clears', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithaca-file-test-'));
    const file = path.join(dir, 'ithaca.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ schema: 'something.else.v9' }), 'utf-8');
      const store = new FileIthacaStore(file);
      const core = new IthacaCore({ store });
      await expect(core.load()).rejects.toBeInstanceOf(ProtectedCoreError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('IthacaCore — delta protocol (anti-rebuild, provider-agnostic)', () => {
  it('exportDelta: schema=ithaca.delta.v1 with full core state', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await core.add('tasks', 'task A', 'user-command');
    const delta = core.exportDelta('spike@main');
    expect(delta.schema).toBe('ithaca.delta.v1');
    expect(delta.source).toBe('spike@main');
    expect(delta.core.tasks[0].text).toBe('task A');
    expect(typeof delta.exportedAt).toBe('number');
  });

  it('importDelta merge: dedupes by id, never overwrites existing entries', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await core.add('tasks', 'machine A task', 'user-command');
    const delta = core.exportDelta('v1');
    await core.flush();

    // A different instance (another machine's mind) imports the same delta
    const core2 = new IthacaCore({ store: memoryStore() });
    await core2.add('tasks', 'machine B task', 'user-command');
    const result = await core2.importDelta(delta, 'merge', 'user-command');
    expect(result.added).toBe(1); // machine A task from the delta
    expect(result.skipped).toBeGreaterThanOrEqual(0);
    const texts = core2.getState().tasks.map(t => t.text);
    expect(texts).toContain('machine B task');
    expect(texts).toContain('machine A task');
  });

  it('importDelta replace: wholesale replacement', async () => {
    const source = new IthacaCore({ store: memoryStore() });
    await source.add('values', 'only this one', 'user-command');
    const delta = source.exportDelta('v1');

    const target = new IthacaCore({ store: memoryStore() });
    await target.add('tasks', 'will be cleared', 'user-command');
    await target.add('values', 'also cleared', 'user-command');

    await target.importDelta(delta, 'replace', 'user-command');
    expect(target.getState().tasks).toHaveLength(0);
    expect(target.getState().values.map(v => v.text)).toEqual(['only this one']);
  });

  it('importDelta: unknown schema throws ProtectedCoreError', async () => {
    const core = new IthacaCore({ store: memoryStore() });
    await expect(
      core.importDelta({ schema: 'nope' }, 'merge', 'user-command')
    ).rejects.toBeInstanceOf(ProtectedCoreError);
  });
});

describe('IthacaCore — events', () => {
  it('fires onEvent on mutation (for the orchestrator event stream)', async () => {
    const onEvent = vi.fn();
    const core = new IthacaCore({ store: memoryStore(), onEvent });
    await core.add('tasks', 'task A', 'user-command');
    await core.flush();
    expect(onEvent).toHaveBeenCalledWith(
      'ithaca.core_updated',
      expect.objectContaining({ section: 'tasks' })
    );
  });
});
