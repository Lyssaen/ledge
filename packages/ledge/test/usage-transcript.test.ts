import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeTurn, codexLimits, codexTurn, readTurn } from '../src/daemon/context.js';

// Lines in the shape Claude Code 2.1.318 and Codex CLI 0.162 write them (trimmed to the fields read).
const claude = (o: { model: string; effort?: string; side?: boolean; tokens?: number }) => JSON.stringify({
  type: 'assistant', isSidechain: o.side ?? false, ...(o.effort ? { effort: o.effort, perTurnEffort: o.effort } : {}),
  message: { model: o.model, usage: { input_tokens: o.tokens ?? 1000, output_tokens: 10 } }
});
const turnContext = (model: string, effort?: string) => JSON.stringify({ timestamp: '2026-11-05T13:00:00.000Z', type: 'turn_context', payload: { cwd: '/w', model, ...(effort ? { effort } : {}), summary: 'none' } });
const tokenCount = (at: string, rl: unknown) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 5000 }, model_context_window: 258400 }, rate_limits: rl } });

describe('the model and effort a session runs, from its transcript', () => {
  it('Claude Code: the last assistant message outside a side chain, its model and its effort', () => {
    expect(claudeTurn([claude({ model: 'claude-opus-5-5', effort: 'medium' }), claude({ model: 'claude-haiku-5-5', side: true })])).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
    // An older Claude Code without the field: the model alone.
    expect(claudeTurn([claude({ model: 'claude-sonnet-5-5' })])).toEqual({ model: 'claude-sonnet-5-5' });
    expect(claudeTurn([claude({ model: '<synthetic>' })])).toEqual({});
    expect(claudeTurn(['not json', '{}'])).toEqual({});
  });
  it('Codex: the last turn_context', () => {
    expect(codexTurn([turnContext('gpt-5', 'low'), turnContext('gpt-6.1-terra', 'medium')])).toEqual({ model: 'gpt-6.1-terra', effort: 'medium' });
    expect(codexTurn([turnContext('gpt-6.1-terra')])).toEqual({ model: 'gpt-6.1-terra' });
    expect(codexTurn([])).toEqual({});
  });
});

describe('Codex limits from its transcript', () => {
  it('the 5 hours and the week, with their resets (epoch seconds, or seconds from the line for an older CLI)', () => {
    const lines = [tokenCount('2026-11-05T13:00:00.000Z', {
      limit_id: 'codex', primary: { used_percent: 3.4, window_minutes: 300, resets_at: 1782125293 },
      secondary: { used_percent: 97.6, window_minutes: 10080, resets_in_seconds: 3600 }, credits: { has_credits: false }, plan_type: 'business'
    })];
    expect(codexLimits(lines)).toEqual({ at: '2026-11-05T13:00:00.000Z', windows: [
      { kind: 'five_hour', pct: 3, resetsAt: new Date(1782125293 * 1000).toISOString() },
      { kind: 'seven_day', pct: 98, resetsAt: '2026-11-05T14:00:00.000Z' }
    ] });
  });
  it('a plan that gives none (both null, as on this machine) has no window, but keeps when it said so; no rate_limits read is undefined', () => {
    expect(codexLimits([tokenCount('2026-11-05T13:00:00.000Z', { limit_id: 'premium', primary: null, secondary: null, credits: { has_credits: false }, plan_type: null })])).toEqual({ windows: [], at: '2026-11-05T13:00:00.000Z' });
    expect(codexLimits([tokenCount('2026-11-05T13:00:00.000Z', null)])).toEqual({ windows: [], at: '2026-11-05T13:00:00.000Z' });
    expect(codexLimits([turnContext('gpt-6.1-terra')])).toBeUndefined();
  });
  it('readTurn reads the context, model, effort and limits in one go from the file\'s end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-turn-'));
    const codex = join(dir, 'rollout.jsonl');
    writeFileSync(codex, [turnContext('gpt-6.1-terra', 'high'), tokenCount('2026-11-05T13:00:00.000Z', { primary: { used_percent: 50, window_minutes: 300, resets_at: 1782125293 }, secondary: null })].join('\n') + '\n');
    const t = await readTurn({ tool: 'codex', transcriptPath: codex }, '2026-11-05T13:01:00.000Z');
    expect(t).toMatchObject({ model: 'gpt-6.1-terra', effort: 'high', context: { used: 5000, window: 258400 }, codexLimits: { windows: [{ kind: 'five_hour', pct: 50 }] } });
    const cl = join(dir, 'claude.jsonl');
    writeFileSync(cl, claude({ model: 'claude-opus-5-5', effort: 'xhigh', tokens: 300_000 }) + '\n');
    expect(await readTurn({ tool: 'claude', transcriptPath: cl }, '2026-11-05T13:01:00.000Z')).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh', context: { window: 1_000_000 } });
    expect(await readTurn({ tool: 'claude', transcriptPath: join(dir, 'missing.jsonl') }, 'x')).toEqual({});
  });
});
