import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { UsageAlert, UsageWindow } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { HarnessLogo, UsageFooter } from '../src/usage/UsageFooter';
import type { UsageGroup } from '../src/usage/model';
import { Attention } from '../src/shell/sidebar/Attention';

const openUrl = vi.hoisted(() => vi.fn());
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), openUrl }));

afterEach(() => { cleanup(); openUrl.mockClear(); });

const NOW = new Date(2026, 10, 7, 10, 0).getTime();
const DEC1 = new Date(2026, 11, 1, 13, 43).toISOString();
const min = (n: number) => new Date(NOW - n * 60_000).toISOString();
const month = (total: number, cursor: number, other: number): UsageWindow[] => [
  { kind: 'month', pct: total, resetsAt: DEC1 },
  { kind: 'pool', pool: 'cursor', pct: cursor, resetsAt: DEC1 },
  { kind: 'pool', pool: 'other', pct: other, resetsAt: DEC1 }
];
const cursor = (o: Partial<UsageGroup> = {}): UsageGroup => ({ key: 'cursor|x', harness: 'cursor', machines: ['local'], status: 'ok', readAt: min(1), windows: month(12, 8, 56), ...o });
const claude = (o: Partial<UsageGroup> = {}): UsageGroup => ({
  key: 'claude|x', harness: 'claude', machines: ['local'], status: 'ok', readAt: min(1),
  windows: [{ kind: 'five_hour', pct: 40, resetsAt: null }, { kind: 'seven_day', pct: 20, resetsAt: null }], ...o
});
const codex = (): UsageGroup => ({ key: 'codex|@local', harness: 'codex', machines: ['local'], status: 'ok', readAt: min(1), windows: [{ kind: 'five_hour', pct: 10, resetsAt: null }, { kind: 'seven_day', pct: 5, resetsAt: null }] });

const draw = (groups: UsageGroup[], lang: 'fr' | 'en' = 'fr') => render(
  <LangProvider lang={lang}><UsageFooter groups={groups} threshold={0.8} label={m => m} onSettings={() => {}} now={NOW} /></LangProvider>
);
const chip = (name = 'Limites de Cursor Agent : détail') => screen.getByRole('button', { name });

