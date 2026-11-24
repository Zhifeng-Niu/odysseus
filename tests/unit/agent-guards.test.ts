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

    // 守卫已卸载——这次发射在进程层是「真·未处理拒绝」，vitest 的错误收集器
    // 会逮住它并把整个 run 的退出码打非零（2026-11-21 起污染 fitness 度量）。
    // 断言目标只是「不再上报到 seen」——临时挂一个吞咽 handler 隔离进程层。
    const swallow = (): void => {};
    process.on('unhandledRejection', swallow);
    try {
      process.emit('unhandledRejection', new Error('after uninstall'), Promise.resolve());
    } finally {
      process.off('unhandledRejection', swallow);
    }
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
