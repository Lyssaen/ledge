import { describe, it, expect } from 'vitest';
import type { Escalation, Exchange, Rig, Session } from '@ledge/protocol';
import { handleLine, waitingOf, LINE_LINGER_MS } from '../src/surface/handleLine';

const now = Date.parse('2026-10-30T16:40:00Z');
const at = (ms: number) => new Date(ms).toISOString();
const esc = (p: Partial<Escalation> = {}): Escalation => ({
  id: 'q1', source: 'rig', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', intent: 'decision', summary: 'JSON ou SQLite ?',
  questions: [], createdAt: at(now - 60_000), state: 'pending', category: 'architecture', ...p
});
const exchange: Exchange = { id: 'x1', machine: 'local', rigId: 'factory', from: 'build@factory', to: 'review-a@factory', kind: 'message', text: 'Candidat prêt, tests verts', at: at(now) };

describe('handleLine', () => {
  it('calm when nothing happens', () => {
    expect(handleLine({ escalations: [], attention: 0, now })).toEqual({ kind: 'calm' });
  });
  it('for you wins over a fresh exchange', () => {
    expect(handleLine({ escalations: [esc()], attention: 0, lastExchange: { x: exchange, rigName: 'factory', seenAt: now }, now }))
      .toEqual({ kind: 'forYou', category: 'architecture', summary: 'orch-lead : JSON ou SQLite ?', count: 1 });
  });
  it('an exchange lingers 5 s then calm', () => {
    const lastExchange = { x: exchange, rigName: 'factory', seenAt: now };
    expect(LINE_LINGER_MS).toBe(5000);
    expect(handleLine({ escalations: [], attention: 0, lastExchange, now: now + 4999 }))
      .toEqual({ kind: 'exchange', rigName: 'factory', from: 'build', to: 'review-a', text: 'Candidat prêt, tests verts' });
    expect(handleLine({ escalations: [], attention: 0, lastExchange, now: now + 5001 })).toEqual({ kind: 'calm' });
  });
  it('a waiting session counts as for you', () => {
    expect(handleLine({ escalations: [], attention: 1, waiting: { name: 'Otto', text: 'npm test' }, now }))
      .toEqual({ kind: 'forYou', summary: 'Otto : npm test', count: 1 });
  });
  it('a decision beats an exchange for 5 s, then the exchange (if still fresh) or calm', () => {
    const lastDecided = { text: "J'ai tranché pour build : merge, pas de rebase", seenAt: now };
    const lastExchange = { x: exchange, rigName: 'factory', seenAt: now + 2000 };
    expect(handleLine({ escalations: [], attention: 0, lastDecided, lastExchange, now: now + 3000 })).toEqual({ kind: 'decided', text: lastDecided.text });
    expect(handleLine({ escalations: [], attention: 0, lastDecided, lastExchange, now: now + 5001 })).toMatchObject({ kind: 'exchange' });
    expect(handleLine({ escalations: [], attention: 0, lastDecided, now: now + 5001 })).toEqual({ kind: 'calm' });
  });
  it('counts pending and grace decisions, open asks included, with the waiting sessions; the oldest escalation speaks; updates and settled ones do not count', () => {
    const escalations = [
      esc({ id: 'new', createdAt: at(now - 1000), summary: 'Merge ?', category: 'git', from: 'build@factory' }),
      esc({ id: 'old', createdAt: at(now - 90_000), state: 'grace', category: undefined, summary: '', questions: [{ id: 'a', question: 'Quel port ?', options: [{ id: '1', label: '80' }, { id: '2', label: '443' }] }] }),
      esc({ id: 'ask', source: 'ask', createdAt: at(now - 30_000), from: 'Lu' }),
      esc({ id: 'shutAsk', source: 'ask', state: 'answered', createdAt: at(now - 900_000), from: 'Mo' }),
      esc({ id: 'upd', intent: 'update', createdAt: at(now - 900_000) }),
      esc({ id: 'done', state: 'answered', createdAt: at(now - 900_000) }),
      esc({ id: 'shut', state: 'closed', createdAt: at(now - 900_000) })
    ];
    expect(handleLine({ escalations, attention: 1, waiting: { name: 'Otto', text: 'npm test' }, now }))
      .toEqual({ kind: 'forYou', summary: 'orch-lead : Quel port ?', count: 4 });
  });
  it('an open ask whose session keeps working is for you: count 1, its summary', () => {
    const ask = esc({ id: 'k1', source: 'ask', rigId: undefined, from: 'Otto', category: undefined, summary: 'Quel nom pour la table ?' });
    const sessions = [{ id: 'a', name: 'Otto', state: 'working', lastActivityAt: at(now) }] as unknown as Session[];
    expect(handleLine({ escalations: [ask], ...waitingOf(sessions, [], [ask]), now }))
      .toEqual({ kind: 'forYou', summary: 'Otto : Quel nom pour la table ?', count: 1 });
  });
  it('says the summary through the given words', () => {
    expect(handleLine({ escalations: [], attention: 1, waiting: { name: 'Otto', text: 'npm test' }, now, summary: (who, what) => `${who}: ${what}` }))
      .toMatchObject({ summary: 'Otto: npm test' });
  });
});

