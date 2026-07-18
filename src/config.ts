export interface OdysseusConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  debug: boolean;
}

export interface RawEnv {
  ODYSSEUS_LLM_API_KEY?: string;
  ODYSSEUS_LLM_MODEL?: string;
  ODYSSEUS_LLM_BASE_URL?: string;
  ODYSSEUS_DEBUG?: string;
}

export function loadConfig(env: RawEnv = process.env): OdysseusConfig {
  const apiKey = env.ODYSSEUS_LLM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ODYSSEUS_LLM_API_KEY is required. Copy .env.example to .env and fill in your GLM-5.2 API key.'
    );
  }

  return {
    apiKey,
    model: env.ODYSSEUS_LLM_MODEL?.trim() || 'glm-5.2',
    baseUrl: env.ODYSSEUS_LLM_BASE_URL?.trim() || 'https://open.bigmodel.cn/api/paas/v4',
    debug: parseBool(env.ODYSSEUS_DEBUG, false),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}
