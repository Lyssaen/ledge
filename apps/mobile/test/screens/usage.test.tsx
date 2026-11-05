import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneHarnessUsage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { indicators, modelName, reachedWindows, span } from '../../src/model/usage';
import { Agents } from '../../src/screens/Agents';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const claude = (o: Partial<PhoneHarnessUsage> = {}): PhoneHarnessUsage => ({
  harness: 'claude', status: 'ok', readAt: at(-1),
  windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(60) }, { kind: 'seven_day', pct: 58, resetsAt: at(4 * 24 * 60) }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: at(4 * 24 * 60) }],
  ...o
});
const ON = { confirm: true, chat: true as const };

function point(usage: PhoneHarnessUsage[]) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'Atelier', undefined, ON));
  t.deliver({ type: 'usage.state', harnesses: usage });
  render(<Chat store={t.store} />);
  return screen.getByRole('region', { name: copy.chat.point.label });
}

describe('the model', () => {
  it('names models, spans, and the windows reached (no threshold on the phone: 100 % only)', () => {
    expect([modelName('claude-opus-5-5'), modelName('gpt-6.1')]).toEqual(['Opus 5.5', 'gpt-6.1']);
    expect([span(40_000), span(72 * 60_000)]).toEqual(['40 s', '1 h 12']);
    expect(reachedWindows([claude(), claude({ status: 'expired', windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] })]).map(r => r.window.model)).toEqual(['Opus']);
  });

  it('a session\'s indicators: model, effort (N1: read from the transcript too), context, duration; nothing unknown', () => {
    const s = session('a', { model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) });
    expect(indicators(s, NOW, 0.85)).toEqual({ model: 'Opus 5.5', effort: 'élevé', context: { pct: 46, near: false }, duration: '1 h 12' });
    expect(Object.keys(indicators(session('b', { startedAt: at(-5) }), NOW, 0.85))).toEqual(['duration']);
  });
});

describe('« Le point »', () => {
  it('LIMITES: per harness its logo and windows, percent and reset; a reached window also in « À toi »', () => {
    const region = point([claude()]);
    const limits = within(region).getByRole('group', { name: copy.chat.point.limitsLabel });
    expect(limits.textContent).toContain('Claude Code');
    expect(limits.textContent).toContain('84 %');
    expect(limits.textContent).toContain('Opus');
    expect(limits.querySelector('svg.harness-claude')).not.toBeNull();
    const yours = within(region).getByRole('group', { name: copy.chat.point.yoursLabel });
    expect(within(yours).getByLabelText('Claude · Opus atteinte').textContent).toContain('100 %');
    // 84 % is past no threshold the phone knows: it is not in « À toi ».
    expect(yours.textContent).not.toContain('84 %');
  });

  it('says reading, expired, old and unreachable as the mockup does; nothing without limits', () => {
    expect(within(point([claude({ status: 'loading', readAt: null, windows: [] })])).getByText(copy.chat.point.loading)).toBeTruthy();
  });

  it.each([
    ['expired', copy.chat.point.notOnPc],
    ['stale', copy.chat.point.stale('12 min')],
    ['unreachable', copy.chat.point.unreach('25 min')]
  ] as const)('%s', (status, text) => {
    const readAt = status === 'unreachable' ? at(-25) : at(-12);
    const region = point([claude({ status, readAt, ...(status === 'expired' ? { windows: [] } : {}) })]);
    expect(within(region).getByText(text)).toBeTruthy();
  });

  it('without limits from the PC, no LIMITES', () => {
    expect(within(point([])).queryByRole('group', { name: copy.chat.point.limitsLabel })).toBeNull();
  });
});

it('Agents: one line of indicators, the context amber past « Contexte max »', () => {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Nova', repo: 'ledge', model: 'fable', effort: 'high', context: { used: 176_000, window: 200_000, at: at(0) }, startedAt: at(-220) })]));
  const { container } = render(<Agents store={t.store} />);
  const line = container.querySelector('[data-indicators]')!;
  expect(line.textContent).toBe('Fable · élevé · contexte 88 % · 3 h 40');
  expect(line.querySelector('.text-attention')?.textContent).toContain('contexte 88 %');
});
