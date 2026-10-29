import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const prompt = (id: string, text: string, at: string): ThreadItem => ({ kind: 'prompt', id, at, turn: 1, text });
const reply = (id: string, text: string, at: string): ThreadItem => ({ kind: 'reply', id, at, turn: 1, text });

function opened(extra: Parameters<typeof session>[1] = {}) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', unread: true, ...extra })]));
  const view = render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  return { ...t, view };
}

describe('the thread', () => {
  it('asks the thread on open, then marks it read up to its last item', () => {
    const t = opened();
    expect(t.of('session.thread')).toEqual([{ type: 'session.thread', id: 'a' }]);
    expect(t.of('session.read')).toEqual([]);
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('p1', 'Corrige le lien', '2026-10-14T10:00:00.000Z'), reply('r1', 'Tout passe.', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    expect(t.of('session.read')).toEqual([{ type: 'session.read', id: 'a', at: '2026-10-14T10:02:00.000Z' }]);
    const types = t.sent.map(m => m.type);
    expect(types.indexOf('session.thread')).toBeLessThan(types.indexOf('session.read'));
    expect(screen.getByText('Corrige le lien')).toBeInTheDocument();
    expect(screen.getByText('Tout passe.')).toBeInTheDocument();
  });

  it('watches the session while open, and stops on leaving', () => {
    const t = opened();
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }]);
    t.view.unmount();
    expect(t.of('session.watch').at(-1)).toEqual({ type: 'session.watch', id: null });
  });

  it('reads an agent reply as the PC does: title, lead, sections', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', '**Correctif prêt**\n\nLe test passait par hasard.\n\n- `pnpm test` vert', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    const article = screen.getByRole('article', { name: 'Réponse de l’agent' });
    expect(article.querySelector('strong')?.textContent).toBe('Correctif prêt');
    expect(article.querySelector('code')?.textContent).toBe('pnpm test');
    expect(article.textContent).not.toContain('**');
  });

  it('says when a message was shortened, and when older ones stay on the PC', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', 'Long…', '2026-10-14T10:02:00.000Z')], cut: ['r1'], more: true }));
    expect(screen.getByText('Message raccourci')).toBeInTheDocument();
    expect(screen.getByText('Messages plus anciens sur le PC')).toBeInTheDocument();
  });

  it('says nothing of the kind for a whole thread', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', 'Court.', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    expect(screen.queryByText('Message raccourci')).not.toBeInTheDocument();
    expect(screen.queryByText('Messages plus anciens sur le PC')).not.toBeInTheDocument();
  });

  it('sends an instruction to an idle agent and shows it on its way', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    fireEvent.change(screen.getByLabelText('Message pour Kai'), { target: { value: 'Montre le diff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Kai' }));
    expect(t.of('session.reply')).toMatchObject([{ type: 'session.reply', id: 'a', text: 'Montre le diff', expect: null }]);
    expect(screen.getByText('Envoi au PC…', { selector: 'div[role=status]' })).toBeInTheDocument();
  });

  it('points to the request when one waits, and keeps the composer shut', () => {
    const t = opened({ state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect(screen.getByRole('link', { name: /Examiner la demande/ })).toHaveAttribute('href', '#/request/a/k1');
    expect(screen.getByLabelText('Message pour Kai')).toBeDisabled();
  });

  it('says the session is gone when the PC no longer knows it', () => {
    const t = opened();
    act(() => t.deliver({ type: 'error', code: 'unknown_session', request: 'session.thread' }));
    expect(screen.getByText('Cette session n’existe plus sur le PC.')).toBeInTheDocument();
  });
});

describe('the checklist on the thread', () => {
  const checklist = { tasks: [{ text: 'Écrire', status: 'in_progress' as const }], done: 0, total: 1 };
  const flagged = (flag: boolean) => {
    const t = setup();
    const m = snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile' })]);
    if (m.type === 'snapshot' && flag) m.daemon = { ...m.daemon, checklist: true };
    t.deliver(m);
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    return t;
  };

  it('shows the head once the PC sends a list', () => {
    const t = flagged(true);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist }));
    expect(screen.getByRole('button', { name: /Plan de travail/ })).toBeInTheDocument();
  });

  it('shows none for a null checklist', () => {
    const t = flagged(true);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist: null }));
    expect(screen.queryByRole('button', { name: /Plan de travail/ })).not.toBeInTheDocument();
  });

  it('shows none when the PC does not announce the feature', () => {
    const t = flagged(false);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist }));
    expect(screen.queryByRole('button', { name: /Plan de travail/ })).not.toBeInTheDocument();
  });
});
