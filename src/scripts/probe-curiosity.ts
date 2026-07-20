#!/usr/bin/env node
/**
 * Live curiosity probe — verifies the curiosity phase works end-to-end with
 * a real GLM-5.2 call. Run after `npm run build`:
 *
 *   node dist/scripts/probe-curiosity.js
 *
 * Loads .env, sets ODYSSEUS_AUTO_APPROVE=0 (so proposals stay in pending-
 * review.json for inspection), runs one curiosity pass, prints the result.
 */
import { resolve, join } from 'node:path';
import { curiosity } from '../cerebellum/curiosity.js';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { readTrace } from '../trace/jsonl.js';
import { readMemory } from '../cerebellum/memory.js';
import { loadDotenv } from '../util/dotenv.js';

loadDotenv(join(process.cwd(), '.env'));

const rootDir = resolve(process.cwd(), '.odysseus');
const tracePath = resolve(rootDir, 'trace.jsonl');

const cfg = loadConfig();
const provider = new GLMProvider({
  apiKey: cfg.apiKey,
  model: cfg.model,
  baseUrl: cfg.baseUrl,
});

const recentTrace = await readTrace(tracePath);
const categories = ['patterns', 'lessons', 'preferences', 'dreams'] as const;
const memorySnapshot = await Promise.all(
  categories.map(async (category) => ({
    category,
    entries: await readMemory(rootDir, category),
  }))
);

console.log(`=== Curiosity Probe ===`);
console.log(`trace records: ${recentTrace.length}`);
console.log(`memory categories:`);
for (const snap of memorySnapshot) {
  console.log(`  ${snap.category}: ${snap.entries.length} entries`);
}
console.log();

// Consent-gate: keep proposals in pending-review.json for inspection.
process.env.ODYSSEUS_AUTO_APPROVE = '0';

const result = await curiosity({
  rootDir,
  provider,
  recentTrace,
  memorySnapshot,
});

console.log(`parseOk: ${result.parseOk}`);
console.log(`parseError: ${result.parseError ?? '-'}`);
console.log(`backlogItemsAdded: ${result.backlogItemsAdded}`);
console.log(`backlogItemsSkipped: ${result.backlogItemsSkipped}`);
console.log(`memoryEntriesAdded: ${result.memoryEntriesAdded}`);
console.log(`durationMs: ${result.durationMs}`);
console.log();
console.log(`=== Added backlog items ===`);
for (const item of result.addedBacklogItems) {
  console.log(`  [${item.priority}] ${item.goal}`);
}
console.log();
console.log(`=== Added memory entries ===`);
for (const entry of result.addedMemoryEntries) {
  console.log(`  [${entry.category}] ${entry.title}`);
}
console.log();
console.log(`=== Raw response (first 1200 chars) ===`);
console.log(result.rawResponse.slice(0, 1200));
