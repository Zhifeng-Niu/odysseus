import { execFile } from 'node:child_process';
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
export function execFileNoThrow(file, args, options = {}) {
    return new Promise((resolve) => {
        const onAbort = () => child.kill('SIGTERM');
        const cleanup = () => {
            if (options.signal) {
                options.signal.removeEventListener('abort', onAbort);
            }
        };
        const child = execFile(file, [...args], {
            cwd: options.cwd,
            env: options.env,
            maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
            timeout: options.timeoutMs,
            signal: options.signal,
        }, (err, stdout, stderr) => {
            cleanup();
            if (err) {
                const errnoCode = err.code;
                resolve({
                    exitCode: typeof err.code === 'number' ? err.code : -1,
                    stdout: typeof stdout === 'string' ? stdout : '',
                    stderr: typeof stderr === 'string' && stderr.length > 0
                        ? stderr
                        : `${errnoCode ?? 'error'}: ${err.message}`,
                    command: file,
                    args,
                });
            }
            else {
                resolve({
                    exitCode: 0,
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    command: file,
                    args,
                });
            }
        });
        if (options.signal) {
            options.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
//# sourceMappingURL=exec.js.map