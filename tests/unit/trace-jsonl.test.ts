import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTrace, readTrace } from '../../src/trace/jsonl.js';

describe('trace JSONL', () => {
  let workdir: string;
  let tracePath: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-trace-'));
    tracePath = join(workdir, 'trace.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('appendTrace writes one JSON line per record', async () => {
    await appendTrace(tracePath, { waypoint_id: 'wp_1', outcome: 'success' });
    await appendTrace(tracePath, { waypoint_id: 'wp_2', outcome: 'failure', fail_reason: 'tsc fail' });

    const raw = await readFile(tracePath, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as { waypoint_id: string; outcome: string };
    const second = JSON.parse(lines[1]!) as { waypoint_id: string; outcome: string };
    expect(first.waypoint_id).toBe('wp_1');
    expect(second.waypoint_id).toBe('wp_2');
  });

  test('readTrace returns parsed records in order', async () => {
    await appendTrace(tracePath, { waypoint_id: 'a' });
    await appendTrace(tracePath, { waypoint_id: 'b' });
    await appendTrace(tracePath, { waypoint_id: 'c' });

    const records = await readTrace(tracePath);
    expect(records.map((r) => r.waypoint_id)).toEqual(['a', 'b', 'c']);
  });

  test('readTrace on missing file returns empty array', async () => {
    const records = await readTrace(join(workdir, 'does-not-exist.jsonl'));
    expect(records).toEqual([]);
  });

  test('readTrace skips malformed lines (defensive)', async () => {
    await appendTrace(tracePath, { waypoint_id: 'good' });
    await appendFile(tracePath, 'not-json\n', 'utf8');
    await appendTrace(tracePath, { waypoint_id: 'after' });

    const records = await readTrace(tracePath);
    expect(records.map((r) => r.waypoint_id)).toEqual(['good', 'after']);
  });
});
