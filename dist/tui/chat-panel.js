import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { WaypointCard } from './waypoint-card.js';
import { theme } from './theme.js';
/**
 * Scan the event log and produce:
 *   1. The list of `PlanRecord`s (plan-completed → step waypoints).
 *   2. The waypoint groups, each tagged with planStepInfo when it belongs
 *      to a plan.
 *
 * The join is order-sensitive: a plan's steps are the next N waypoints
 * started after the plan-completed event, regardless of goal text. This
 * mirrors the orchestrator's enqueue-then-drain execution model.
 *
 * If a plan's steps never fully start (e.g. user interrupted mid-voyage),
 * the partially-filled PlanRecord is still returned so the banner can show
 * "decomposed into N, only M ran".
 */
function derivePlansAndGroups(events) {
    const plans = [];
    const groups = new Map();
    // Active plan being filled: steps claimed so far, total expected.
    let activePlan = null;
    for (const e of events) {
        if (e.type === 'plan-completed') {
            // Flush any in-progress plan (its steps were never fully started).
            if (activePlan !== null) {
                plans.push(activePlan);
                activePlan = null;
            }
            activePlan = {
                planGoal: e.goal,
                stepCount: e.stepCount,
                durationMs: e.durationMs,
                parseOk: e.parseOk,
                ts: e.ts,
                stepWaypointIds: [],
            };
            continue;
        }
        if (!('waypointId' in e))
            continue;
        // Maintain the waypoint group (existing logic).
        const existing = groups.get(e.waypointId);
        if (existing) {
            existing.events.push(e);
            if (e.type === 'waypoint-started') {
                existing.goal = e.goal;
                existing.strategy = e.strategy;
            }
        }
        else {
            groups.set(e.waypointId, {
                waypointId: e.waypointId,
                goal: e.type === 'waypoint-started' ? e.goal : '(unknown goal)',
                strategy: e.type === 'waypoint-started' ? e.strategy : 'engineer',
                events: [e],
            });
        }
        // Claim waypoint-started events for the active plan.
        if (e.type === 'waypoint-started' && activePlan !== null) {
            activePlan.stepWaypointIds.push(e.waypointId);
            const idx = activePlan.stepWaypointIds.length; // 1-based
            const group = groups.get(e.waypointId);
            if (group !== undefined) {
                group.planStepInfo = {
                    current: idx,
                    total: activePlan.stepCount,
                    planGoal: activePlan.planGoal,
                };
            }
            if (activePlan.stepWaypointIds.length >= activePlan.stepCount) {
                plans.push(activePlan);
                activePlan = null;
            }
        }
    }
    // Flush trailing plan (e.g. still in progress, or voyage ended mid-plan).
    if (activePlan !== null) {
        plans.push(activePlan);
    }
    return { plans, groups: Array.from(groups.values()) };
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
function deriveEvolutionFeed(events) {
    const entries = [];
    for (const e of events) {
        if (e.type === 'curiosity-completed') {
            const parts = [];
            parts.push(`+${e.backlogItemsAdded} backlog`);
            if (e.memoryEntriesAdded > 0) {
                parts.push(`+${e.memoryEntriesAdded} memory`);
            }
            parts.push(formatDuration(e.durationMs));
            entries.push({
                kind: 'curiosity',
                ts: e.ts,
                text: parts.join(' · '),
            });
        }
        else if (e.type === 'memory-consolidated') {
            entries.push({
                kind: 'memory',
                ts: e.ts,
                text: `${e.category} · ${e.entryCount} entr${e.entryCount === 1 ? 'y' : 'ies'} · ${formatBytes(e.bytesWritten)}`,
            });
        }
    }
    return entries;
}
function formatBytes(n) {
    if (n < 1024)
        return `${n}B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
const EVOLUTION_ICON = {
    curiosity: '🔍',
    memory: '🧠',
};
function EvolutionFeed({ entries }) {
    if (entries.length === 0)
        return _jsx(_Fragment, {});
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.text.muted, bold: true, children: "Self-evolution" }), entries.map((entry, i) => {
                const color = entry.kind === 'curiosity' ? theme.evolution.curiosity : theme.evolution.memory;
                return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: color, children: EVOLUTION_ICON[entry.kind] }), _jsx(Text, { color: color, bold: true, children: entry.kind === 'curiosity' ? 'CURIOSITY' : 'MEMORY' }), _jsx(Text, { color: theme.text.secondary, children: entry.text })] }, `evo-${entry.ts}-${i}`));
            })] }));
}
function truncateGoal(goal, max) {
    if (goal.length <= max)
        return goal;
    return goal.slice(0, max - 1) + '…';
}
/**
 * Banner shown above the waypoint list when a `plan-completed` event has
 * fired. Renders one line per plan, in order:
 *
 *   🧩 PLAN · 2 steps · 342ms · ok
 *     refactor the parser module
 *
 * The icon `🧩` signals decomposition. Teal badge (theme.plan.badge) so the
 * eye picks plan events out from the lavender/sky waypoint stream.
 */
function PlanBanner({ plan }) {
    const parts = [];
    parts.push(_jsx(Text, { color: theme.plan.badge, bold: true, children: "\uD83E\uDDE9 PLAN" }, "label"));
    parts.push(_jsxs(Text, { color: theme.plan.meta, children: [plan.stepCount, " step", plan.stepCount === 1 ? '' : 's'] }, "meta"));
    parts.push(_jsx(Text, { color: theme.text.muted, children: "\u00B7" }, "dot1"));
    parts.push(_jsx(Text, { color: theme.plan.meta, children: formatDuration(plan.durationMs) }, "dur"));
    parts.push(_jsx(Text, { color: theme.text.muted, children: "\u00B7" }, "dot2"));
    parts.push(_jsx(Text, { color: plan.parseOk ? theme.plan.badge : theme.waypoint.failed, children: plan.parseOk ? 'ok' : 'parse-fail' }, "ok"));
    const ran = plan.stepWaypointIds.length;
    if (ran < plan.stepCount) {
        parts.push(_jsx(Text, { color: theme.text.muted, children: "\u00B7" }, "dot3"));
        parts.push(_jsxs(Text, { color: theme.waypoint.awaitingApproval, children: [ran, "/", plan.stepCount, " ran"] }, "partial"));
    }
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Box, { flexDirection: "row", gap: 1, children: parts }), _jsxs(Text, { color: theme.plan.goal, children: ["  ", truncateGoal(plan.planGoal, 100)] })] }));
}
/**
 * Renders the unified conversation surface: every user input (chat or code
 * task) enters the orchestrator and surfaces here as a waypoint group.
 *
 * Iteration 16: also renders PlanBanner(s) above the waypoint stream when
 * the planner decomposed a seed goal. The banner is the user-facing proof
 * that the planner ran — without it, a 5-step plan just looks like 5
 * unrelated waypoints.
 *
 * Prior to the 2026-07-21 unification, ChatPanel rendered two parallel
 * surfaces: a "conversation" array for chat path messages and waypoint
 * groups for code-task path. The split caused identity loss on the chat
 * path (the agent fell back to its base-model identity because no Odysseus
 * context loaded). Now there is one surface — every interaction is a
 * waypoint, some are 1-turn conversational waypoints, some are multi-turn
 * code-task waypoints. The agent is always the same agent.
 */
export function ChatPanel({ events }) {
    const { plans, groups } = derivePlansAndGroups(events);
    const evolutionFeed = deriveEvolutionFeed(events);
    const hasWaypoints = groups.length > 0;
    const hasPlans = plans.length > 0;
    const hasEvolution = evolutionFeed.length > 0;
    return (_jsxs(Box, { flexDirection: "column", children: [!hasWaypoints && !hasPlans && !hasEvolution && (_jsx(Text, { color: theme.text.muted, children: "Chat with the agent, or describe a code change to start a voyage." })), hasPlans && (_jsx(Box, { flexDirection: "column", children: plans.map((p, i) => (_jsx(PlanBanner, { plan: p }, `plan-${p.ts}-${i}`))) })), hasWaypoints && (_jsx(Box, { flexDirection: "column", children: groups.map((g) => (_jsx(WaypointCard, { waypointId: g.waypointId, goal: g.goal, strategy: g.strategy, events: g.events, ...(g.planStepInfo !== undefined ? { planStepInfo: g.planStepInfo } : {}) }, g.waypointId))) })), hasEvolution && _jsx(EvolutionFeed, { entries: evolutionFeed })] }));
}
//# sourceMappingURL=chat-panel.js.map