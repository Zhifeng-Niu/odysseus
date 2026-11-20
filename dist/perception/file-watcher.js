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
import { generatePerceptionId } from './types.js';
const IGNORED_NAMES = new Set(['node_modules', '.git', 'dist', '.odysseus']);
export function createFileWatcher(roots, options = {}) {
    const ignored = new Set(options.ignored ?? IGNORED_NAMES);
    let baseline = null;
    function snapshot() {
        const files = new Map();
        const walk = (dir) => {
            let entries;
            try {
                entries = readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return; // unreadable/unreachable root — skip silently
            }
            for (const entry of entries) {
                if (ignored.has(entry.name))
                    continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                }
                else if (entry.isFile()) {
                    try {
                        files.set(full, statSync(full).mtimeMs);
                    }
                    catch {
                        // raced deletion — skip
                    }
                }
            }
        };
        for (const root of roots)
            walk(root);
        return files;
    }
    return {
        channel: 'file',
        roots,
        reset() {
            baseline = null;
        },
        collect(now) {
            const current = snapshot();
            if (baseline === null) {
                baseline = current;
                return [];
            }
            const events = [];
            for (const [file, mtime] of current) {
                const previous = baseline.get(file);
                if (previous === undefined) {
                    events.push(makeEvent('created', `file created: ${relativeLabel(file)}`, now));
                }
                else if (previous !== mtime) {
                    events.push(makeEvent('changed', `file changed: ${relativeLabel(file)}`, now));
                }
            }
            baseline = current;
            return events;
        },
    };
}
function makeEvent(kind, summary, now) {
    return {
        id: generatePerceptionId(),
        channel: 'file',
        kind,
        summary,
        ts: now.getTime(),
    };
}
function relativeLabel(file) {
    // Label relative to cwd when possible so backlog goals stay short.
    try {
        return relative(process.cwd(), file) || file;
    }
    catch {
        return file;
    }
}
//# sourceMappingURL=file-watcher.js.map