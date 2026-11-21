/**
 * M1 航点显示分级 — waypoint 事件的纯函数汇总（无 ink 依赖，Node 直测）。
 *
 * CHAT 分类规则：航点以 rolled-back 收尾、全程零工具调用、且有 assistant
 * 回复 → 这是一次**对话完成**，不是失败——标签 CHAT。有任何工具调用的
 * rolled-back 保持 ROLLBACK（那是真实的行动失败，必须诚实显示）。
 *
 * 抽取自 waypoint-card.tsx（原 summarize 内联在组件里无法直测）。
 */
export function summarizeWaypoint(events) {
    let status = 'active';
    let iterationsUsed = 0;
    let commitSha;
    let failReason;
    let toolCallCount = 0;
    let hasAssistantReply = false;
    for (const e of events) {
        if (e.type === 'waypoint-iteration') {
            iterationsUsed = Math.max(iterationsUsed, e.iteration);
        }
        else if (e.type === 'waypoint-awaiting-approval') {
            status = 'awaiting-approval';
        }
        else if (e.type === 'waypoint-committed') {
            status = 'committed';
            commitSha = e.sha;
            iterationsUsed = e.iterationsUsed;
        }
        else if (e.type === 'waypoint-rolled-back') {
            status = 'rolled-back';
            failReason = e.reason;
            iterationsUsed = e.iterationsUsed;
        }
        else if (e.type === 'waypoint-failed') {
            status = 'failed';
            failReason = e.error;
        }
        else if (e.type === 'tool-call-started') {
            toolCallCount += 1;
        }
        else if (e.type === 'assistant-message') {
            hasAssistantReply = true;
        }
    }
    // CHAT: conversational completion — nothing was attempted, so "rollback"
    // would read as a failure that never happened.
    if (status === 'rolled-back' && toolCallCount === 0 && hasAssistantReply) {
        status = 'chat';
    }
    return {
        status,
        iterationsUsed,
        ...(commitSha !== undefined ? { commitSha } : {}),
        ...(failReason !== undefined ? { failReason } : {}),
    };
}
/**
 * Collapse consecutive SUCCESSFUL tool-call pairs into one summary group;
 * anything else (assistant, verify, approval, errored calls) passes through
 * untouched — errors must surface verbatim. A collapsed group is a distinct
 * item; the renderer draws it as one dim line.
 */
export function collapseToolCalls(events) {
    const out = [];
    let okCount = 0;
    const tools = {};
    let pendingStarted = null;
    const flushOkRun = () => {
        if (okCount > 0) {
            out.push({ type: 'collapsed-tool-calls', count: okCount, tools: { ...tools } });
            okCount = 0;
            for (const key of Object.keys(tools))
                delete tools[key];
        }
    };
    for (const event of events) {
        if (event.type === 'tool-call-started') {
            if (pendingStarted) {
                // Dangling started (never completed) — surface raw, flush the ok run.
                flushOkRun();
                out.push(pendingStarted.event);
            }
            pendingStarted = { tool: event.tool, event };
            continue;
        }
        if (event.type === 'tool-call-completed') {
            if (event.ok && pendingStarted) {
                okCount += 1;
                tools[pendingStarted.tool] = (tools[pendingStarted.tool] ?? 0) + 1;
                pendingStarted = null;
                continue;
            }
            // Errored completion (or completed without a held started): surface raw.
            flushOkRun();
            out.push(event);
            continue;
        }
        flushOkRun();
        if (pendingStarted) {
            out.push(pendingStarted.event);
            pendingStarted = null;
        }
        out.push(event);
    }
    flushOkRun();
    if (pendingStarted)
        out.push(pendingStarted.event);
    return out;
}
//# sourceMappingURL=waypoint-summary.js.map