describe('waitingOf', () => {
  const session = (p: Partial<Session>): Session => ({
    id: 's', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: '', tmuxSession: null, state: 'working', helpers: [],
    startedAt: at(now - 600_000), lastActivityAt: at(now - 60_000), ...p
  } as Session);
  it('counts the standalone sessions waiting on the user, the oldest first; a rig seat or an offline session does not count', () => {
    const sessions = [
      session({ id: 'a', name: 'Pim', state: 'waiting_input', lastActivityAt: at(now - 10_000), pending: { kind: 'question', text: 'Quel nom ?', source: 'hook' } }),
      session({ id: 'b', name: 'Otto', state: 'waiting_permission', lastActivityAt: at(now - 50_000), pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
      session({ id: 'c', name: 'seat', state: 'waiting_permission', rig: { machine: 'local', rigId: 'factory' } as Session['rig'], pending: { kind: 'permission', text: 'rm', source: 'hook' } }),
      session({ id: 'd', name: 'Lu', state: 'working' }),
      session({ id: 'e', name: 'Ghost', state: 'waiting_input', offline: true, lastActivityAt: at(now - 500_000), pending: { kind: 'question', text: '?', source: 'hook' } })
    ];
    const rigs = [{ id: 'factory', machine: 'local', seats: [{ ref: 'dev@factory', address: '@dev', name: 'dev', runtime: 'claude', state: 'working', sessionId: 'c' }] }] as unknown as Rig[];
    expect(waitingOf(sessions, rigs)).toEqual({ attention: 2, waiting: { name: 'Otto', text: 'npm test' } });
    expect(waitingOf([], rigs)).toEqual({ attention: 0 });
  });
  it('a waiting brain session counts (its prompts must reach the user, lot 7)', () => {
    const brain = session({ id: 'b', name: 'Ledge', brain: true, state: 'waiting_input', pending: { kind: 'question', text: 'Trust this folder?', source: 'hook' } });
    expect(waitingOf([brain], [])).toEqual({ attention: 1, waiting: { name: 'Ledge', text: 'Trust this folder?' } });
  });
  it('a waiting session with an open ask is counted once, as the ask (same machine and name)', () => {
    const otto = session({ id: 'a', name: 'Otto', state: 'waiting_input', pending: { kind: 'question', text: 'Quel nom ?', source: 'hook' } });
    const ask = esc({ id: 'k1', source: 'ask', machine: 'local', from: 'Otto', category: undefined, summary: 'Quel nom ?' });
    expect(waitingOf([otto], [], [ask])).toEqual({ attention: 0 });
    expect(handleLine({ escalations: [ask], ...waitingOf([otto], [], [ask]), now })).toMatchObject({ kind: 'forYou', count: 1, summary: 'Otto : Quel nom ?' });
    // Another machine's Otto, or a settled ask: the session counts again.
    expect(waitingOf([otto], [], [{ ...ask, machine: 'srv' }]).attention).toBe(1);
    expect(waitingOf([otto], [], [{ ...ask, state: 'answered' }]).attention).toBe(1);
  });
});
