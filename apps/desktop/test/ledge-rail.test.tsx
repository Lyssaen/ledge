import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Escalation, LedgeThreadItem, OpenRigStatus, Rig, RigSeat } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { LedgeRail } from '../src/chat/LedgeRail';
import { LangProvider } from '../src/i18n/lang';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const rail = () => within(home().getByRole('complementary', { name: 'Ledge rail' }));
const says = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'ledge.say' }> => m.type === 'ledge.say');
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const seat = (name: string, rig: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@${rig}`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const rig = (id: string, name: string, seats: RigSeat[], extra: Partial<Rig> = {}): Rig =>
  ({ id, name, machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, seats, repos: [], ...extra });
const FACTORY = rig('r1', 'factory', [seat('build', 'factory'), seat('qa', 'factory'), seat('lead', 'factory'), seat('rev', 'factory', { state: 'idle' }), seat('old', 'factory', { state: 'stopped' })]);
const STARTER = rig('r2', 'starter', [seat('dev', 'starter')]);
const KERNEL = rig('k', 'openrig-kernel', [seat('operator', 'kernel')], { kernel: true, projectId: null });
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const ESC: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'lead@factory', intent: 'decision', summary: 'Sessions: JSON or SQLite?',
  questions: [{ id: 'q1', question: 'JSON or SQLite?', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Keep JSON' }] }],
  createdAt: ago(4), state: 'pending', category: 'architecture', advice: 'SQLite.' };
const MANY: Escalation = { ...ESC, id: 'qi-2', summary: 'Pick one', questions: [{ id: 'q1', question: '?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }] };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); vi.restoreAllMocks(); delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('luna', { name: 'Luna', cwd: '/w/ledge', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } })
  ] });
  env.d.push({ type: 'openrig.status', status: RUNNING });
  env.d.push({ type: 'rig.snapshot', machine: 'local', rigs: [KERNEL, FACTORY, STARTER] });
  env.d.push({ type: 'escalation.updated', escalation: ESC });
  await home().findByRole('tab', { name: 'Rigs · 2' });
  await rail().findByText('JSON or SQLite?');
  return env;
}
const thread = (d: MockDaemon, items: LedgeThreadItem[]) => d.push({ type: 'ledge.thread.history', items });

describe('the Ledge screen rail', () => {
  it('Your turn lists the escalation with its options and the sessions with their buttons', async () => {
    const { d, user } = await openHome();
    const r = rail();
    expect(r.getByText('Your turn · 3')).toBeVisible();
    expect(r.getByRole('button', { name: 'SQLite' })).toHaveClass('pri');
    await user.click(r.getByRole('button', { name: 'Keep JSON' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'escalation.answer', rid: expect.any(String), id: 'qi-1', answers: { q1: 'json' }, by: 'user' }));
    expect(r.getByRole('button', { name: 'Yes' })).toBeVisible();
    expect(r.getByRole('button', { name: 'No' })).toBeVisible();
    await user.click(r.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Home: Ledge, the operator' })).toBeNull());
  });

  it('Yes on a permission decides through the usual path', async () => {
    const { d, user } = await openHome();
    await user.click(rail().getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(d.received.some(m => m.type === 'session.decide' && m.decision === 'accept')).toBe(true));
  });

  it('Rigs shows n/m at work, the bar and a Table button that filters the atelier', async () => {
    const { user } = await openHome();
    const r = rail();
    expect(r.getByText('Rigs · 2')).toBeVisible();
    expect(r.getByText('factory 3/4 at work')).toBeVisible();
    expect(r.getByText('starter 1/1 at work')).toBeVisible();
    expect(r.getAllByRole('progressbar')).toHaveLength(2);
    await user.click(r.getAllByRole('button', { name: 'Table' })[0]!);
    expect(screen.queryByRole('region', { name: 'Home: Ledge, the operator' })).toBeNull();
  });

  it('Settled today is hidden without decisions', async () => {
    await openHome();
    expect(rail().queryByText(/Settled today/)).toBeNull();
  });

  it('« Summarise the day » sends a ledge.say in the user’s language', async () => {
    const { d, user } = await openHome();
    await user.click(rail().getByRole('button', { name: 'Summarise the day' }));
    await waitFor(() => expect(says(d)).toHaveLength(1));
    expect(says(d)[0]!.text).toBe('Summarise my day: what the rigs did, what I settled, what is waiting for me.');
  });

  it('View on an escalation scrolls the thread to its card, once', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { d, user } = await openHome();
    d.push({ type: 'escalation.updated', escalation: MANY });
    thread(d, [{ kind: 'escalation', id: 'e2', at: ago(3), escalationId: 'qi-2' }]);
    await home().findByText('Pick one', { selector: 'article *' });
    scroll.mockClear();
    await user.click(rail().getByRole('button', { name: 'View' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect((scroll.mock.contexts[0] as HTMLElement).closest('[data-escalation-card="qi-2"]')).not.toBeNull();
  });

  it('the sidebar View button goes to the same card', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { d, side, user } = await openHome();
    d.push({ type: 'escalation.updated', escalation: MANY });
    thread(d, [{ kind: 'escalation', id: 'e2', at: ago(3), escalationId: 'qi-2' }]);
    await home().findByText('Pick one', { selector: 'article *' });
    scroll.mockClear();
    await user.click(within(side.getByRole('region', { name: 'Your turn' })).getByRole('button', { name: 'View' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  });

  it('narrow: one collapsed line, expandable', async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    const client = { send, onMessage: () => () => {}, fleet: undefined } as never;
    const { rerender } = render(<LangProvider lang="en"><LedgeRail client={client} view={{ sessions: [], machines: [] } as never} dispatch={() => {}} compact /></LangProvider>);
    expect(screen.getByRole('button', { name: /Your turn · 0 · Rigs · 0/ })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: /Your turn · 0/ }));
    expect(screen.getByRole('button', { name: /Your turn · 0/ })).toHaveAttribute('aria-expanded', 'true');
    rerender(<LangProvider lang="en"><LedgeRail client={client} view={{ sessions: [], machines: [] } as never} dispatch={() => {}} compact /></LangProvider>);
  });
});
