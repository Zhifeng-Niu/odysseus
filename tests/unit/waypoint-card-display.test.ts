/**
 * M4 真实会话 fixture 全量验收 — 用户 2026-11-20 voyage console 实跑的两次
 * 航点（「你好你是谁」聊天 + home-dir check-in 探测墙）的事件序列，经
 * M1/M3 分级渲染后必须：聊天=CHAT 无 ROLLBACK；探测错误全文浮出；成功
 * 工具调用折叠；全程信息无丢失。
 */
import { describe, test, expect } from 'vitest';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';
import { summarizeWaypoint } from '../../src/tui/waypoint-summary.js';
import { collapseToolCalls } from '../../src/tui/waypoint-summary.js';

// ── fixture 1：聊天航点（真实「你好你是谁」轮次的事件形态）──
const CHAT_EVENTS: readonly OrchestratorEvent[] = [
  { type: 'waypoint-started', waypointId: 'wp_mwpon9h8001', goal: '你好你是谁', strategy: 'engineer', ts: 1 },
  { type: 'waypoint-iteration', waypointId: 'wp_mwpon9h8001', iteration: 1, ts: 2 },
  {
    type: 'assistant-message',
    waypointId: 'wp_mwpon9h8001',
    content: '你好！我是 Odysseus，一个编码 agent，擅长写代码、修 bug、重构这类工程任务。',
    ts: 3,
  },
  {
    type: 'waypoint-rolled-back',
    waypointId: 'wp_mwpon9h8001',
    reason: 'conversational turn complete (no code task to perform)',
    iterationsUsed: 1,
    ts: 4,
  },
];

// ── fixture 2：home-dir check-in 探测墙（真实错误序列形态）──
const CHECKIN_EVENTS: readonly OrchestratorEvent[] = [
  { type: 'waypoint-started', waypointId: 'wp_mwponcgf002', goal: '[perception:clock] daily check-in', strategy: 'engineer', ts: 1 },
  {
    type: 'tool-call-started',
    waypointId: 'wp_mwponcgf002',
    callId: 'c1',
    tool: 'bash',
    args: { command: 'ls -la' },
    ts: 2,
  },
  { type: 'tool-call-completed', waypointId: 'wp_mwponcgf002', callId: 'c1', result: '', ok: false, ts: 3 },
  {
    type: 'tool-call-started',
    waypointId: 'wp_mwponcgf002',
    callId: 'c2',
    tool: 'git',
    args: { operation: 'status' },
    ts: 4,
  },
  { type: 'tool-call-completed', waypointId: 'wp_mwponcgf002', callId: 'c2', result: '', ok: false, ts: 5 },
  {
    type: 'assistant-message',
    waypointId: 'wp_mwponcgf002',
    content: 'Environment check complete — cwd (/Users/stbz) is not inside any repo.',
    ts: 6,
  },
  {
    type: 'waypoint-rolled-back',
    waypointId: 'wp_mwponcgf002',
    reason: 'conversational turn complete',
    iterationsUsed: 3,
    ts: 7,
  },
];

// ── fixture 3：连续成功工具调用（折叠目标）──
const OK_RUN_EVENTS: readonly OrchestratorEvent[] = [
  { type: 'waypoint-started', waypointId: 'wp_ok', goal: 'task', strategy: 'engineer', ts: 1 },
  {
    type: 'tool-call-started',
    waypointId: 'wp_ok',
    callId: 'c1',
    tool: 'file-read',
    args: { path: 'a.md' },
    ts: 2,
  },
  { type: 'tool-call-completed', waypointId: 'wp_ok', callId: 'c1', result: 'x', ok: true, ts: 3 },
  {
    type: 'tool-call-started',
    waypointId: 'wp_ok',
    callId: 'c2',
    tool: 'file-read',
    args: { path: 'b.md' },
    ts: 4,
  },
  { type: 'tool-call-completed', waypointId: 'wp_ok', callId: 'c2', result: 'y', ok: true, ts: 5 },
  { type: 'waypoint-committed', waypointId: 'wp_ok', sha: 'abc1234', iterationsUsed: 2, ts: 6 },
];

// 渲染契约由 M1/M3 的组件实现保证（CHAT 标签映射、CollapsedLine 摘要行）；
// 本文件用「分类 + 折叠」纯函数的组合断言验收真实会话的事件序列——
// ink-testing-library 的 JSX 渲染测试需要 .tsx，留给后续渲染重构。

describe('M4 真实会话 fixtures — 分级渲染契约', () => {
  test('聊天航点：状态=chat（标签由 STATUS_BADGE 映射为 CHAT，非 ROLLBACK）', () => {
    const s = summarizeWaypoint(CHAT_EVENTS);
    expect(s.status).toBe('chat');
  });

  test('check-in 探测墙：错误事件逐条保留（可归因），航点保持 rolled-back', () => {
    const s = summarizeWaypoint(CHECKIN_EVENTS);
    expect(s.status).toBe('rolled-back'); // 有工具调用的失败必须诚实显示
    const collapsed = collapseToolCalls(CHECKIN_EVENTS);
    // 两个 errored pair 不得被折叠进任何 collapsed 组
    const collapsedCounts = collapsed
      .filter((e) => 'type' in e && (e as { type?: string }).type === 'collapsed-tool-calls')
      .reduce((acc, e) => acc + (e as { count: number }).count, 0);
    expect(collapsedCounts).toBe(0);
    const errLines = collapsed.filter(
      (e) => 'type' in e && e.type === 'tool-call-completed' && (e as { ok?: boolean }).ok === false
    );
    expect(errLines).toHaveLength(2);
  });

  test('成功工具调用折叠：3 次调用 → 一行摘要，无逐条 ✓ 泄漏', () => {
    const collapsed = collapseToolCalls(OK_RUN_EVENTS);
    const groups = collapsed.filter(
      (e) => 'type' in e && (e as { type?: string }).type === 'collapsed-tool-calls'
    );
    expect(groups).toHaveLength(1);
    expect((groups[0] as { count: number }).count).toBe(2);
    const leakedOk = collapsed.filter(
      (e) => 'type' in e && e.type === 'tool-call-completed'
    );
    expect(leakedOk).toHaveLength(0);
  });
});
