/**
 * `odysseus init` — 一句话部署的落地端（OpenClaw/Hermes 式 one-command setup）。
 *
 * runInit：纯流程（.env 写入、~/.odysseus 种子、live key 验证、报告），
 * 全部 I/O 可注入 → 测试零网络零 TTY。
 * runInitCli：argv/stdin/readline 适配层，index.ts 在 loadConfig 之前分发
 * （init 本身不需要 key）。
 *
 * 部署两路：①人类：curl -fsSL …/install.sh | bash（脚本结尾调 odysseus init）；
 * ②给任何编码 agent 的一句话（README「一句话部署」节）。
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { GLMProvider } from './llm/glm.js';
import { loadDotenv } from './util/dotenv.js';

export interface InitIo {
  prompt(text: string): Promise<string>;
  out(text: string): void;
}

export interface PingResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface InitOptions {
  /** Where .env lives (the checkout / install dir). */
  readonly cwd: string;
  /** Home for the personal-layer store (~/.odysseus). Injectable for tests. */
  readonly homeDir?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Overwrite an existing .env (default: preserve). */
  readonly force?: boolean;
  /** Injectable live key check (defaults to one tiny GLM call). */
  readonly ping?: (apiKey: string, baseUrl: string, model: string) => Promise<PingResult>;
  readonly io: InitIo;
}

export interface InitReport {
  readonly envWritten: boolean;
  readonly envSkipped: boolean;
  readonly verified: boolean;
  readonly verifyError?: string;
  readonly steps: readonly string[];
}

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const CODING_PLAN_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';

const SELF_MODEL_TEMPLATE = `# Self-Model — Odysseus（个人 agent）

我是用户的 personal agent：任务核心 + 极强记忆 + 诚实优先。
编码是我的工具之一，不是我的全部——生活任务（报告/计划/提醒/日程）
同样是我的主场。做法：先在 .odysseus/acceptance.json 声明验收
（artifact 层，逐条可机械检查），再动手产出，绝不自评通过。

保护核（任务栈/价值观）只经用户显式命令（/ithaca）修改。
我的记忆靠 lesson 复利：每次失败都会沉淀为可检索的教训。
`;

function envFile(apiKey: string, baseUrl: string, model: string): string {
  return [
    `ODYSSEUS_LLM_API_KEY=${apiKey}`,
    `ODYSSEUS_LLM_MODEL=${model}`,
    `ODYSSEUS_LLM_BASE_URL=${baseUrl}`,
    '',
  ].join('\n');
}

