/**
 * Ithaca — 保护核类型定义
 *
 * Ithaca Core 是用户任务栈、价值观锚点与身份事实的受保护层：
 * - agent 对话路径没有写入入口（结构性隔离，见 ReadonlyIthacaView）
 * - 变更只能走显式通道：user-command（CLI/TUI/API 显式命令）或 delta-import
 * - 每次变更自动持久化（反食莲），可导出 delta 跨模型/框架迁移（反重建）
 *
 * 参见 docs/research/personal-agent.md §5/§8
 */
/** 保护核被违规写入时抛出 */
export class ProtectedCoreError extends Error {
    code = 'ITHACA_PROTECTED';
    constructor(message) {
        super(message);
        this.name = 'ProtectedCoreError';
    }
}
//# sourceMappingURL=types.js.map