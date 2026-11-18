/**
 * FileWatcherChannel — environment perception via mtime snapshots.
 *
 * Snapshot-based rather than fs.watch-based: scan() is pure and
 * deterministic (no callback races, testable without timers); a runtime
 * caller can simply poll collect() on an interval. The first scan builds
 * the baseline silently — without this, the first perception of a large
 * project would flood the backlog with "created" events for a world the
 * agent never saw change.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { generatePerceptionId, type PerceptionChannelAdapter, type PerceptionEvent } from './types.js';

const IGNORED_NAMES = new Set(['node_modules', '.git', 'dist', '.odysseus']);

export interface FileWatcherOptions {
  /** Ignored directory/file names. Defaults cover build artifacts and VCS. */
  ignored?: readonly string[];
}

export interface FileWatcherChannel extends PerceptionChannelAdapter {
  readonly channel: 'file';
  /** Paths currently watched (as given). */
  readonly roots: readonly string[];
  /** Drop the baseline so the next collect() re-anchors silently. */
  reset(): void;
}

export function createFileWatcher(
  roots: readonly string[],
  options: FileWatcherOptions = {}
): FileWatcherChannel {
  const ignored: ReadonlySet<string> = new Set(options.ignored ?? IGNORED_NAMES);
  let baseline: Map<string, number> | null = null;

  function snapshot(): Map<string, number> {
    const files = new Map<string, number>();
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // unreadable/unreachable root — skip silently
      }
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            files.set(full, statSync(full).mtimeMs);
          } catch {
            // raced deletion — skip
          }
        }
      }
    };
    for (const root of roots) walk(root);
    return files;
  }

  return {
    channel: 'file',
    roots,
    reset(): void {
      baseline = null;
    },
    collect(now: Date): PerceptionEvent[] {
      const current = snapshot();
      if (baseline === null) {
        baseline = current;
        return [];
      }

      const events: PerceptionEvent[] = [];
      for (const [file, mtime] of current) {
        const previous = baseline.get(file);
        if (previous === undefined) {
          events.push(
            makeEvent('created', `file created: ${relativeLabel(file)}`, now)
          );
        } else if (previous !== mtime) {
          events.push(
            makeEvent('changed', `file changed: ${relativeLabel(file)}`, now)
          );
        }
      }
      baseline = current;
      return events;
    },
  };
}

function makeEvent(kind: string, summary: string, now: Date): PerceptionEvent {
  return {
    id: generatePerceptionId(),
    channel: 'file',
    kind,
    summary,
    ts: now.getTime(),
  };
}

function relativeLabel(file: string): string {
  // Label relative to cwd when possible so backlog goals stay short.
  try {
    return relative(process.cwd(), file) || file;
  } catch {
    return file;
  }
}