export async function runInit(options: InitOptions): Promise<InitReport> {
  const { cwd, io } = options;
  const homeDir = options.homeDir ?? homedir();
  const steps: string[] = [];

  // 1. API key — flag > prompt (prompt only helps when a human is attached;
  //    headless runs land the placeholder and init stays unverified).
  let apiKey = options.apiKey ?? '';
  if (!apiKey) {
    apiKey = (await io.prompt('GLM API key（直接回车可跳过，稍后写入 .env）: ')).trim();
  }
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const model = options.model ?? 'glm-5.2';

  // 2. .env — preserve an existing one unless --force (re-init must not
  //    silently clobber a working key).
  const envPath = join(cwd, '.env');
  let envWritten = false;
  let envSkipped = false;
  if (existsSync(envPath) && !options.force) {
    envSkipped = true;
    steps.push('保留现有 .env（--force 可覆盖）');
  } else {
    writeFileSync(envPath, envFile(apiKey, baseUrl, model), 'utf8');
    envWritten = true;
    steps.push(`写入 ${envPath}`);
  }

  // 3. Personal-layer store seed (~/.odysseus) — /ithaca 与 delta 协议的家。
  const storeDir = join(homeDir, '.odysseus');
  mkdirSync(storeDir, { recursive: true });
  steps.push(`个人层目录 ${storeDir} 就绪`);

  // M2 personal identity seed — the engineer strategy loads
  // {cwd}/.odysseus/self-model.md fresh at every waypoint; a fresh install
  // gets the personal-agent identity (an evolved self-model is never
  // clobbered — it belongs to the agent, not to setup).
  const selfModelPath = join(cwd, '.odysseus', 'self-model.md');
  if (!existsSync(selfModelPath)) {
    mkdirSync(join(cwd, '.odysseus'), { recursive: true });
    writeFileSync(selfModelPath, SELF_MODEL_TEMPLATE, 'utf8');
    steps.push(`个人 self-model 种子 ${selfModelPath}`);
  }

  // 4. Live key verification — one tiny call; a failure never aborts setup
  //    (the env is still written; the human fixes the key and re-runs).
  let verified = false;
  let verifyError: string | undefined;
  if (apiKey) {
    const ping = options.ping ?? defaultPing;
    try {
      const result = await ping(apiKey, baseUrl, model);
      verified = result.ok;
      if (!result.ok) verifyError = result.error ?? 'unknown';
    } catch (err) {
      verifyError = err instanceof Error ? err.message : String(err);
    }
    steps.push(verified ? 'key 验证通过（live ping ok）' : `key 验证失败：${verifyError ?? 'unknown'}`);
  } else {
    steps.push('未提供 key，跳过验证（agent 对话与 /ithaca 仍可用）');
  }

  for (const step of steps) io.out(`✓ ${step}`);
  io.out(
    verified
      ? '\nOdysseus 就绪：odysseus "任务" 跑单任务；TTY 无参数启动 voyage console。'
      : '\nOdysseus 已安装但未验证：把正确的 key 填进 .env 后重跑 odysseus init。'
  );

  return { envWritten, envSkipped, verified, ...(verifyError !== undefined ? { verifyError } : {}), steps };
}

async function defaultPing(apiKey: string, baseUrl: string, model: string): Promise<PingResult> {
  try {
    const provider = new GLMProvider({ apiKey, model, baseUrl });
    // Reasoning models (GLM-5.2) can burn a tiny max_tokens budget entirely
    // on thinking and return empty content — give the ping real room.
    const completion = await provider.complete('回复ok', { maxTokens: 512 });
    return completion.content.length > 0 ? { ok: true } : { ok: false, error: 'empty reply' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// CLI adapter — argv + readline; dispatched by index.ts before loadConfig.
// ---------------------------------------------------------------------------

export async function runInitCli(_userInput: string): Promise<void> {
  const cwd = process.cwd();
  loadDotenv(join(cwd, '.env'));

  const args = process.argv.slice(2).filter((a) => a !== 'init' && a !== 'setup');
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  let baseUrl = flag('--base-url') ?? process.env.ODYSSEUS_LLM_BASE_URL;
  let apiKey = flag('--api-key') ?? process.env.ODYSSEUS_LLM_API_KEY;

  const readline = await import('node:readline/promises');
  const isTTY = process.stdin.isTTY === true;
  const rl = isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const io: InitIo = {
    prompt: async (text) => (rl ? await rl.question(text) : ''),
    out: (text) => console.log(text),
  };

  // Coding-plan keys (GLM Coding Plan) are NOT valid on the standard
  // endpoint — docs.bigmodel.cn/cn/coding-plan/quick-start. Ask once when a
  // human is attached and no explicit base URL was given.
  if (!baseUrl && isTTY && !apiKey) {
    const answer = (
      await io.prompt(
        `key 类型？[1] 标准 API（默认 ${DEFAULT_BASE_URL}） [2] GLM Coding Plan（${CODING_PLAN_BASE_URL}）: `
      )
    ).trim();
    if (answer === '2') baseUrl = CODING_PLAN_BASE_URL;
  }
  if (!apiKey && !isTTY) {
    io.out('非交互环境：请用 --api-key 或环境变量提供 key，或稍后手动填写 .env。');
  }

  const model = flag('--model') ?? process.env.ODYSSEUS_LLM_MODEL;
  const report = await runInit({
    cwd: resolve(cwd),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(model !== undefined ? { model } : {}),
    force: args.includes('--force'),
    io,
  });
  if (rl) rl.close();

  if (!report.verified) process.exitCode = 1;
}
