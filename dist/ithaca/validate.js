/**
 * Ithaca — 状态校验
 *
 * 外部数据（文件/delta 导入）进入保护核前的唯一入口：
 * schema 不符一律抛 ProtectedCoreError，绝不静默降级（静默清空 = 食莲）。
 */
import { ProtectedCoreError } from './types.js';
const SECTIONS = ['tasks', 'values', 'identity'];
/** 校验并返回规范化的保护核状态（浅规范化，不冻结——由 IthacaCore 统一冻结） */
export function validateIthacaCoreState(value) {
    if (!value || typeof value !== 'object') {
        throw new ProtectedCoreError('Ithaca core state must be an object');
    }
    const record = value;
    if (record.schema !== 'ithaca.core.v1') {
        throw new ProtectedCoreError(`Unknown ithaca core schema: ${String(record.schema)} — expected "ithaca.core.v1"`);
    }
    if (typeof record.revision !== 'number' || typeof record.updatedAt !== 'number') {
        throw new ProtectedCoreError('Ithaca core state missing revision/updatedAt');
    }
    const sections = {};
    for (const section of SECTIONS) {
        const raw = record[section];
        if (!Array.isArray(raw)) {
            throw new ProtectedCoreError(`Ithaca section "${section}" must be an array`);
        }
        sections[section] = raw.map(validateEntry);
    }
    return {
        schema: 'ithaca.core.v1',
        tasks: sections.tasks ?? [],
        values: sections.values ?? [],
        identity: sections.identity ?? [],
        revision: record.revision,
        updatedAt: record.updatedAt,
    };
}
function validateEntry(value) {
    if (!value || typeof value !== 'object') {
        throw new ProtectedCoreError('Ithaca entry must be an object');
    }
    const record = value;
    if (typeof record.id !== 'string' || typeof record.text !== 'string' || typeof record.addedAt !== 'number') {
        throw new ProtectedCoreError('Ithaca entry requires string id/text and numeric addedAt');
    }
    return { id: record.id, text: record.text, addedAt: record.addedAt };
}
//# sourceMappingURL=validate.js.map