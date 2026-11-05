import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { modelName, SessionMeta } from '../src/usage/SessionMeta';

const base = { id: 'otto', name: 'Otto', tool: 'claude', state: 'working', cwd: '/w/ledge', startedAt: new Date(Date.now() - 72 * 60_000).toISOString(), lastActivityAt: new Date().toISOString() } as unknown as Session;
const meta = (s: Partial<Session>) => render(<LangProvider lang="fr"><SessionMeta session={{ ...base, ...s } as Session} place={['Local', 'ledge']} near={0.85} /></LangProvider>).container.querySelector('.session-meta') as HTMLElement;

it('names models as people say them', () => {
  expect([modelName('claude-opus-5-5'), modelName('fable'), modelName('sonnet-5'), modelName('gpt-6.1')]).toEqual(['Opus 5.5', 'Fable', 'Sonnet 5', 'gpt-6.1']);
});

it('launched by Ledge: model, effort, context and duration; the tooltip says where each comes from', () => {
  const el = meta({ model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: new Date().toISOString() } });
  expect(el.textContent).toBe('Local·ledge·Opus 5.5·effort élevé·contexte 46 %·1 h 12');
  fireEvent.mouseEnter(el);
  const tip = screen.getByRole('tooltip').textContent;
  expect(tip).toContain('Opus 5.5 · choisi au lancement');
  expect(tip).toContain('élevé · choisi au lancement');
  expect(tip).toContain('92 k / 200 k jetons · relève à 85 %');
  expect(tip).toMatch(/ouverte à \d\d:\d\d, il y a 1 h 12/);
});

it('read from the transcript (N1: a Claude Code effort too), seen by Ledge; nothing unknown is shown', () => {
  const el = meta({ model: 'claude-opus-5-5', modelFrom: 'transcript', effort: 'medium', effortFrom: 'transcript', startedSeen: true });
  expect(el.textContent).toBe('Local·ledge·Opus 5.5·effort moyen·1 h 12');
  fireEvent.focus(el);
  expect(screen.getByRole('tooltip').textContent).toContain('moyen · lu dans le transcript');
  expect(screen.getByRole('tooltip').textContent).toMatch(/vue par Ledge à/);
  // OMP, Cursor: the duration alone.
  expect(meta({}).textContent).toBe('Local·ledge·1 h 12');
});

it('past « Contexte max » the context is amber', () => {
  const el = meta({ context: { used: 176_000, window: 200_000, at: new Date().toISOString() } });
  expect(el.querySelector('.mctx')?.classList.contains('amber')).toBe(true);
});
