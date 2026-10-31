import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatAction, ClientMessage, Escalation, LedgeThreadItem, OpenRigStatus, Rig, RigSeat } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { mentionAt } from '../src/chat/LedgeConversation';
import { fr } from '../src/i18n/fr';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const field = () => home().getByRole('textbox', { name: 'Ask Ledge' }) as HTMLTextAreaElement;
const says = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'ledge.say' }> => m.type === 'ledge.say');
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const seat = (name: string, rig: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@${rig}`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const rig = (id: string, name: string, seats: RigSeat[], extra: Partial<Rig> = {}): Rig =>
  ({ id, name, machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, seats, repos: [], ...extra });
const FACTORY = rig('r1', 'factory', [seat('build', 'factory'), seat('qa', 'factory'), seat('lead', 'factory')]);
const STARTER = rig('r2', 'starter', [seat('dev', 'starter')]);
const KERNEL = rig('k', 'openrig-kernel', [seat('operator', 'kernel')], { kernel: true, projectId: null });
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };

const ESCALATION: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'lead@factory', intent: 'decision', summary: 'Sessions: JSON or SQLite?',
  questions: [{ id: 'q1', question: 'JSON or SQLite?', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Keep JSON' }] }],
  createdAt: ago(4), state: 'pending', category: 'architecture', advice: 'SQLite.' };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome({ openrig = true }: { openrig?: boolean } = {}) {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('buzz', { name: 'Buzz', cwd: '/w/ledge', state: 'working' })
  ] });
  if (openrig) {
    env.d.push({ type: 'openrig.status', status: RUNNING });
    env.d.push({ type: 'rig.snapshot', machine: 'local', rigs: [KERNEL, FACTORY, STARTER] });
    await home().findByRole('tab', { name: 'Rigs · 2' });
  }
  return env;
}
const thread = (d: MockDaemon, items: LedgeThreadItem[]) => d.push({ type: 'ledge.thread.history', items });

describe('the Ledge screen, on Ledge’s thread', () => {
  it('tabs are Conversation · Rigs · Mandate; the header counts rigs, agents and standalone sessions', async () => {
    await openHome();
    expect(home().getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation', 'Rigs · 2', 'Mandate']);
    expect(home().getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    expect(home().getByText('OpenRig orchestrator · 2 rigs, 4 agents · 2 standalone sessions · settles within its mandate')).toBeVisible();
    expect(home().getByText('settles within its mandate · design, architecture and critical calls come back to you')).toBeVisible();
    expect(field()).toHaveAttribute('placeholder', "Write to Ledge… (@build for a rig's agent)");
    // No « The point », no image button.
    expect(screen.queryByRole('region', { name: 'The point' })).toBeNull();
    expect(home().queryByRole('button', { name: /image/i })).toBeNull();
  });

  it('without OpenRig the header only counts the standalone sessions, and the suggestion asks about the sessions', async () => {
    await openHome({ openrig: false });
    expect(home().getByText('2 standalone sessions')).toBeVisible();
    expect(home().getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation', 'Rigs', 'Mandate']);
    expect(home().getByRole('button', { name: 'Where are my sessions at?' })).toBeVisible();
  });

  it('sending a message sends ledge.say, never chat.ask; a suggestion ending in « … » fills the field', async () => {
    const { d, user } = await openHome();
    await user.click(home().getByRole('button', { name: 'Where is factory at?' }));
    await waitFor(() => expect(says(d)).toHaveLength(1));
    expect(says(d)[0]).toEqual({ type: 'ledge.say', rid: expect.any(String), text: 'Where is factory at?' });
    await user.click(home().getByRole('button', { name: 'Launch a rig…' }));
    expect(field()).toHaveValue('Launch a rig ');
    await user.type(field(), 'factory{Enter}');
    await waitFor(() => expect(says(d)).toHaveLength(2));
    expect(says(d)[1]).toMatchObject({ text: 'Launch a rig factory' });
    expect(field()).toHaveValue('');
    expect(d.received.some(m => m.type === 'chat.ask')).toBe(false);
    for (const s of ['What did you settle?', 'Who needs me?']) expect(home().getByRole('button', { name: s })).toBeVisible();
  });

  it('draws the thread: the user on the right with « You », Ledge on the left, « See older » when there is more', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'ledge.thread.history', items: [
      { kind: 'user', id: 'u1', at: ago(3), text: 'build: merge it', to: '@build' },
      { kind: 'ledge', id: 'l1', at: ago(2), text: 'Sent to build.' }
    ], before: 'u1' });
    const mine = (await home().findByText('build: merge it')).closest('[data-author="user"].lt-row') as HTMLElement;
    expect(mine).toHaveTextContent(/@build/);
    expect(mine).toHaveTextContent(/You · \d\d:\d\d/);
    expect(home().getByText('Sent to build.').closest('[data-author="ledge"]')).toHaveTextContent(/Ledge · \d\d:\d\d/);
    await user.click(home().getByRole('button', { name: 'See older' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'ledge.thread.request', before: 'u1' }));
  });

  it('a ledge bubble shows its turn cards under it', async () => {
    const { d } = await openHome();
    const at = ago(1);
    const actions: ChatAction[] = [
      { action: 'session.archive', args: { session: 'otto' }, summary: 'Archiver **Otto**', vars: { session: 'Otto' }, risk: 'reversible', session: 'otto' },
      { action: 'session.close', args: { session: 'buzz' }, summary: 'Fermer **Buzz**', vars: { session: 'Buzz' }, risk: 'destructive', session: 'buzz' }
    ];
    d.push({ type: 'chat.history', turns: [{ qid: 'q-1', question: 'Range', askedAt: at, steps: [], answer: 'Voici.', answeredAt: at, actions }] });
    thread(d, [{ kind: 'user', id: 'q-1', at, text: 'Range', qid: 'q-1' }, { kind: 'ledge', id: 'l1', at, text: 'Voici.', qid: 'q-1' }]);
    const bubble = (await home().findByText('Voici.')).closest('[data-author="ledge"]') as HTMLElement;
    expect(within(bubble).getByRole('region', { name: 'Plan of 2 actions' })).toBeVisible();
  });

  it('a decision in message answers with the option id', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'escalation.updated', escalation: ESCALATION });
    thread(d, [{ kind: 'escalation', id: 'e1', at: ago(4), escalationId: 'qi-1' }]);
    const card = within((await home().findByText('Sessions: JSON or SQLite?')).closest('article') as HTMLElement);
    expect(card.getByText('My view: SQLite.')).toBeVisible();
    await user.click(card.getByRole('button', { name: 'SQLite' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'escalation.answer', rid: expect.any(String), id: 'qi-1', answers: { q1: 'sqlite' }, by: 'user' }));
    await waitFor(() => expect(card.getByRole('button', { name: 'SQLite' })).toBeDisabled());
  });

  it('« Talk about it » prefills the field and the next send carries about', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'escalation.updated', escalation: ESCALATION });
    thread(d, [{ kind: 'escalation', id: 'e1', at: ago(4), escalationId: 'qi-1' }]);
    await user.click(await home().findByRole('button', { name: 'Talk about it' }));
    expect(field()).toHaveValue('About « Sessions: JSON or SQLite? »: ');
    expect(field()).toHaveFocus();
    await user.type(field(), 'why not both?{Enter}');
    await waitFor(() => expect(says(d)).toHaveLength(1));
    expect(says(d)[0]).toEqual({ type: 'ledge.say', rid: expect.any(String), text: 'About « Sessions: JSON or SQLite? »: why not both?', about: 'qi-1' });
    // The next one is a plain message again.
    await user.type(field(), 'thanks{Enter}');
    await waitFor(() => expect(says(d)).toHaveLength(2));
    expect(says(d)[1]).not.toHaveProperty('about');
  });

  it('@ completes seats first, then the standalone sessions', async () => {
    const { user } = await openHome();
    await user.type(field(), 'ask @bu');
    const list = within(home().getByRole('listbox', { name: 'Mention' }));
    expect(list.getAllByRole('option').map(o => o.textContent)).toEqual(['@build · factory', 'session Buzz']);
    await user.keyboard('{Enter}');
    expect(field()).toHaveValue('ask @build ');
  });

  it('Mandate shows the Mandat tab (lot 7); the Rigs tab keeps its sub-tab', async () => {
    const { user } = await openHome();
    await user.click(home().getByRole('tab', { name: 'Mandate' }));
    expect(within(home().getByRole('tabpanel', { name: 'Mandate' })).getByRole('tab', { name: 'What Ledge settles' })).toBeVisible();
    await user.click(home().getByRole('tab', { name: 'Rigs · 2' }));
    const sub = within(home().getByRole('tablist', { name: 'Rig views' }));
    expect(sub.getByRole('tab', { name: 'Running · 2' })).toHaveAttribute('aria-selected', 'true');
    await user.click(sub.getByRole('tab', { name: /^Agents/ }));
    await user.click(home().getByRole('tab', { name: 'Conversation' }));
    await user.click(home().getByRole('tab', { name: 'Rigs · 2' }));
    expect(within(home().getByRole('tablist', { name: 'Rig views' })).getByRole('tab', { name: /^Agents/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('mentionAt only knows @', () => {
    expect(mentionAt('ask @ot')).toEqual({ sigil: '@', query: 'ot', start: 4 });
    expect(mentionAt('#led')).toBeNull();
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });

  it('the French labels are the plan’s, word for word', () => {
    expect(Object.values(fr.home.tabs)).toEqual(['Conversation', 'Rigs', 'Mandat']);
    expect(fr.home.placeholder).toBe("Écrire à Ledge… (@build pour un agent d'un rig)");
    expect([fr.home.suggest.launch, fr.home.suggest.whereIs('factory'), fr.home.suggest.decided, fr.home.suggest.needsMe]).toEqual(['Lance un rig…', 'Où en est factory ?', "Qu'as-tu tranché ?", 'Qui a besoin de moi ?']);
    expect(fr.home.suggest.sessions).toBe('Où en sont mes sessions ?');
    expect(fr.home.footer).toBe('tranche dans son mandat · design, architecture et critique te reviennent');
    expect(fr.home.header(2, 8, 4)).toBe('Orchestrateur OpenRig · 2 rigs, 8 agents · 4 sessions seules · tranche dans son mandat');
    expect(fr.home.solo(4)).toBe('4 sessions seules');
    expect(fr.ledgeThread.escalation.talk).toBe('En parler');
    expect(fr.home.talkAbout('Sessions : JSON ou SQLite ?')).toBe('À propos de « Sessions : JSON ou SQLite ? » : ');
  });
});
