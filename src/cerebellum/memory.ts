import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MemoryCategory } from '../orchestrator/events.js';

/**
 * Long-term memory store — the agent's "cortex".
 *
 * Memory is the lever that turns one-shot mistakes into permanent learning.
 * Without it, every waypoint failure is paid for in full again next time.
 * With it, the agent accumulates lessons, patterns, and preferences across
 * voyages.
 *
 * Physical shape: one markdown file per category under `{rootDir}/memory/`.
 * Each entry is a markdown `## section` so the file is both:
 *   - Human-readable (operator can `cat` it)
 *   - LLM-readable (drop directly into a system prompt)
 *
 * Append-only. We never rewrite history — forgetting is a separate, explicit
 * operation (not implemented yet; YAGNI).
 */

export type MemorySource = 'user' | 'dream' | 'reflect' | 'failure' | 'system';

export interface MemoryEntry {
  /** Stable identifier; format: `mem_<8 hex chars>` for grep-ability. */
  readonly id: string;
  readonly category: MemoryCategory;
  readonly title: string;
  readonly source: MemorySource;
  readonly body: string;
  readonly ts: string; // ISO 8601
  /** Optional tags for coarse-grained recall; LLM scans titles first. */
  readonly tags?: readonly string[];
  /** Waypoint that produced or motivated this entry (provenance). */
  readonly relatedWaypointId?: string;
}

export interface MemoryListEntry {
  readonly category: MemoryCategory;
  readonly entryCount: number;
  readonly bytes: number;
}

const CATEGORY_FILE: Record<MemoryCategory, string> = {
  patterns: 'patterns.md',
  lessons: 'lessons.md',
  preferences: 'preferences.md',
  dreams: 'dreams.md',
};

const MEMORY_SUBDIR = 'memory';

function memoryFilePath(rootDir: string, category: MemoryCategory): string {
  return join(rootDir, MEMORY_SUBDIR, CATEGORY_FILE[category]);
}

/**
 * Generate an 8-char hex id from timestamp + random. Good enough for spike —
 * collisions don't matter (entries are scoped by category file).
 */
function generateMemoryId(): string {
  const ts = Date.now().toString(16).slice(-6);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `mem_${ts}${rand}`;
}

/**
 * Serialize a single entry as a markdown section. The header line carries
 * metadata in a parseable but human-friendly form.
 */
function serializeEntry(entry: MemoryEntry): string {
  const safeTitle = entry.title.replace(/\n/g, ' ').trim();
  const header = `## [${entry.ts}] ${safeTitle}`;
  const meta: string[] = [`- **id**: ${entry.id}`, `- **source**: ${entry.source}`];
  if (entry.tags && entry.tags.length > 0) {
    meta.push(`- **tags**: ${entry.tags.join(', ')}`);
  }
  if (entry.relatedWaypointId) {
    meta.push(`- **related**: ${entry.relatedWaypointId}`);
  }
  return `${header}\n${meta.join('\n')}\n\n${entry.body.trim()}\n`;
}

interface ParsedSection {
  readonly header: string;
  readonly body: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Split markdown into top-level `## sections`. Returns raw slices; the
 * caller parses the header. Sections that don't start with `## ` are
 * treated as prelude (skipped).
 */
function splitSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentStart = -1;
  let currentHeader = '';

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith('## ')) {
      if (currentStart >= 0) {
        sections.push({
          header: currentHeader,
          body: lines.slice(currentStart, i).join('\n'),
          startIndex: currentStart,
          endIndex: i,
        });
      }
      currentStart = i;
      currentHeader = lines[i]!.slice(3);
    }
  }
  if (currentStart >= 0) {
    sections.push({
      header: currentHeader,
      body: lines.slice(currentStart).join('\n'),
      startIndex: currentStart,
      endIndex: lines.length,
    });
  }
  return sections;
}

/**
 * Parse a single section's metadata block back into a MemoryEntry. Tolerant
 * of missing fields — corrupt sections return null instead of throwing.
 */
function parseEntry(section: ParsedSection, category: MemoryCategory): MemoryEntry | null {
  const headerMatch = section.header.match(
    /^\[(?<ts>[^\]]+)\]\s*(?<title>.+)$/
  );
  if (!headerMatch?.groups) return null;
  const ts = headerMatch.groups.ts!;
  const title = headerMatch.groups.title!.trim();

  const idMatch = section.body.match(/- \*\*id\*\*:\s*(?<id>\S+)/);
  const sourceMatch = section.body.match(/- \*\*source\*\*:\s*(?<source>\S+)/);
  const tagsMatch = section.body.match(/- \*\*tags\*\*:\s*(?<tags>[^\n]+)/);
  const relatedMatch = section.body.match(/- \*\*related\*\*:\s*(?<related>\S+)/);

  if (!idMatch?.groups?.id || !sourceMatch?.groups?.source) return null;

  // Body is everything after the metadata block (first blank line after meta).
  const metaEndIdx = section.body.indexOf('\n\n');
  const body = metaEndIdx >= 0 ? section.body.slice(metaEndIdx + 2).trim() : '';

  return {
    id: idMatch.groups.id,
    category,
    title,
    source: sourceMatch.groups.source as MemorySource,
    body,
    ts,
    ...(tagsMatch?.groups?.tags
      ? { tags: tagsMatch.groups.tags.split(',').map((t) => t.trim()).filter(Boolean) }
      : {}),
    ...(relatedMatch?.groups?.related
      ? { relatedWaypointId: relatedMatch.groups.related }
      : {}),
  };
}

export async function readMemory(
  rootDir: string,
  category: MemoryCategory
): Promise<MemoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(memoryFilePath(rootDir, category), 'utf8');
  } catch {
    return []; // missing file = empty memory, not an error
  }
  const sections = splitSections(raw);
  const entries: MemoryEntry[] = [];
  for (const section of sections) {
    const entry = parseEntry(section, category);
    if (entry) entries.push(entry);
  }
  return entries;
}

export interface WriteMemoryResult {
  readonly id: string;
  readonly bytesWritten: number;
  readonly path: string;
}

export async function writeMemory(
  rootDir: string,
  input: Omit<MemoryEntry, 'id' | 'ts'> & { readonly id?: string; readonly ts?: string }
): Promise<WriteMemoryResult> {
  const entry: MemoryEntry = {
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

export async function listMemory(rootDir: string): Promise<MemoryListEntry[]> {
  const result: MemoryListEntry[] = [];
  for (const category of Object.keys(CATEGORY_FILE) as MemoryCategory[]) {
    const path = memoryFilePath(rootDir, category);
    let bytes = 0;
    let entryCount = 0;
    try {
      const s = await stat(path);
      bytes = s.size;
      const entries = await readMemory(rootDir, category);
      entryCount = entries.length;
    } catch {
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
export async function readMemoryAsPromptContext(
  rootDir: string,
  category: MemoryCategory
): Promise<string> {
  const entries = await readMemory(rootDir, category);
  if (entries.length === 0) return '';
  const header = `# Memory: ${category}\n\n`;
  const body = entries
    .map(
      (e) =>
        `## ${e.title}\n_source: ${e.source}, ts: ${e.ts}_\n\n${e.body}`
    )
    .join('\n\n---\n\n');
  return header + body;
}
