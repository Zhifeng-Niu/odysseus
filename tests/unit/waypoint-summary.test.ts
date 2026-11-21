/**
 * M1 航点显示分级 — summarize 纯函数抽取 + CHAT 分类。
 *
 * 用户实测（2026-11-20 voyage console）：纯聊天航点（零工具调用）被标
 * ROLLBACK——「聊天」被显示成了一次失败回滚。规则：rolled-back + 零工具
 * 调用 + 有 assistant 回复 = CHAT（对话完成，不是失败）；有任何工具调用
 * 的失败航点保持 ROLLBACK（那是真的行动失败，必须诚实显示）。
 */
import { describe, test, expect } from 'vitest';
import { summarizeWaypoint, type WaypointSummary } from '../../src/tui/waypoint-summary.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';

function chatSessionEvents(): readonly OrchestratorEvent[] {
  return [
    { type: 'waypoint-started', waypointId: 'wp_chat', goal: '你好你是谁', strategy: 'engineer', ts: 1 },
    { type: 'waypoint-iteration', waypointId: 'wp_chat', iteration: 1, ts: 2 },
    {
      type: 'assistant-message',
      waypointId: 'wp_chat',
      content: '你好！我是 Odysseus，一个编码 agent。',
      ts: 3,
    },
    { type: 'waypoint-rolled-back', waypointId: 'wp_chat', reason: 'conversational', iterationsUsed: 1, ts: 4 },
  ];
}

describe('summarizeWaypoint — CHAT classification', () => {
  test('rolled-back + zero tool calls + assistant reply → chat', () => {
    const s = summarizeWaypoint(chatSessionEvents());
    expect(s.status).toBe('chat');
    expect(s.iterationsUsed).toBe(1);
  });

  test('rolled-back WITH tool calls stays rolled-back (honest failure)', () => {
    const events: readonly OrchestratorEvent[] = [
      { type: 'waypoint-started', waypointId: 'wp_t', goal: 'g', strategy: 'engineer', ts: 1 },
      {
        type: 'tool-call-started',
        waypointId: 'wp_t',
        callId: 'c1',
        tool: 'bash',
        args: { command: 'ls' },
        ts: 2,
      },
      { type: 'tool-call-completed', waypointId: 'wp_t', callId: 'c1', result: '', ok: false, ts: 3 },
      { type: 'assistant-message', waypointId: 'wp_t', content: '环境检查失败', ts: 4 },
      { type: 'waypoint-rolled-back', waypointId: 'wp_t', reason: 'verify failed', iterationsUsed: 3, ts: 5 },
    ];
    const s = summarizeWaypoint(events);
    expect(s.status).toBe('rolled-back');
    expect(s.failReason).toContain('verify failed');
  });

  test('committed waypoint stays committed (chat rule never overrides real work)', () => {
    const events: readonly OrchestratorEvent[] = [
      { type: 'waypoint-started', waypointId: 'wp_c', goal: 'g', strategy: 'engineer', ts: 1 },
      { type: 'waypoint-committed', waypointId: 'wp_c', sha: 'abc1234', iterationsUsed: 2, ts: 2 },
    ];
    const s = summarizeWaypoint(events);
    expect(s.status).toBe('committed');
    expect(s.commitSha).toBe('abc1234');
  });

  test('failed waypoint stays failed', () => {
    const events: readonly OrchestratorEvent[] = [
      { type: 'waypoint-started', waypointId: 'wp_f', goal: 'g', strategy: 'engineer', ts: 1 },
      { type: 'waypoint-failed', waypointId: 'wp_f', error: 'boom', ts: 2 },
    ];
    expect(summarizeWaypoint(events).status).toBe('failed');
  });

  test('awaiting-approval stays awaiting-approval', () => {
    const events: readonly OrchestratorEvent[] = [
      { type: 'waypoint-started', waypointId: 'wp_a', goal: 'g', strategy: 'engineer', ts: 1 },
      { type: 'waypoint-awaiting-approval', waypointId: 'wp_a', iteration: 1, ts: 2 },
    ];
    expect(summarizeWaypoint(events).status).toBe('awaiting-approval');
  });

  test('pure-function contract: input not mutated', () => {
    const events = chatSessionEvents();
    const snapshot = JSON.stringify(events);
    summarizeWaypoint(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});

// ─── M3 常规折叠·错误浮出 ──────────────────────────────────────────────
import { collapseToolCalls } from '../../src/tui/waypoint-summary.js';

function started(i: number, tool = 'file-read'): OrchestratorEvent {
  return { type: 'tool-call-started', waypointId: 'w', callId: `c${i}`, tool, args: {}, ts: i };
}
function completed(i: number, ok: boolean): OrchestratorEvent {
  return { type: 'tool-call-completed', waypointId: 'w', callId: `c${i}`, result: '', ok, ts: i };
}

describe('collapseToolCalls — ok runs collapse, errors surface', () => {
  test('three consecutive ok tool calls → one collapsed group', () => {
    const events = [started(1), completed(1, true), started(2), completed(2, true), started(3), completed(3, true)];
    const out = collapseToolCalls(events);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'collapsed-tool-calls', count: 3 });
  });

  test('an errored call breaks the run — error events stay full', () => {
    const events = [started(1), completed(1, true), started(2), completed(2, false)];
    const out = collapseToolCalls(events);
    // ok pair collapses; the errored pair stays as raw events
    const collapsed = out.filter((e) => (e as { type?: string }).type === 'collapsed-tool-calls');
    const raw = out.filter((e) => (e as { type?: string }).type === 'tool-call-started');
    expect(collapsed).toHaveLength(1);
    expect(raw.length).toBeGreaterThanOrEqual(1);
  });

  test('assistant message breaks the run (never swallowed)', () => {
    const events = [
      started(1),
      completed(1, true),
      { type: 'assistant-message', waypointId: 'w', content: 'answer', ts: 5 } as OrchestratorEvent,
      started(2),
      completed(2, true),
    ];
    const out = collapseToolCalls(events);
    const kinds = out.map((e) => (e as { type?: string }).type);
    expect(kinds).toContain('assistant-message');
    expect(kinds.filter((k) => k === 'collapsed-tool-calls')).toHaveLength(2);
  });

  test('empty input → empty output', () => {
    expect(collapseToolCalls([])).toHaveLength(0);
  });
});
