import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ClientMessage, OperatorNotice, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';
import { fakeSession } from './mockDaemon';

/** A client with a fleet of two machines whose operator notices the test sets; every send is recorded with its machine. */
function fleetClient() {
  const sent: Array<{ machine: string; msg: ClientMessage }> = [];
  let notices: ReadonlyMap<string, OperatorNotice[]> = new Map();
  const listeners = new Set<() => void>();
  let machines = [{ id: 'local', label: 'Local', status: 'open', ready: true }, { id: 'dev', label: 'Devbox', status: 'open', ready: true }];
  const fleet = {
    selected: () => 'local', select() {}, terminal: () => null, turnMachine: () => machines[0], configure() {}, probe: async () => ({}), retry() {},
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    machines: () => machines, operator: () => notices,
    sendTo: (machine: string, msg: ClientMessage) => { sent.push({ machine, msg }); return true; }
  };
  const client = { connect() {}, close() {}, send: (msg: ClientMessage) => { if (msg.type !== 'session.thread') sent.push({ machine: 'any', msg }); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {}, fleet } as unknown as DaemonClient;
  const set = (next: Record<string, OperatorNotice[]>) => act(() => { notices = new Map(Object.entries(next)); listeners.forEach(fn => fn()); });
  /** A machine drops or comes back: a new list, as the fleet gives one. */
  const ready = (id: string, on: boolean) => act(() => { machines = machines.map(m => (m.id === id ? { ...m, ready: on, status: on ? 'open' : 'closed' } : m)); listeners.forEach(fn => fn()); });
  return { client, sent, set, ready };
}

const point = (qid: string, at: string): OperatorNotice => ({ id: `point:${qid}`, kind: 'point', qid, text: 'Deux choses pour toi : **pilot-lead** attend ta décision sur #309, et **Rex** a fini.', priority: 'routine', at });
const rigAsk = (qitem: string, at: string, qid?: string): OperatorNotice => ({ id: `rig.ask:${qitem}`, kind: 'rig.ask', ...(qid ? { qid } : {}), text: 'Fusionner #309 maintenant ?', who: 'pilot-lead', rig: 'ledge-dev', qitem, options: [{ id: 'merge', label: 'Fusionner' }, { id: 'wait', label: 'Attendre qa' }], priority: 'urgent', at });
const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const surface = () => document.querySelector('[data-surface]') as HTMLElement;
const sentence = () => document.querySelector('[data-layer="bubble"] [data-ledge-sentence]');
const snapshot = (sessions: Session[]) => act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions }); });

let f: ReturnType<typeof fleetClient>;
let opened: LedgeTarget[];
let off: () => void;
beforeEach(() => {
  vi.useFakeTimers(); daemonStore.reset(); f = fleetClient(); opened = [];
  off = subscribeOpenInLedge((target, outcome) => { if (outcome === 'opening') opened.push(target); });
});
afterEach(() => { off(); vi.useRealTimers(); });
const mount = () => render(<Surface screenH={1080} theme="dark" client={f.client} dnd={false} onToggleDnd={() => {}} />);

describe('the notch speaks for the operator', () => {
  it('a point unfolds as Ledge\'s bubble; Plus tard sets it aside on its own machine', () => {
    snapshot([]); mount();
    f.set({ dev: [point('p1', '2026-11-13T14:32:00.000Z')] });
    tick(540);
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(sentence()).toHaveTextContent('Deux choses pour toi : pilot-lead attend ta décision sur #309, et Rex a fini.');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(f.sent).toEqual([{ machine: 'dev', msg: { type: 'point.later', qid: 'p1' } }]);
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('Voir le point opens the point in Desktop\'s chat and folds the bubble', () => {
    snapshot([]); mount();
    f.set({ local: [point('p1', '2026-11-13T14:32:00.000Z')] });
    tick(540);
    fireEvent.click(screen.getByRole('button', { name: 'See the point' }));
    expect(opened).toEqual([{ kind: 'point', qid: 'p1' }]);
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(f.sent).toEqual([]);
  });

  it('an urgent rig question outranks a newer point, whatever the machine, and its option answers through the point holding it', () => {
    snapshot([]); mount();
    f.set({ local: [point('p2', '2026-11-13T15:00:00.000Z')], dev: [rigAsk('q9', '2026-11-13T14:00:00.000Z', 'p1')] });
    tick(540);
    expect(sentence()).toHaveTextContent('pilot-lead · ledge-dev: “Fusionner #309 maintenant ?”');
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    expect(f.sent).toEqual([{ machine: 'dev', msg: { type: 'point.act', qid: 'p1', item: 'rig.ask:q9', answer: { id: 'merge' } } }]);
    // Set aside while its answer travels, the point comes next.
    expect(sentence()).toHaveTextContent(/^Deux choses pour toi/);
  });

  it('a launch to confirm is never confirmed in the notch: the point opens in Desktop\'s chat', () => {
    snapshot([]); mount();
    f.set({ local: [rigAsk('q9', '2026-11-13T14:00:00.000Z', 'p1')] });
    tick(540);
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    act(() => { daemonStore.apply({ type: 'error', message: 'Confirm first', request: 'point.act', code: 'confirm_required' } as never); });
    expect(opened).toEqual([{ kind: 'point', qid: 'p1' }]);
  });

  it('a rig question no point holds yet opens in « À toi »', () => {
    snapshot([]); mount();
    f.set({ local: [rigAsk('q9', '2026-11-13T14:00:00.000Z')] });
    tick(540);
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    expect(opened).toEqual([{ kind: 'ask', id: 'q9' }]);
    expect(f.sent).toEqual([]);
  });

  it('a session\'s request comes first; the point waits behind it', () => {
    snapshot([fakeSession('a', { name: 'Nova', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm -r test -u', tool: 'Bash', source: 'hook' } })]);
    mount();
    f.set({ local: [point('p1', '2026-11-13T14:32:00.000Z')] });
    tick(540);
    expect(sentence()).toHaveTextContent('Nova wants to run pnpm -r test -u');
    expect(document.querySelector('[data-layer="bubble"]')).toHaveAttribute('data-kind', 'ask');
  });

  it('the notice\'s machine offline: Plus tard and Voir le point are disabled and say why', () => {
    snapshot([]); mount();
    f.set({ dev: [point('p1', '2026-11-13T14:32:00.000Z')] });
    tick(540);
    f.ready('dev', false);
    for (const name of ['Later', 'See the point']) {
      const b = screen.getByRole('button', { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Offline: reconnecting to the daemon');
    }
  });
});

describe('the one notice left in the bubble: a machine that dropped', () => {
  it('hover, focus within and a hidden document pause its clock', () => {
    snapshot([]); mount();
    f.ready('dev', false);
    tick(540);
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    const timer = () => document.querySelector('[data-timer]');
    expect(timer()).toHaveAttribute('data-paused', 'false');
    fireEvent.mouseEnter(surface());
    expect(timer()).toHaveAttribute('data-paused', 'true');
    tick(7000);
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    fireEvent.mouseLeave(surface());
    expect(timer()).toHaveAttribute('data-paused', 'false');
    act(() => { screen.getByRole('button', { name: 'OK' }).focus(); });
    expect(timer()).toHaveAttribute('data-paused', 'true');
    act(() => { (document.activeElement as HTMLElement).blur(); });
    expect(timer()).toHaveAttribute('data-paused', 'false');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(timer()).toHaveAttribute('data-paused', 'true');
    hidden.mockRestore();
  });
});
