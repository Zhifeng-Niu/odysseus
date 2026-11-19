/**
 * Process guards — the "does not crash" half of the acceptance line.
 *
 * Modern Node crashes the process on an unhandledRejection and on an
 * uncaughtException. For a long-running personal agent that is the worst
 * failure mode (rule: never vanish on the user). The guards absorb both,
 * report through a single callback, and are reference-counted so nested
 * installers (entry point + tests) cannot double-report.
 *
 * Deliberate policy: the guards NEVER call process.exit. Recovery/exit
 * decisions belong to the caller surface (TUI stays alive; the CLI turn
 * loop ends on its own error handling).
 */

export type GuardKind = 'unhandledRejection' | 'uncaughtException';

export interface ProcessGuardsOptions {
  onError: (kind: GuardKind, err: Error) => void;
}

export interface InstalledGuards {
  uninstall: () => void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

let refCount = 0;
let active: {
  onRejection: (err: unknown) => void;
  onException: (err: unknown) => void;
} | null = null;

export function installProcessGuards(options: ProcessGuardsOptions): InstalledGuards {
  // Idempotent: the first installer owns the real handlers; nested
  // installers just hold a reference so uninstall ordering stays correct.
  refCount += 1;
  if (refCount > 1 || active !== null) {
    return { uninstall: () => void --refCount };
  }

  const onRejection = (err: unknown): void => {
    options.onError('unhandledRejection', asError(err));
  };
  const onException = (err: unknown): void => {
    options.onError('uncaughtException', asError(err));
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  active = { onRejection, onException };

  return {
    uninstall: (): void => {
      refCount -= 1;
      if (refCount <= 0 && active !== null) {
        process.off('unhandledRejection', active.onRejection);
        process.off('uncaughtException', active.onException);
        active = null;
        refCount = 0;
      }
    },
  };
}
