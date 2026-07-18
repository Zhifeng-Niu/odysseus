import { execFile } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  args: readonly string[];
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export function execFileNoThrow(
  file: string,
  args: readonly string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        timeout: options.timeoutMs,
        signal: options.signal,
      },
      (err, stdout, stderr) => {
        if (err) {
          const errnoCode = (err as NodeJS.ErrnoException).code;
          resolve({
            exitCode: typeof err.code === 'number' ? err.code : -1,
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr:
              typeof stderr === 'string' && stderr.length > 0
                ? stderr
                : `${errnoCode ?? 'error'}: ${err.message}`,
            command: file,
            args,
          });
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            command: file,
            args,
          });
        }
      }
    );
    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          child.kill('SIGTERM');
        },
        { once: true }
      );
    }
  });
}