describe('Cursor Agent in the footer', () => {
  it('a monthly plan alone: Mois, the percent and the reset date; no pool under the threshold', () => {
    draw([cursor()]);
    expect(chip()).toHaveTextContent('Mois');
    expect(chip()).toHaveTextContent('12 %');
    expect(chip()).toHaveTextContent('↺ 1 déc.');
    expect(chip()).not.toHaveTextContent('Cursor');
    expect(chip()).not.toHaveTextContent('Autres');
  });

  it('a weekly plan: Semaine', () => {
    draw([cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: null }] })]);
    expect(chip()).toHaveTextContent('Semaine');
    expect(chip()).toHaveTextContent('30 %');
  });

  it('a pool reached shows in the chip; the detail names the total and each pool', () => {
    draw([cursor({ windows: month(81, 41, 100) })]);
    expect(chip()).toHaveTextContent('Autres');
    expect(chip()).toHaveTextContent('100 %');
    expect(chip()).not.toHaveTextContent('Cursor');
    fireEvent.click(chip());
    const pop = screen.getByRole('dialog');
    for (const t of ['Total inclus · mois', 'Par réserve', 'Modèles Cursor', 'Autres modèles', 'Composer, Grok, Auto', 'Claude, GPT, Gemini… au prix de l’API', 'atteinte · reprend le 1 déc.', 'remise le 1 déc. 13:43 · dans 24 j']) expect(pop).toHaveTextContent(t);
  });

  it('the weekly detail', () => {
    draw([cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: new Date(NOW + 5 * 86_400_000).toISOString() }] })]);
    fireEvent.click(chip());
    expect(screen.getByRole('dialog')).toHaveTextContent('Semaine · modèles Cursor');
  });

  it('English copy', () => {
    draw([cursor({ windows: month(81, 41, 100) })], 'en');
    expect(screen.getByRole('button', { name: 'Cursor Agent limits: detail' })).toHaveTextContent('Month');
    fireEvent.click(screen.getByRole('button', { name: 'Cursor Agent limits: detail' }));
    const pop = screen.getByRole('dialog');
    for (const t of ['Included total · month', 'By pool', 'Cursor models', 'Other models', 'reached · resumes on 1 Dec', 'resets on 1 Dec 13:43 · in 24 d']) expect(pop).toHaveTextContent(t);
  });

  it('next to Claude Code the Cursor chip has no reset', () => {
    draw([claude(), cursor()]);
    expect(chip()).toHaveTextContent('12 %');
    expect(chip()).not.toHaveTextContent('↺');
  });

  it('three groups: no chip has a reset date, each is a button for its detail', () => {
    draw([claude(), codex(), cursor()]);
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(3);
    for (const b of chips) expect(b).not.toHaveTextContent('↺');
  });

  it('limit not read: underlined message in the chip; the detail says why and links the dashboard', () => {
    draw([cursor({ windows: [] })]);
    expect(chip()).toHaveTextContent('limite non lue');
    fireEvent.click(chip());
    const pop = screen.getByRole('dialog');
    expect(pop).toHaveTextContent('Cursor ne donne pas à Ledge le détail de cette offre');
    fireEvent.click(within(pop).getByRole('button', { name: 'cursor.com/dashboard ↗' }));
    expect(openUrl).toHaveBeenCalledWith('https://cursor.com/dashboard?tab=usage');
  });

  it('expired: the message names the harness', () => {
    draw([cursor({ status: 'expired', windows: [] })]);
    expect(screen.getByText('session expirée : reconnectez-vous dans Cursor Agent')).toBeInTheDocument();
    cleanup();
    draw([claude({ status: 'expired', windows: [] })]);
    expect(screen.getByText('session expirée : reconnectez-vous dans Claude Code')).toBeInTheDocument();
  });

  it('unreachable names api2.cursor.sh in the detail', () => {
    draw([cursor({ status: 'unreachable' })]);
    fireEvent.click(chip());
    expect(screen.getByRole('dialog')).toHaveTextContent('api2.cursor.sh injoignable');
  });

  it('stale shows its age', () => {
    draw([cursor({ status: 'stale', readAt: min(22) })]);
    expect(chip()).toHaveTextContent('il y a 22 min');
  });
});

describe('the providers\' logos', () => {
  it('Claude: its orange spark; Cursor and Codex: the text colour', () => {
    const c = render(<HarnessLogo harness="claude" />).container;
    expect(c.querySelector('path[fill="#D97757"]')).not.toBeNull();
    const k = render(<HarnessLogo harness="cursor" />).container;
    expect(k.querySelector('svg[fill="currentColor"]')).not.toBeNull();
    const o = render(<HarnessLogo harness="codex" />).container;
    expect(o.querySelector('svg[fill="currentColor"]')).not.toBeNull();
  });
});

describe('« À toi »', () => {
  const alert = (w: UsageWindow, level: 'full' | 'threshold' = 'full'): UsageAlert => ({ id: `a-${w.kind}-${w.pool ?? ''}`, harness: 'cursor', account: 'x', window: w, level, at: min(1) });
  const card = (a: UsageAlert, lang: 'fr' | 'en' = 'fr') => render(
    <LangProvider lang={lang}><Attention items={[]} current={null} projectOf={() => null} onOpen={() => {}} onDecide={() => {}} onMenu={() => {}} paused usageAlerts={[a]} /></LangProvider>
  ).container;

  it('a pool reached', () => {
    const c = card(alert({ kind: 'pool', pool: 'other', pct: 100, resetsAt: DEC1 }));
    expect(c).toHaveTextContent('Cursor Agent');
    expect(c).toHaveTextContent('Autres modèles');
    expect(c).toHaveTextContent('Atteinte · reprend le 1 déc.');
  });
  it('the month total, and the week total', () => {
    expect(card(alert({ kind: 'month', pct: 81, resetsAt: DEC1 }, 'threshold'))).toHaveTextContent('total du mois');
    cleanup();
    expect(card(alert({ kind: 'seven_day', pct: 81, resetsAt: null }, 'threshold'))).toHaveTextContent('total de la semaine');
  });
});
