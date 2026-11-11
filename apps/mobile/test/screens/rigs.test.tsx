// The Rigs tab (docs/mockups/ledge-mobile-refonte/m4-rigs.html): the list, a rig, the kernel and Max, on the whole app with a PC that
// sends its rigs (`daemon.rigs`), and what each tap sends to it.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { session } from '../model/fixtures';
import { goal, kernelGraph, ledgeGraph, openrig, routing } from '../model/openrig-fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

const C = copy.rigs;
const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
afterEach(() => { wide(false); });

/** The app at `hash`, its PC sending its rigs (or not), OpenRig's state delivered. */
function open(hash: string, o: { rigs?: boolean; confirm?: boolean; state?: boolean; sessions?: Parameters<typeof snapshot>[0] } = {}) {
  const t = app('ready', { hash });
  const snap = snapshot(o.sessions ?? [], 'WSL', undefined, { confirm: o.confirm ?? false }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  act(() => t.deliver(o.rigs === false ? snap : { ...snap, daemon: { ...snap.daemon, rigs: true } }));
  if (o.rigs !== false && o.state !== false) act(() => t.deliver({ type: 'rigs.state', state: openrig() }));
  return t;
}

describe('the Rigs list', () => {
  it('says the PC does not send its rigs yet, as before', () => {
    open('#/rigs', { rigs: false });
    expect(screen.getByText(copy.rigs.notSent('WSL'))).toBeTruthy();
  });

  it('shows OpenRig, then the rigs, running first, each opening its view', () => {
    const t = open('#/rigs');
    expect(t.of('rigs.state')).toHaveLength(1);
    const rigs = screen.getByRole('region', { name: C.title });
    const rows = within(rigs).getAllByRole('link');
    expect(rows.map(r => r.getAttribute('href'))).toEqual(['#/rigs/ledge-dev', '#/rigs/synapse-review']);
    expect(screen.getByText(C.kernel)).toBeTruthy();
    expect(screen.getByText(C.rigsHead(1))).toBeTruthy();
  });

  it('reads OpenRig while it has not answered, and offers to start it once stopped', () => {
    const t = open('#/rigs', { state: false });
    expect(screen.getByText(C.loading)).toBeTruthy();
    act(() => t.deliver({ type: 'rigs.state', error: 'daemon_stopped' }));
    fireEvent.click(screen.getByRole('button', { name: C.stopped.start }));
    return waitFor(() => expect(t.of('rigs.act')[0]?.action).toEqual({ kind: 'daemon.start', restore: 'last' }));
  });
});

describe('a rig', () => {
  it('reads its topology, queue, permissions and snapshots, and draws its seats by pod', () => {
    const t = open('#/rigs/ledge-dev');
    expect(t.of('rigs.graph').map(m => m.rig)).toEqual(['ledge-dev']);
    expect(t.of('rigs.queue')).toHaveLength(1);
    expect(t.of('rigs.permissions')).toHaveLength(1);
    expect(t.of('rigs.snapshots')).toHaveLength(1);
    act(() => t.deliver({ type: 'rigs.graph', rig: 'ledge-dev', graph: ledgeGraph() }));
    expect(screen.getByRole('button', { name: C.seatLabel('dev-front', C.seatState.work) })).toBeTruthy();
    expect(screen.getByText('5/5')).toBeTruthy();
  });

  it('opens a seat’s sheet with its links and its settings', () => {
    const t = open('#/rigs/ledge-dev');
    act(() => t.deliver({ type: 'rigs.graph', rig: 'ledge-dev', graph: ledgeGraph() }));
    fireEvent.click(screen.getByRole('button', { name: C.seatLabel('dev-front', C.seatState.work) }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText([C.seat.delegatesTo('pilot-lead'), C.seat.delegates('review-qa'), C.seat.collaborates('dev-back')].join(' · '))).toBeTruthy();
    expect(within(sheet).getByText(C.seat.noSession)).toBeTruthy();
  });

  it('asks the passkey to stop; without one, says to protect the agreements first and sends nothing', () => {
    const t = open('#/rigs/ledge-dev');
    fireEvent.click(screen.getByRole('button', { name: C.actions.stop }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(C.confirm.stop('ledge-dev', 'WSL'))).toBeTruthy();
    expect(within(sheet).getByText(C.protectFirst)).toBeTruthy();
    expect(t.of('rigs.act')).toHaveLength(0);
  });

  it('adds a seat without a check', async () => {
    const t = open('#/rigs/ledge-dev');
    fireEvent.click(screen.getByRole('button', { name: C.actions.seats }));
    fireEvent.click(screen.getByRole('button', { name: C.reseat.more('dev.front') }));
    fireEvent.click(screen.getByRole('button', { name: C.reseat.add(1) }));
    await waitFor(() => expect(t.of('rigs.seats')).toHaveLength(1));
    expect(t.of('rigs.seats')[0]).toMatchObject({ rig: 'ledge-dev', seats: { 'dev.front': 2 }, delegation: 'pairs' });
  });

  it('starts a stopped rig from its last snapshot, or fresh', async () => {
    const t = open('#/rigs/synapse-review');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${C.fresh}`) }));
    fireEvent.click(screen.getByRole('button', { name: C.actions.start }));
    await waitFor(() => expect(t.of('rigs.act')).toHaveLength(1));
    expect(t.of('rigs.act')[0]!.action).toEqual({ kind: 'rig.start', rig: 'synapse-review', fresh: ['lead.main', 'rev.one', 'rev.two'] });
  });

  it('stays readable offline, and sends nothing', () => {
    const t = open('#/rigs/ledge-dev');
    act(() => t.set('pc_offline'));
    for (const name of [C.actions.seats, C.actions.restart, C.actions.stop]) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a rig that is gone, on the whole screen, with the way back (m4-complement.html, §2)', () => {
    open('#/rigs/gone');
    expect(screen.getByRole('heading', { name: C.readError.unknown_rig })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: C.back }).some(a => a.getAttribute('href') === '#/rigs')).toBe(true);
  });

  it('takes the whole screen when the PC no longer knows the rig it lists', () => {
    const t = open('#/rigs/ledge-dev');
    act(() => t.deliver({ type: 'rigs.graph', rig: 'ledge-dev', error: 'unknown_rig' }));
    expect(screen.getByRole('heading', { name: C.readError.unknown_rig })).toBeTruthy();
    expect(screen.queryByRole('button', { name: C.actions.stop })).toBeNull();
  });

  it('says a queue it could not read in its place, and reads it again on « Réessayer »', () => {
    const t = open('#/rigs/ledge-dev');
    act(() => t.deliver({ type: 'rigs.queue', rig: 'ledge-dev', rows: [], closed: [], truncated: false, error: 'unavailable' }));
    expect(screen.getByText(C.queue.unavailable)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.unavailable.retry }));
    expect(t.of('rigs.queue')).toHaveLength(2);
  });

  it('keeps « Ouvrir sa session » in the sheet of a seat Ledge does not follow, disabled, and says why', () => {
    const t = open('#/rigs/ledge-dev');
    act(() => t.deliver({ type: 'rigs.graph', rig: 'ledge-dev', graph: ledgeGraph() }));
    fireEvent.click(screen.getByRole('button', { name: C.seatLabel('review-qa', C.seatState.idle) }));
    const sheet = screen.getByRole('dialog');
    expect((within(sheet).getByRole('button', { name: C.seat.openSession }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText(C.seat.noSession)).toBeTruthy();
  });
});

describe('the kernel', () => {
  it('draws Max, the advisor and the queue worker, and the routing newest first (Q43)', () => {
    const t = open('#/kernel');
    expect(t.of('rigs.graph').map(m => m.rig)).toEqual(['kernel']);
    expect(t.of('rigs.routing')).toHaveLength(1);
    expect(t.of('rigs.goals')).toHaveLength(1);
    act(() => t.deliver({ type: 'rigs.graph', rig: 'kernel', graph: kernelGraph() }));
    act(() => t.deliver(routing()));
    expect(screen.getByText('Max')).toBeTruthy();
    const moves = screen.getAllByText(/^« .* »$/).map(e => e.textContent);
    expect(moves).toEqual([C.kernelView.actor('pilot-lead'), C.kernelView.actor('dev-back'), C.kernelView.actor('design-ux')]);
    expect(screen.getByText(C.kernelView.change.handed('design-ux'))).toBeTruthy();
  });

  it('shows Max’s last word and « Parler à Max »', () => {
    const t = open('#/kernel');
    act(() => t.deliver({ type: 'rigs.goals', goals: [goal()] }));
    expect(screen.getByText(goal().proposal!.text)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.kernelView.talk }).getAttribute('href')).toBe('#/max');
  });

  it('asks before stopping the daemon, saying what stops with it', () => {
    open('#/kernel');
    const daemon = screen.getAllByRole('button', { name: C.actions.stop }).at(-1)!;
    fireEvent.click(daemon);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(C.confirm.stopDaemon('WSL'))).toBeTruthy();
    expect(within(sheet).getByText(`${C.confirm.daemonStops(1)} ${C.confirm.working(1)}`)).toBeTruthy();
  });

  it('shows each running rig’s level beside its seats, read on opening the kernel (F)', () => {
    const t = open('#/kernel');
    expect(t.of('rigs.permissions').map(m => m.rig)).toContain('ledge-dev');
    const seats = ['pilot.lead', 'design.ux', 'dev.front', 'dev.back', 'review.qa'].map(id => ({ logicalId: id, session: `${id.replace('.', '-')}@ledge-dev`, policySource: 'member_policy', policy: 'builtin:auto' }));
    act(() => t.deliver({ type: 'rigs.permissions', rig: 'ledge-dev', seats } as PhoneServerMessage));
    expect(screen.getByText(`${C.seatCount(5)} · ${C.level.auto}`)).toBeTruthy();
  });

  it('writes a row that waits as « attend la ligne … », shortened as Desktop does', () => {
    const t = open('#/kernel');
    act(() => t.deliver({ type: 'rigs.routing', entries: [{ qitem: 'q', at: '2026-11-10 20:30:00', seat: 'review-qa@ledge-dev', change: 'blocked on qitem-20261110203000-0000c8a66d5a', rig: 'ledge-dev', summary: 'Revue M4' }] }));
    expect(screen.getByText(C.kernelView.change.blocked('…c8a66d5a'))).toBeTruthy();
  });

  it('opens its « ⋯ »: read again, restart and stop the kernel through the same sheets (Q73)', () => {
    const t = open('#/kernel');
    fireEvent.click(screen.getByRole('button', { name: C.more }));
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual([C.kernelView.menu.refresh, C.kernelView.menu.restart, C.kernelView.menu.stop]);
    fireEvent.click(screen.getByRole('menuitem', { name: C.kernelView.menu.refresh }));
    expect(t.of('rigs.routing')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: C.more }));
    fireEvent.click(screen.getByRole('menuitem', { name: C.kernelView.menu.stop }));
    expect(within(screen.getByRole('dialog')).getByText(C.confirm.stopKernel('WSL'))).toBeTruthy();
  });

  it('dates Max’s last word by the trail’s step that carries it, and gives no time without one (E)', () => {
    const t = open('#/kernel');
    act(() => t.deliver({ type: 'rigs.goals', goals: [goal()] }));
    expect(screen.getByText(C.kernelView.lastMessage(null))).toBeTruthy();
  });

  it('offers to start a stopped kernel, with no check', async () => {
    const t = open('#/kernel', { state: false });
    act(() => t.deliver({ type: 'rigs.state', state: openrig({ kernel: { state: 'stopped' } }) }));
    fireEvent.click(screen.getByRole('button', { name: C.kernelView.startKernel }));
    await waitFor(() => expect(t.of('rigs.act')[0]?.action).toEqual({ kind: 'kernel.start' }));
  });
});

describe('Max', () => {
  it('lists his goals and sends a new one from the field', async () => {
    const t = open('#/max');
    act(() => t.deliver({ type: 'rigs.goals', goals: [goal()] }));
    expect(screen.getByRole('link', { name: new RegExp(goal().text.replace('.', '\\.')) }).getAttribute('href')).toBe('#/max/goal-0001-abcd');
    fireEvent.change(screen.getByLabelText(C.max.goalPlaceholder), { target: { value: 'Documenter le multi-machine.' } });
    fireEvent.click(screen.getByRole('button', { name: C.max.send }));
    await waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(1));
    expect(t.of('rigs.goal.send')[0]!.text).toBe('Documenter le multi-machine.');
  });

  it('sends a goal that may have gone again under the same id', async () => {
    const t = open('#/max');
    act(() => t.deliver({ type: 'rigs.goals', goals: [] }));
    fireEvent.change(screen.getByLabelText(C.max.goalPlaceholder), { target: { value: 'Une équipe' } });
    fireEvent.click(screen.getByRole('button', { name: C.max.send }));
    await waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(1));
    const first = t.of('rigs.goal.send')[0]!;
    act(() => t.deliver({ type: 'rigs.goal.sent', op: first.op, goalId: first.goalId, ok: false, error: 'uncertain' }));
    expect(screen.getByText(C.max.errors.uncertain.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.max.sendAgain }));
    await waitFor(() => expect(t.of('rigs.goal.send')).toHaveLength(2));
    expect(t.of('rigs.goal.send')[1]!.goalId).toBe(first.goalId);
  });

  it('says goals it could not read, and reads them again', () => {
    const t = open('#/max');
    act(() => t.deliver({ type: 'rigs.goals', goals: [], error: 'unavailable' } as PhoneServerMessage));
    expect(screen.getByText(C.max.goalsUnavailable)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.unavailable.retry }));
    expect(t.of('rigs.goals').length).toBeGreaterThan(1);
  });

  it('goes back to the kernel from the goals, and to Max from a goal', () => {
    open('#/max');
    expect(screen.getByRole('link', { name: C.backKernel })).toBeTruthy();
  });

  it('opens a goal as a thread: the proposal waits in « À toi », the field writes to Max about it', async () => {
    const t = open('#/max/goal-0001-abcd');
    act(() => t.deliver({ type: 'rigs.goals', goals: [goal()] }));
    expect(screen.getByText(C.max.proposal)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.max.seeAtoi }).getAttribute('href')).toBe('#/');
    expect(screen.getByText(C.max.trail.taken)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(C.max.replyPlaceholder), { target: { value: 'Garde les tokens de M0.' } });
    fireEvent.click(screen.getByRole('button', { name: C.max.send }));
    await waitFor(() => expect(t.of('rigs.goal.reply')).toHaveLength(1));
    expect(t.of('rigs.goal.reply')[0]).toMatchObject({ goalId: 'goal-0001-abcd', text: 'Garde les tokens de M0.' });
  });
});

describe('on a wide screen', () => {
  it('keeps the list on the left and the rig on the right, its actions in the pane’s head', () => {
    wide(true);
    open('#/rigs/ledge-dev');
    expect(screen.getByRole('region', { name: C.title })).toBeTruthy();
    expect(screen.getByText(C.seatsByRole)).toBeTruthy();
    expect(screen.getByRole('link', { name: /ledge-dev/ }).getAttribute('aria-current')).toBe('page');
  });

  it('opens a followed seat’s session on a tap, its sheet on a right click (Q74)', () => {
    wide(true);
    const t = open('#/rigs/ledge-dev', { sessions: [session('df', { name: 'dev-front', rig: { name: 'ledge-dev', role: 'dev.front' }, state: 'working' })] });
    act(() => t.deliver({ type: 'rigs.graph', rig: 'ledge-dev', graph: ledgeGraph() }));
    const node = document.querySelector<HTMLElement>('[data-seat="dev.front"]')!;
    fireEvent.contextMenu(node);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(node);
    expect(location.hash).toBe('#/thread/df');
  });

  it('shows Max’s current goal as a thread in the kernel', () => {
    wide(true);
    const t = open('#/kernel');
    act(() => t.deliver({ type: 'rigs.goals', goals: [goal()] }));
    expect(screen.getByText(`${C.kernelView.max} · ${goal().text}`)).toBeTruthy();
    expect(screen.getByLabelText(C.max.replyPlaceholder)).toBeTruthy();
  });
});
