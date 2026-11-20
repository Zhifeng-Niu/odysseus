/**
 * Ithaca Core — 保护核实现
 *
 * 结构性写保护：agent 管线只持有 getReadonlyView() 返回的只读视图
 * （getState/renderForPrompt），变更方法只暴露给命令层与 delta 导入。
 */
import { randomUUID } from 'node:crypto';
import { ProtectedCoreError } from './types.js';
import { validateIthacaCoreState } from './validate.js';
const SECTIONS = ['tasks', 'values', 'identity'];
/** 空核状态 */
export function emptyIthacaState(now = Date.now()) {
    return deepFreeze({
        schema: 'ithaca.core.v1',
        tasks: [],
        values: [],
        identity: [],
        revision: 0,
        updatedAt: now,
    });
}
function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
        Object.freeze(value);
    }
    return value;
}
export class IthacaCore {
    state;
    store;
    onEvent;
    now;
    idgen;
    pendingSave = Promise.resolve();
    lastSaveError = null;
    view;
    constructor(options = {}) {
        this.store = options.store;
        this.onEvent = options.onEvent;
        this.now = options.now ?? Date.now;
        this.idgen = options.idgen ?? (() => randomUUID());
        this.state = emptyIthacaState(this.now());
        this.view = {
            getState: () => this.getState(),
            renderForPrompt: () => this.renderForPrompt(),
        };
    }
    /** 从持久化后端载入。文件不存在保持空核；schema 不符抛 ProtectedCoreError（不静默清空） */
    async load() {
        if (!this.store)
            return;
        const loaded = await this.store.load();
        if (loaded === null)
            return;
        this.state = deepFreeze(validateIthacaCoreState(loaded));
    }
    getState() {
        return this.state;
    }
    /** 只读视图：不含任何变更方法，交给 prompt 管线 */
    getReadonlyView() {
        return this.view;
    }
    /** 新增条目。仅显式通道可写。 */
    async add(section, text, via) {
        this.assertChannel(via);
        const trimmed = text.trim();
        if (!trimmed) {
            throw new ProtectedCoreError('Ithaca entry text must be non-empty');
        }
        const entry = Object.freeze({
            id: this.idgen(),
            text: trimmed,
            addedAt: this.now(),
        });
        this.state = deepFreeze({
            ...this.state,
            [section]: [...this.state[section], entry],
            revision: this.state.revision + 1,
            updatedAt: this.now(),
        });
        this.scheduleSave();
        this.emit('ithaca.core_updated', { section, action: 'add', id: entry.id });
        return entry;
    }
    /** 删除条目。返回是否真的删了。 */
    async remove(section, id, via) {
        this.assertChannel(via);
        const entries = this.state[section];
        if (!entries.some(e => e.id === id)) {
            return false;
        }
        this.state = deepFreeze({
            ...this.state,
            [section]: entries.filter(e => e.id !== id),
            revision: this.state.revision + 1,
            updatedAt: this.now(),
        });
        this.scheduleSave();
        this.emit('ithaca.core_updated', { section, action: 'remove', id });
        return true;
    }
    /** 渲染进每次 reasoning 的保护核块。空核返回空串（不注入）。 */
    renderForPrompt() {
        const lines = [
            'ITHACA CORE — 用户的任务栈与锚点（受保护层；仅用户显式命令可改写；与本层冲突时以本层为准）',
        ];
        const sectionHeaders = {
            tasks: '任务栈:',
            values: '价值观:',
            identity: '身份:',
        };
        let hasContent = false;
        for (const section of SECTIONS) {
            const entries = this.state[section];
            if (entries.length === 0)
                continue;
            hasContent = true;
            lines.push(sectionHeaders[section]);
            for (const entry of entries) {
                lines.push(`- ${entry.text}`);
            }
        }
        return hasContent ? lines.join('\n') : '';
    }
    /** 导出个人层 delta（provider/模型无关） */
    exportDelta(source) {
        return Object.freeze({
            schema: 'ithaca.delta.v1',
            exportedAt: this.now(),
            source,
            core: this.state,
        });
    }
    /**
     * 导入 delta。
     * - merge：按 id 去重，已有条目不动
     * - replace：整核替换为目标 delta 的核心状态
     */
    async importDelta(delta, mode, via) {
        this.assertChannel(via);
        const parsed = validateIthacaDelta(delta);
        if (mode === 'replace') {
            this.state = deepFreeze({
                ...parsed.core,
                revision: this.state.revision + 1,
                updatedAt: this.now(),
            });
            this.scheduleSave();
            this.emit('ithaca.delta_imported', { mode, added: this.countEntries(), skipped: 0 });
            return { added: this.countEntries(), skipped: 0 };
        }
        let added = 0;
        let skipped = 0;
        const nextSections = {};
        for (const section of SECTIONS) {
            const existing = this.state[section];
            const incomingIds = new Set(existing.map(e => e.id));
            const additions = [];
            for (const entry of parsed.core[section]) {
                if (incomingIds.has(entry.id)) {
                    skipped += 1;
                }
                else {
                    additions.push(Object.freeze({ ...entry }));
                    incomingIds.add(entry.id);
                    added += 1;
                }
            }
            nextSections[section] = [...existing, ...additions];
        }
        this.state = deepFreeze({
            ...this.state,
            ...nextSections,
            revision: this.state.revision + 1,
            updatedAt: this.now(),
        });
        this.scheduleSave();
        this.emit('ithaca.delta_imported', { mode, added, skipped });
        return { added, skipped };
    }
    /** 等待挂起的落盘完成；落盘失败则抛出 */
    async flush() {
        await this.pendingSave;
        if (this.lastSaveError) {
            const err = this.lastSaveError;
            this.lastSaveError = null;
            throw err;
        }
    }
    assertChannel(via) {
        if (via !== 'user-command' && via !== 'delta-import') {
            throw new ProtectedCoreError(`Ithaca Core is write-protected: conversation/reasoning paths cannot mutate it (got channel "${String(via)}")`);
        }
    }
    scheduleSave() {
        if (!this.store)
            return;
        this.pendingSave = this.pendingSave.then(async () => {
            try {
                await this.store.save(this.state);
            }
            catch (error) {
                this.lastSaveError = error;
            }
        });
    }
    countEntries() {
        return this.state.tasks.length + this.state.values.length + this.state.identity.length;
    }
    emit(type, data) {
        this.onEvent?.(type, data);
    }
}
function validateIthacaDelta(delta) {
    if (!delta || typeof delta !== 'object') {
        throw new ProtectedCoreError('Ithaca delta must be an object');
    }
    const record = delta;
    if (record.schema !== 'ithaca.delta.v1') {
        throw new ProtectedCoreError(`Unknown delta schema: ${String(record.schema)} — expected "ithaca.delta.v1"`);
    }
    const core = validateIthacaCoreState(record.core);
    return { core };
}
//# sourceMappingURL=ithaca-core.js.map