import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ClientMessage, Escalation, Exchange, LedgeDecision, LedgeThreadItem, Rig } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { LangProvider } from '../src/i18n/lang';
import { LedgeFeed } from '../src/surface/LedgeFeed';

/** A local instant of today at hh:mm (the feed prints local times). */
const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: ['build', 'review-a', 'orch-lead', 'qa'].map(n => ({ ref: `${n}@factory`, address: `@${n}`, name: n, runtime: 'claude-code', state: 'working' as const })) };
const DECISION: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'orch-lead@factory', intent: 'decision',
  summary: 'Sessions : passer du fichier JSON à SQLite ?', advice: 'SQLite.', category: 'architecture', createdAt: at(16, 28), state: 'pending',
  questions: [{ id: 'q1', question: 'JSON ou SQLite ?', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Garder le JSON' }] }] };
const X1: Exchange = { id: 'x1', machine: 'local', rigId: 'r1', from: 'orch-lead@factory', to: 'qa@factory', kind: 'task', text: 'Vérifier la reprise après reboot.', at: at(16, 31) };
const X2: Exchange = { id: 'x2', machine: 'local', rigId: 'r1', from: 'build@factory', to: 'review-a@factory', kind: 'message', text: 'Candidat prêt sur feat/rigs.', at: at(16, 36) };
const THREAD: LedgeThreadItem[] = [
  { kind: 'exchanges', id: 'g1', at: at(16, 31), machine: 'local', rigId: 'r1', from: at(16, 31), to: at(16, 36), exchangeIds: ['x1', 'x2'] },
  { kind: 'user', id: 'u1', at: at(16, 44), text: 'Pourquoi review-b a été relancé ?' },
  { kind: 'ledge', id: 'l1', at: at(16, 45), text: 'Il approchait 82 % de contexte.' }
];

let sent: ClientMessage[];
let escalations: Escalation[];
function client(): DaemonClient {
  const rigs = [FACTORY], exchanges = [X1, X2], openrig = [{ machine: 'local', state: 'running' as const }];
  const fleet = { subscribe: () => () => {}, rigs: () => rigs, escalations: () => escalations, openrig: () => openrig, exchanges: () => exchanges, requestExchanges: () => true };
  return { connect() {}, close() {}, send: (m: ClientMessage) => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {}, fleet } as unknown as DaemonClient;
}
const show = (items: LedgeThreadItem[]) => {
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'ledge.thread.history', items }); });
  return render(<LangProvider lang="fr"><LedgeFeed client={client()} onClose={() => {}} onSettings={() => {}} /></LangProvider>);
};
const lines = () => [...document.querySelectorAll('[data-feed-line]')];
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => { daemonStore.reset(); sent = []; escalations = [DECISION]; localStorage.clear(); });

