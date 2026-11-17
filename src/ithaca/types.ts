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

/** 单条保护核条目 */
export interface IthacaEntry {
  readonly id: string;
  readonly text: string;
  readonly addedAt: number;
}

/** 保护核分区 */
export type IthacaSection = 'tasks' | 'values' | 'identity';

/** 保护核完整状态（不可变，导出前冻结） */
export interface IthacaCoreState {
  readonly schema: 'ithaca.core.v1';
  readonly tasks: readonly IthacaEntry[];
  readonly values: readonly IthacaEntry[];
  readonly identity: readonly IthacaEntry[];
  readonly revision: number;
  readonly updatedAt: number;
}

/** 个人层 delta（provider/模型无关的可迁移格式，反重建） */
export interface IthacaDelta {
  readonly schema: 'ithaca.delta.v1';
  readonly exportedAt: number;
  /** 导出来源标识（框架/模型版本标签），不携带任何 provider 绑定 */
  readonly source: string;
  readonly core: IthacaCoreState;
}

/**
 * 写入通道。对话/推理路径没有这个字面量，
 * 因此 agent 管线在类型与运行时两层都无法改写保护核。
 */
export type IthacaWriteChannel = 'user-command' | 'delta-import';

/** 持久化后端接口（FileIthacaStore 为默认实现，测试可注入内存实现） */
export interface IthacaStore {
  load(): Promise<IthacaCoreState | null>;
  save(state: IthacaCoreState): Promise<void>;
}

/** 保护核事件类型（转发给 consciousness 流） */
export type IthacaEventType = 'ithaca.core_updated' | 'ithaca.delta_imported';

export type IthacaEventHandler = (
  type: IthacaEventType,
  data: Record<string, unknown>
) => void;

/** 保护核被违规写入时抛出 */
export class ProtectedCoreError extends Error {
  readonly code = 'ITHACA_PROTECTED';

  constructor(message: string) {
    super(message);
    this.name = 'ProtectedCoreError';
  }
}
