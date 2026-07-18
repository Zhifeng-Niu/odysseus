import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TraceRecord {
  ts: string;
  waypoint_id: string;
  goal: string;
  strategy: string;
  parent: string | null;
  outcome: 'success' | 'failure' | 'abandoned';
  checkpoint_sha: string | null;
  iterations_used: number;
  tokens_consumed: { input: number; output: number };
  verify_result: Record<string, string>;
  fail_reason: string | null;
  diff_summary: string | null;
}

export async function appendTrace(
  path: string,
  partial: Partial<TraceRecord> & { waypoint_id: string }
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const record: TraceRecord = {
    ts: new Date().toISOString(),
    waypoint_id: partial.waypoint_id,
    goal: partial.goal ?? '',
    strategy: partial.strategy ?? 'engineer',
    parent: partial.parent ?? null,
    outcome: partial.outcome ?? 'success',
    checkpoint_sha: partial.checkpoint_sha ?? null,
    iterations_used: partial.iterations_used ?? 0,
    tokens_consumed: partial.tokens_consumed ?? { input: 0, output: 0 },
    verify_result: partial.verify_result ?? {},
    fail_reason: partial.fail_reason ?? null,
    diff_summary: partial.diff_summary ?? null,
  };
  const line = JSON.stringify(record) + '\n';
  await appendFile(path, line, 'utf8');
}

export async function readTrace(path: string): Promise<TraceRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const records: TraceRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      // Skip malformed line (defensive: corruption must not break the spike)
    }
  }
  return records;
}