describe('the open notch: Ledge’s mixed feed', () => {
  it('the pending decision is pinned above the mixed feed', () => {
    show(THREAD);
    const card = document.querySelector('.lt-card')!;
    expect(card).toHaveTextContent('Sessions : passer du fichier JSON à SQLite ?');
    expect(card).toHaveTextContent('Mon avis : SQLite.');
    expect(lines().map(l => l.querySelector('[data-feed-time]')!.textContent)).toEqual(['16:31', '16:36', '16:44', '16:45']);
    expect(before(card, lines()[0]!)).toBe(true);
    // One line per element: who → whom, then the rig and the kind for an exchange.
    expect(lines()[0]).toHaveTextContent('orch-lead → qa · factory · tâche');
    expect(lines()[1]).toHaveTextContent('build → review-a · factory · message');
    expect(lines()[2]).toHaveTextContent('Toi → Ledge');
    expect(lines()[2]).toHaveAttribute('data-tone', 'user');
    expect(lines()[3]).toHaveTextContent('Ledge → toi');
    expect(lines()[3]).toHaveAttribute('data-tone', 'ledge');
    // The header: Ledge orchestrates 1 rig and its 4 agents.
    expect(screen.getByText('Orchestre 1 rig · 4 agents · tranche dans son mandat')).toBeInTheDocument();
    // No « + »: chat.reset would clear the shared chat's cards while the feed stays (final review ruling).
    expect(screen.queryByRole('button', { name: 'Nouvelle conversation' })).toBeNull();
  });

  it('« Seulement Ledge » hides agent exchanges, and is remembered', async () => {
    show(THREAD);
    expect(lines()).toHaveLength(4);
    const only = screen.getByRole('button', { name: 'Seulement Ledge' });
    expect(only).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(only);
    expect(lines()).toHaveLength(2);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('ledge.feed.onlyLedge')).toBe('1');
  });

  it('« Seulement Ledge » starts from what was remembered', () => {
    localStorage.setItem('ledge.feed.onlyLedge', '1');
    show(THREAD);
    expect(lines()).toHaveLength(2);
  });

  it('the composer is there even with an empty thread', () => {
    escalations = [];
    show([]);
    expect(document.querySelector('.lt-card')).toBeNull();
    expect(screen.getByText('Rien dans le fil pour l’instant.')).toBeInTheDocument();
    const field = screen.getByPlaceholderText('Écrire à Ledge… (@build pour un agent)');
    fireEvent.change(field, { target: { value: '@build relance les tests' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(sent).toEqual([{ type: 'ledge.say', rid: expect.any(String), text: '@build relance les tests' }]);
    expect(field).toHaveValue('');
    expect(sent.some(m => m.type === 'chat.ask')).toBe(false);
  });

  it('a decision Ledge settled is one line « Ledge → build · décision »', () => {
    const settled: Escalation = { ...DECISION, id: 'qi-9', from: 'build@factory', state: 'answered', answer: { by: 'ledge', answers: { q1: 'sqlite' }, at: at(16, 50) } };
    escalations = [settled];
    const decision: LedgeDecision = { id: 'd1', escalationId: 'qi-9', by: 'ledge', category: 'git', summary: 'Rebase sur main avant la revue.', answers: { q1: 'sqlite' }, at: at(16, 50) };
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'ledge.thread.history', items: [{ kind: 'decided', id: 'dd1', at: at(16, 50), decisionId: 'd1' }] }); });
    render(<LangProvider lang="fr"><LedgeFeed client={client()} onClose={() => {}} onSettings={() => {}} decisions={new Map([['d1', decision]])} /></LangProvider>);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toHaveTextContent('Ledge → build · décision');
    expect(lines()[0]).toHaveTextContent('Rebase sur main avant la revue.');
    expect(lines()[0]).toHaveAttribute('data-tone', 'ledge');
    expect(lines()[0]!.querySelector('[data-feed-time]')).toHaveTextContent('16:50');
  });

  it('answering the pinned decision sends escalation.answer', () => {
    show(THREAD);
    fireEvent.click(within(document.querySelector('.lt-card') as HTMLElement).getByRole('button', { name: 'SQLite' }));
    expect(sent).toEqual([{ type: 'escalation.answer', rid: expect.any(String), id: 'qi-1', answers: { q1: 'sqlite' }, by: 'user' }]);
  });

  it('« En parler » fills the field, and the next message carries the decision', () => {
    show(THREAD);
    fireEvent.click(screen.getByRole('button', { name: 'En parler' }));
    const field = screen.getByPlaceholderText('Écrire à Ledge… (@build pour un agent)');
    expect(field).toHaveValue('À propos de « Sessions : passer du fichier JSON à SQLite ? » : ');
    fireEvent.change(field, { target: { value: `${(field as HTMLInputElement).value}pourquoi pas JSON ?` } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(sent).toEqual([{ type: 'ledge.say', rid: expect.any(String), text: 'À propos de « Sessions : passer du fichier JSON à SQLite ? » : pourquoi pas JSON ?', about: 'qi-1' }]);
  });
});
