import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatPoint, ChatTurn, PointItem } from '@ledge/protocol';
import { PointTurn, newestPointRead } from '../../src/chat/PointTurn';
import { ChatView, type ChatViewProps } from '../../src/chat/ChatView';
import { ChatCopyProvider } from '../../src/chat/copy';
import { pointCopy } from '../../src/chat/pointCopy';
import { actionCopy } from '../../src/chat/actionCopy';
import { copy } from '../chat-copy-fixture';

const AT = '2026-11-13T13:32:00.000Z';
const noop = () => {};
const fr = { ...copy, chat: { ...copy.chat, action: actionCopy.fr, point: pointCopy.fr } };
const item = (o: Partial<PointItem> & Pick<PointItem, 'id' | 'group'>): PointItem => ({ event: 1, tone: 'idle', who: 'Rex', text: '', at: AT, ...o });
// Board 1: two rows for you, two done, one in progress, one rig.
const ITEMS: PointItem[] = [
  item({ id: 'rig.ask:q309', event: 11, group: 'atoi', tone: 'ask', who: 'pilot-lead', rig: 'ledge-dev', text: 'Fusionner #309 maintenant, ou attendre la revue de qa ?', ref: { kind: 'rig.ask', qitem: 'q309' },
    answers: [{ id: 'merge', label: 'Fusionner', style: 'primary' }, { id: 'wait', label: 'Attendre qa', style: 'plain' }], freeText: true, nav: [{ kind: 'rig', id: 'ledge-dev' }] }),
  item({ id: 'session.request:nova', event: 12, group: 'atoi', tone: 'perm', who: 'Nova', text: 'pnpm -r test -u', ref: { kind: 'session.request', session: 'nova', key: 'k1' },
    answers: [{ id: 'deny', label: 'Refuser', style: 'plain' }, { id: 'accept', label: 'Autoriser', style: 'primary' }], nav: [{ kind: 'session', id: 'nova' }] }),
  item({ id: 'session:rex', event: 9, group: 'done', who: 'Rex', text: 'a fini « socle-données »', sub: 'PR #41 ouverte, tests verts', nav: [{ kind: 'pr', id: 'pr41' }],
    suggestion: { action: 'session.archive', args: { session: 'rex' }, summary: 'Archiver **Rex**', vars: { session: 'Rex' }, risk: 'reversible' } }),
  item({ id: 'session:pim', event: 8, group: 'done', tone: 'off', who: 'Pim', text: 's’est arrêtée : contexte plein' }),
  item({ id: 'task:t1', event: 0, group: 'ongoing', tone: 'work', who: 'Iris', text: 'tient « Filtre MR par projet » depuis 2 h', sub: 'rien de neuf depuis 40 min' }),
  item({ id: 'rig:ledge-dev', event: 10, group: 'rigs', tone: 'perm', who: 'ledge-dev', text: 'le siège qa.reviewer ne répond plus', nav: [{ kind: 'rig', id: 'ledge-dev' }] })
];
const point = (o: Partial<ChatPoint> = {}): ChatPoint => ({ since: '2026-11-13T12:50:00.000Z', lead: 'Depuis 13:50, six choses. **Deux t’attendent.**', leadBy: 'agent', items: ITEMS, ...o });
const turn = (p: ChatPoint = point()): ChatTurn & { point: ChatPoint } => ({ qid: 'p1', question: '', askedAt: AT, steps: [], answeredAt: AT, by: 'ledge', point: p });
const ui = (p: Partial<Parameters<typeof PointTurn>[0]> = {}) => (
  <ChatCopyProvider value={fr}>
    <PointTurn turn={turn()} onAnswer={noop} onNav={noop} onSuggestion={noop} {...p} />
  </ChatCopyProvider>
);

