import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serializeEntry, splitSections, parseEntry, } from './memory-parse.js';
// Re-export the parser symbols so existing importers do not need to know
// about the internal split. Same pattern as planner.ts re-exporting
// planner-policy.js (Iter 42), strategy.ts re-exporting strategy-prompt.js
// (Iter 51), and self-monitor.ts re-exporting self-monitor-patterns.js
// (Iter 48).
export { serializeEntry, splitSections, parseEntry } from './memory-parse.js';
const CATEGORY_FILE = {
    patterns: 'patterns.md',
    lessons: 'lessons.md',
    preferences: 'preferences.md',
    dreams: 'dreams.md',
};
const MEMORY_SUBDIR = 'memory';
function memoryFilePath(rootDir, category) {
    return join(rootDir, MEMORY_SUBDIR, CATEGORY_FILE[category]);
}
/**
 * Generate an 8-char hex id from timestamp + random. Good enough for spike —
 * collisions don't matter (entries are scoped by category file).
 */
function generateMemoryId() {
    const ts = Date.now().toString(16).slice(-6);
    const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return `mem_${ts}${rand}`;
}
export async function readMemory(rootDir, category) {
    let raw;
    try {
        raw = await readFile(memoryFilePath(rootDir, category), 'utf8');
    }
    catch {
        return []; // missing file = empty memory, not an error
    }
    const sections = splitSections(raw);
    const entries = [];
    for (const section of sections) {
        const entry = parseEntry(section, category);
        if (entry)
            entries.push(entry);
    }
    return entries;
}
export async function writeMemory(rootDir, input) {
    const entry = {
        id: input.id ?? generateMemoryId(),
        category: input.category,
        title: input.title,
        source: input.source,
        body: input.body,
        ts: input.ts ?? new Date().toISOString(),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.relatedWaypointId !== undefined
            ? { relatedWaypointId: input.relatedWaypointId }
            : {}),
    };
    const path = memoryFilePath(rootDir, entry.category);
    await mkdir(dirname(path), { recursive: true });
    const chunk = serializeEntry(entry) + '\n';
    await appendFile(path, chunk, 'utf8');
    return { id: entry.id, bytesWritten: Buffer.byteLength(chunk, 'utf8'), path };
}
export async function listMemory(rootDir) {
    const result = [];
    for (const category of Object.keys(CATEGORY_FILE)) {
        const path = memoryFilePath(rootDir, category);
        let bytes = 0;
        let entryCount = 0;
        try {
            const s = await stat(path);
            bytes = s.size;
            const entries = await readMemory(rootDir, category);
            entryCount = entries.length;
        }
        catch {
            // missing file = zero entries; keep defaults
        }
        result.push({ category, entryCount, bytes });
    }
    return result;
}
/**
 * Convenience: format all entries in a category as a single markdown blob,
 * suitable for direct injection into a system prompt. Returns empty string
 * if the category is empty/missing so callers can blindly concatenate.
 */
export async function readMemoryAsPromptContext(rootDir, category) {
    const entries = await readMemory(rootDir, category);
    if (entries.length === 0)
        return '';
    const header = `# Memory: ${category}\n\n`;
    const body = entries
        .map((e) => `## ${e.title}\n_source: ${e.source}, ts: ${e.ts}_\n\n${e.body}`)
        .join('\n\n---\n\n');
    return header + body;
}
//# sourceMappingURL=memory.js.map