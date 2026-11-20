import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function appendTrace(path, partial) {
    await mkdir(dirname(path), { recursive: true });
    const record = {
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
        ...(partial.voyage_id !== undefined ? { voyage_id: partial.voyage_id } : {}),
    };
    const line = JSON.stringify(record) + '\n';
    await appendFile(path, line, 'utf8');
}
export async function readTrace(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch {
        return [];
    }
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const records = [];
    for (const line of lines) {
        try {
            records.push(JSON.parse(line));
        }
        catch {
            // Skip malformed line (defensive: corruption must not break the spike)
        }
    }
    return records;
}
//# sourceMappingURL=jsonl.js.map