describe('the operator point (board 1)', () => {
  it('renders groups and counts as board 1', () => {
    render(ui());
    const box = screen.getByRole('article');
    expect(box).toHaveTextContent('Ledge');
    expect(box).toHaveTextContent('de lui-même');
    expect(box).toHaveTextContent('Deux t’attendent.');
    const groups = within(box).getAllByRole('group');
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['À toi 2', 'Terminé 2', 'En cours 1', 'Rigs 1']);
    // A permission says what it wants to run; a question is quoted.
    expect(groups[0]).toHaveTextContent('veut lancer pnpm -r test -u');
    expect(groups[0]).toHaveTextContent('« Fusionner #309 maintenant, ou attendre la revue de qa ? »');
    expect(groups[0]).toHaveTextContent('· ledge-dev');
    // A rig's ask with options wears the « décision » pill; a permission does not.
    expect(within(groups[0]!).getAllByText('décision')).toHaveLength(1);
    expect(screen.getByText('pilot-lead').closest('[data-point-item]')!.querySelector('[data-point-pill]')).toHaveTextContent('décision');
    expect(within(groups[0]!).getByRole('button', { name: 'Répondre…' })).toBeInTheDocument();
    // Done rows show their time; the PR's button comes before the suggestion.
    const done = within(groups[1]!).getAllByRole('button').map(b => b.textContent);
    expect(done).toEqual(['Voir la PR', 'Archiver Rex']);
    expect(groups[1]).toHaveTextContent(/PR #41 ouverte, tests verts · \d\d:\d\d/);
    expect(within(groups[3]!).getByRole('button', { name: 'Ouvrir le rig' })).toBeInTheDocument();
  });

  it('a settled item shows réglé dans le terminal and no buttons', () => {
    const settled = ITEMS.map(i => (i.id === 'session.request:nova' ? { ...i, settled: { at: AT, where: 'terminal' as const } } : i));
    render(ui({ turn: turn(point({ items: settled })) }));
    const row = screen.getByText('Nova').closest('[data-point-item]') as HTMLElement;
    expect(row).toHaveTextContent('réglé dans le terminal');
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('a folded point is one line', () => {
    render(ui({ turn: turn(point({ foldedAt: '2026-11-13T13:45:00.000Z' })) }));
    const box = screen.getByRole('article');
    expect(box).toHaveTextContent(/^Tout est réglé depuis \d\d:\d\d$/);
    expect(within(box).queryAllByRole('group')).toHaveLength(0);
    expect(within(box).queryAllByRole('button')).toHaveLength(0);
  });

  it('clicking Autoriser calls onAnswer with accept', () => {
    const onAnswer = vi.fn();
    render(ui({ onAnswer }));
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }));
    expect(onAnswer).toHaveBeenCalledWith('session.request:nova', { id: 'accept' });
  });

  it('Répondre… opens a field whose text goes to onAnswer', () => {
    const onAnswer = vi.fn();
    render(ui({ onAnswer }));
    fireEvent.click(screen.getByRole('button', { name: 'Répondre…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ta réponse' }), { target: { value: 'attends qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onAnswer).toHaveBeenCalledWith('rig.ask:q309', { text: 'attends qa' });
  });

  it('the suggestion and the screens go to their callbacks', () => {
    const onSuggestion = vi.fn(); const onNav = vi.fn();
    render(ui({ onSuggestion, onNav }));
    fireEvent.click(screen.getByRole('button', { name: 'Archiver Rex' }));
    expect(onSuggestion).toHaveBeenCalledWith('session:rex');
    fireEvent.click(screen.getByRole('button', { name: 'Voir la PR' }));
    expect(onNav).toHaveBeenCalledWith({ kind: 'pr', id: 'pr41' });
  });

  it('a row being confirmed asks again; the go button confirms', () => {
    const onConfirm = vi.fn(); const onCancelConfirm = vi.fn();
    render(ui({ confirming: { item: 'session.request:nova', answer: { id: 'accept' } }, onConfirm, onCancelConfirm }));
    const row = screen.getByText('Nova').closest('[data-point-item]') as HTMLElement;
    expect(row).toHaveTextContent('Autoriser pour Nova ?');
    expect(row).toHaveTextContent('Ledge ne pourra pas la défaire une fois envoyée.');
    fireEvent.click(within(row).getByRole('button', { name: 'Annuler' }));
    expect(onCancelConfirm).toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Autoriser' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('the machine name shows in the header when given', () => {
    render(ui({ machineName: 'Tour' }));
    expect(screen.getByRole('article')).toHaveTextContent('Tour');
  });

  it('newestPointRead gives the last point turn and its highest event', () => {
    const plain: ChatTurn = { qid: 'q0', question: 'hi', askedAt: AT, steps: [] };
    expect(newestPointRead([plain, turn()])).toEqual({ qid: 'p1', eventId: 12 });
    expect(newestPointRead([plain])).toBeNull();
  });
});

describe('the chat draws point turns', () => {
  const base: ChatViewProps = { turns: [], live: null, sessions: [], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onOpenSession: noop, now: Date.parse(AT), docked: true };
  const chat = (p: Partial<ChatViewProps>) => <ChatCopyProvider value={fr}><ChatView {...base} {...p} /></ChatCopyProvider>;

  it('a point turn and a turn of Ledge have no question bubble', () => {
    const own: ChatTurn = { qid: 'l1', question: '', askedAt: AT, steps: [], answer: 'Rien de neuf.', answeredAt: AT, by: 'ledge' };
    const { container } = render(chat({ turns: [turn(), own], onPointAnswer: noop }));
    expect(container.querySelectorAll('[data-question]')).toHaveLength(0);
    expect(screen.getByRole('article')).toHaveTextContent('de lui-même');
    expect(container).toHaveTextContent('Rien de neuf.');
  });

  it('the newest point in view is read up to its highest event', () => {
    const observed: Array<(es: Array<{ isIntersecting: boolean }>) => void> = [];
    const IO = vi.fn(function (this: unknown, cb: (es: Array<{ isIntersecting: boolean }>) => void) { observed.push(cb); return { observe: noop, disconnect: noop }; });
    vi.stubGlobal('IntersectionObserver', IO);
    try {
      const onPointSeen = vi.fn();
      render(chat({ turns: [turn()], onPointAnswer: noop, onPointSeen }));
      expect(observed).toHaveLength(1);
      observed[0]!([{ isIntersecting: true }]);
      expect(onPointSeen).toHaveBeenCalledWith('p1', 12);
    } finally { vi.unstubAllGlobals(); }
  });
});
