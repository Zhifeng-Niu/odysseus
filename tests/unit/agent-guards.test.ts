/**
 * Process guards — the "does not crash" half of the mission acceptance
 * line. An unhandled rejection or uncaught exception in a long-running
 * TUI session must be reported and absorbed, never take the process down
 * (Node's default for unhandledRejection is a crash in modern runtimes).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installProcessGuards } from '../../src/agent/guards.js';

const seen: Array<{ kind: string; message: string }> = [];
let installed: { uninstall: () => void } | null = null;

afterEach(() => {
  installed?.uninstall();
  installed = null;
  seen.length = 0;
});

describe('installProcessGuards', () => {
  it('absorbs unhandledRejection and reports it through onError', () => {
    installed = installProcessGuards({
      onError: (kind, err) => seen.push({ kind, message: err.message }),
    });

    process.emit('unhandledRejection', new Error('stray rejection'), Promise.resolve());
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('unhandledRejection');
    expect(seen[0].message).toBe('stray rejection');
  });

  it('absorbs uncaughtException and reports it through onError', () => {
    installed = installProcessGuards({
      onError: (kind, err) => seen.push({ kind, message: err.message }),
    });

    process.emit('uncaughtException', new Error('stray exception'));
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('uncaughtException');
    expect(seen[0].message).toBe('stray exception');
  });

  it('uninstall restores the previous behavior (no more reporting)', () => {
    installed = installProcessGuards({
      onError: (kind, err) => seen.push({ kind, message: err.message }),
    });
    installed.uninstall();
    installed = null;

    process.emit('unhandledRejection', new Error('after uninstall'), Promise.resolve());
    expect(seen).toHaveLength(0);
  });

  it('is idempotent: installing twice does not double-report', () => {
    const onError = (kind: string, err: Error): void => {
      seen.push({ kind, message: err.message });
    };
    const first = installProcessGuards({ onError });
    const second = installProcessGuards({ onError });

    process.emit('unhandledRejection', new Error('once'), Promise.resolve());
    expect(seen).toHaveLength(1);

    first.uninstall();
    second.uninstall();
    installed = null;
  });
});
