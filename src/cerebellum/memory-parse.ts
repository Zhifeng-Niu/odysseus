import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry, MemorySource } from './memory.js';

/**
 * Pure markdown (de)serialization for the long-term memory store —
 * extracted from memory.ts (Iteration 53).
 *
 * These functions contain no I/O and no side effects — they transform
 * between the structured `MemoryEntry` shape and the on-disk markdown
 * section format. Pulling them out shrinks memory.ts toward storage
 * primitives (read/write/list) and makes the parser independently
 * testable.
 *
 * Mirrors Iter 42 (planner-policy), Iter 44 (curiosity-prompt),
 * Iter 47 (dreamer-prompt), Iter 48 (self-monitor-patterns),
 * Iter 51 (strategy-prompt): extract a cohesive concern to a sibling
 * so the host module shrinks toward its primary responsibility.
 *
 * Type-only imports (`import type`) erase at compile time, so the
 * reference back to `./memory.js` does not create a runtime cycle.
 */

/**
 * Intermediate shape from `splitSections`: a raw markdown slice with
 * its header line and line-range, ready for `parseEntry` to consume.
 */
export interface ParsedSection {
  readonly header: string;
  readonly body: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Serialize a single entry as a markdown section. The header line carries
 * metadata in a parseable but human-friendly form.
 */
export function serializeEntry(entry: MemoryEntry): string {
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

/**
 * Split markdown into top-level `## sections`. Returns raw slices; the
 * caller parses the header. Sections that don't start with `## ` are
 * treated as prelude (skipped).
 */
export function splitSections(markdown: string): ParsedSection[] {
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
export function parseEntry(
  section: ParsedSection,
  category: MemoryCategory,
): MemoryEntry | null {
  const headerMatch = section.header.match(
    /^\[(?<ts>[^\]]+)\]\s*(?<title>.+)$/,
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
