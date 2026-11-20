/**
 * Ithaca — 文件持久化后端
 *
 * 默认路径 ~/.odysseus/ithaca.json（可注入任意路径）。
 * 原子写：先写临时文件再 rename，避免半写状态（半写的保护核 = 假记忆）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { ProtectedCoreError } from './types.js';
import { validateIthacaCoreState } from './validate.js';
export const DEFAULT_ITHACA_PATH = (() => {
    try {
        return `${homedir()}/.odysseus/ithaca.json`;
    }
    catch {
        return '.odysseus/ithaca.json';
    }
})();
export class FileIthacaStore {
    filePath;
    constructor(filePath = DEFAULT_ITHACA_PATH) {
        this.filePath = filePath;
    }
    async load() {
        if (!existsSync(this.filePath)) {
            return null;
        }
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        }
        catch (error) {
            throw new ProtectedCoreError(`Ithaca core file is corrupt (${this.filePath}): ${error instanceof Error ? error.message : String(error)}`);
        }
        return validateIthacaCoreState(parsed);
    }
    async save(state) {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const tmp = `${this.filePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
        renameSync(tmp, this.filePath);
    }
}
//# sourceMappingURL=file-store.js.map