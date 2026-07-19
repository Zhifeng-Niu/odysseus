import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotenv } from '../../src/util/dotenv.js';

describe('loadDotenv', () => {
  let workdir: string;
  let sandbox: Record<string, string | undefined>;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-env-'));
    sandbox = {};
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('returns empty object when file does not exist', () => {
    const result = loadDotenv(join(workdir, 'missing.env'), sandbox);
    expect(result).toEqual({});
  });

  test('parses simple KEY=VALUE pairs', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, 'ODYSSEUS_LLM_API_KEY=sk-abc\nMODEL=glm-5.2\n');
    const result = loadDotenv(path, sandbox);
    expect(result).toEqual({
      ODYSSEUS_LLM_API_KEY: 'sk-abc',
      MODEL: 'glm-5.2',
    });
    expect(sandbox.ODYSSEUS_LLM_API_KEY).toBe('sk-abc');
  });

  test('strips surrounding double quotes', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, 'KEY="value with spaces"\n');
    const result = loadDotenv(path, sandbox);
    expect(result.KEY).toBe('value with spaces');
  });

  test('strips surrounding single quotes', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, "KEY='value with spaces'\n");
    const result = loadDotenv(path, sandbox);
    expect(result.KEY).toBe('value with spaces');
  });

  test('skips blank lines and full-line comments', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, '# comment\n\nKEY=v\n   \n# trailing\n');
    const result = loadDotenv(path, sandbox);
    expect(result).toEqual({ KEY: 'v' });
  });

  test('trims whitespace around key and value', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, '   KEY   =   v   \n');
    const result = loadDotenv(path, sandbox);
    expect(result.KEY).toBe('v');
  });

  test('preserves existing target entries by default', () => {
    sandbox.EXISTING = 'from-shell';
    const path = join(workdir, '.env');
    return writeFile(path, 'EXISTING=from-file\nNEW=new\n').then(() => {
      const result = loadDotenv(path, sandbox);
      expect(sandbox.EXISTING).toBe('from-shell');
      expect(result.EXISTING).toBe('from-file');
      expect(sandbox.NEW).toBe('new');
    });
  });

  test('overrides existing target entries when preserveExisting is false', async () => {
    sandbox.EXISTING = 'from-shell';
    const path = join(workdir, '.env');
    await writeFile(path, 'EXISTING=from-file\n');
    loadDotenv(path, sandbox, { preserveExisting: false });
    expect(sandbox.EXISTING).toBe('from-file');
  });

  test('skips lines without =', async () => {
    const path = join(workdir, '.env');
    await writeFile(path, 'BARE\nKEY=v\n');
    const result = loadDotenv(path, sandbox);
    expect(result).toEqual({ KEY: 'v' });
  });
});
