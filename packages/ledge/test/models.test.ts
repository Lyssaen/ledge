import { describe, it, expect } from 'vitest';
import { claudeModels, codexConfig, createModels, parseCodexModels, parseCursorModels, type ModelsRun } from '../src/daemon/models.js';

const levels = (...e: string[]) => e.map(effort => ({ effort, description: effort }));
const CODEX = JSON.stringify({ models: [
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Workhorse.', default_reasoning_level: 'low', supported_reasoning_levels: levels('low', 'medium', 'ultra'), visibility: 'list', priority: 1 },
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', default_reasoning_level: 'low', supported_reasoning_levels: levels('low', 'max'), visibility: 'list', priority: 2 },
  { slug: 'gpt-daybreak', display_name: 'Daybreak', visibility: 'hide', priority: 0 },
  { slug: '--evil', display_name: 'Evil', visibility: 'list', priority: 3 }
] });

describe('models (#58)', () => {
  it('Claude: the aliases, the settings model as default, or added when it is a full name', () => {
    expect(claudeModels().map(m => m.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(claudeModels().some(m => m.isDefault)).toBe(false);
    expect(claudeModels('opus').find(m => m.isDefault)?.id).toBe('opus');
    expect(claudeModels('claude-opus-5-5').at(-1)).toMatchObject({ id: 'claude-opus-5-5', isDefault: true });
    expect(claudeModels()[0]!.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
  it('Codex: listed models by priority with their efforts; config.toml marks the default and the starting effort', () => {
    const models = parseCodexModels(CODEX, { model: 'gpt-6-astra', effort: 'medium' });
    expect(models.map(m => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
    expect(models[0]).toEqual({ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Workhorse.', efforts: ['low', 'medium', 'ultra'], defaultEffort: 'medium' });
    // The configured effort only where the model takes it.
    expect(models[1]).toEqual({ id: 'gpt-6-astra', label: 'GPT-6-Astra', efforts: ['low', 'max'], defaultEffort: 'low', isDefault: true });
    expect(() => parseCodexModels('{"x":1}')).toThrow();
  });
  it('Codex config: the top-level keys only', () => {
    expect(codexConfig('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n[profiles.x]\nmodel = "other"\n')).toEqual({ model: 'gpt-6.1-sol', effort: 'medium' });
    expect(codexConfig('[profiles.x]\nmodel = "other"\n')).toEqual({});
  });
  it('Cursor: id - Label rows, the (default) one marked, colour and zero-width marks dropped', () => {
    const text = 'Available models\n\nauto - Auto (default)\n\x1b[2mgpt-5.3-codex-high - Codex 5.3 High\x1b[0m\ngrok-4.7-low-fast - Grok 4.7  Low Fast​​\nTip: use --model\n';
    expect(parseCursorModels(text)).toEqual([
      { id: 'auto', label: 'Auto', isDefault: true },
      { id: 'gpt-5.3-codex-high', label: 'Codex 5.3 High' },
      { id: 'grok-4.7-low-fast', label: 'Grok 4.7  Low Fast' }
    ]);
  });
  it('asks each agent once per TTL and once at a time, never keeps a failure, reads the configs from the agent env', async () => {
    let t = 0; const runs: string[] = []; let fail = true;
    const run: ModelsRun = async (file, args) => { runs.push([file, ...args].join(' ')); if (file === 'cursor-agent' && fail) return { code: 1, stdout: '', stderr: 'boom\nNot logged in' }; return { code: 0, stdout: file === 'codex' ? CODEX : 'auto - Auto (default)\n', stderr: '' }; };
    const read: string[] = [];
    const models = createModels({ run, now: () => t, ttlMs: 100, env: async () => ({ HOME: '/h', CODEX_HOME: '/cx' }), readText: async p => { read.push(p); return p.endsWith('config.toml') ? 'model = "gpt-6-astra"\n' : '{"model":"sonnet"}'; } });
    const [a, b] = await Promise.all([models.list('codex'), models.list('codex')]);
    expect(a).toBe(b); expect(a.models.find(m => m.isDefault)?.id).toBe('gpt-6-astra');
    await models.list('codex'); expect(runs).toEqual(['codex debug models']);
    t = 200; await models.list('codex'); expect(runs).toHaveLength(2);
    expect(await models.list('cursor')).toEqual({ models: [], error: 'Not logged in' });
    fail = false; expect((await models.list('cursor')).models[0]).toMatchObject({ id: 'auto', isDefault: true });
    expect((await models.list('claude')).models.find(m => m.isDefault)?.id).toBe('sonnet');
    expect(read).toEqual(['/cx/config.toml', '/cx/config.toml', '/h/.claude/settings.json']);
    expect(await createModels({ run: async () => ({ code: null, stdout: '', stderr: 'spawn codex ENOENT' }), env: async () => ({}) }).list('codex')).toEqual({ models: [], error: 'not installed' });
  });
});
