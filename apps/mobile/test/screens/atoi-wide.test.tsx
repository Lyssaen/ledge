import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HumanAsk, PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { platformAvailable } from '../../src/link/webauthn';
import { RECEIPT_MS } from '../../src/model/atoi';
import { AskDetail } from '../../src/screens/atoi/AskDetail';
import { RequestDetail } from '../../src/screens/RequestDetail';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn(), getDiscoverable: vi.fn() }));

const at = (min: number) => new Date(Date.parse('2026-10-14T10:00:00.000Z') + min * 60_000).toISOString();
const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(false); });
afterEach(() => { wide(false); vi.useRealTimers(); localStorage.clear(); });

const perm = (id: string, extra: Partial<PhoneSession> = {}) =>
  session(id, { name: id.toUpperCase(), state: 'waiting_permission', lastActivityAt: at(0), pending: pending({ key: `k${id}`, text: `pnpm build ${id}` }), ...extra });
const ask = (id: string, extra: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Fusionner le lot 10 maintenant ?', body: 'Le code ne change plus.', bodyTruncated: false, detail: null, evidenceRef: 'openrig/notes.md',
  questions: [{ id: 'q', question: 'Fusionner ?', options: [{ id: 'now', label: 'Fusionner maintenant', recommended: true }] }],
  createdAt: at(0), updatedAt: at(0), ...extra
} as HumanAsk);
const withOpenRig = (m: PhoneServerMessage) => ({ ...m, daemon: { ...(m as { daemon: object }).daemon, openrig: true } }) as PhoneServerMessage;
const asks = (list: HumanAsk[]): PhoneServerMessage => ({ type: 'openrig.asks', channel: { state: 'ready', person: null, slack: false }, asks: list }) as PhoneServerMessage;
const key = (k: string, target: Element = document.body) => fireEvent.keyDown(target, { key: k });

describe('the decision footer of a wide screen (m1-a-toi.html §12)', () => {
  const opened = (p = pending({ key: 'ka', text: 'pnpm build a' }), keys = true) => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Pim', state: 'waiting_permission', pending: p })]));
    render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} keys={keys} />);
    return t;
  };
  const footer = () => [...document.querySelectorAll('footer button, footer span, footer p')].map(e => e.textContent).filter(Boolean);

  it('one row: Autoriser, Refuser, Toujours dans ce projet, then the keys', () => {
    opened();
    expect(footer()).toEqual(['Autoriser', 'Refuser', 'Toujours dans ce projet', 'Y / N au clavier', 'La décision sera transmise immédiatement au PC.']);
  });

  it('Y allows, N refuses, « Toujours » sends `always`', () => {
    let t = opened();
    key('y');
    expect(t.of('session.decide')).toEqual([expect.objectContaining({ id: 'a', decision: 'accept' })]);
    document.body.innerHTML = '';
    t = opened();
    key('N');
    expect(t.of('session.decide')).toEqual([expect.objectContaining({ decision: 'deny' })]);
    document.body.innerHTML = '';
    t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Toujours dans ce projet' }));
    expect(t.of('session.decide')).toEqual([expect.objectContaining({ decision: 'always' })]);
  });

  it('never takes a letter typed in a field, nor one with a modifier, nor one while the decision goes', () => {
    const t = opened();
    const field = document.createElement('input');
    document.body.append(field);
    key('y', field);
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(t.of('session.decide')).toEqual([]);
    key('y');
    key('n');
    expect(t.of('session.decide')).toHaveLength(1);
  });

  it('a high-impact accept: no « Toujours », and Y does nothing', () => {
    const t = opened(pending({ key: 'ka', text: 'git push --force', risk: 'high', riskReason: 'pushes' }));
    expect(screen.queryByRole('button', { name: 'Toujours dans ce projet' })).toBeNull();
    expect(screen.queryByText('Y / N au clavier')).toBeNull();
    key('y');
    expect(t.of('session.decide')).toEqual([]);
  });

  it('on a phone: « Toujours » under the two buttons, no keys', () => {
    const t = opened(undefined, false);
    expect(screen.getByRole('button', { name: 'Toujours dans ce projet' })).toBeInTheDocument();
    expect(screen.queryByText('Y / N au clavier')).toBeNull();
    key('y');
    expect(t.of('session.decide')).toEqual([]);
  });
});

describe('« À toi » on a wide screen, from the keyboard and after a decision', () => {
  beforeEach(() => wide(true));

  it('↓ / ↑ open the next and the previous entry, the requests then the asks', () => {
    const t = app('ready', { hash: '#/' });
    act(() => t.deliver(withOpenRig(snapshot([perm('a'), perm('b', { lastActivityAt: at(1) })]))));
    act(() => t.deliver(asks([ask('r1')])));
    act(() => { key('ArrowDown'); });
    expect(location.hash).toBe('#/request/a/ka');
    act(() => { key('ArrowDown'); });
    act(() => { key('ArrowDown'); });
    expect(location.hash).toBe('#/ask/r1');
    act(() => { key('ArrowUp'); });
    expect(location.hash).toBe('#/request/b/kb');
  });

  it('once a request is decided, its receipt shows, then the next one opens', async () => {
    const t = app('ready', { hash: '#/request/a/ka' });
    act(() => t.deliver(snapshot([perm('a'), perm('b', { lastActivityAt: at(1) })])));
    vi.useFakeTimers();
    act(() => { key('y'); });
    const [sent] = t.of('session.decide');
    expect(sent).toMatchObject({ id: 'a', decision: 'accept' });
    act(() => t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' }));
    act(() => t.deliver(snapshot([session('a', { name: 'A' }), perm('b', { lastActivityAt: at(1) })])));
    expect(location.hash).toBe('#/request/a/ka');
    act(() => { vi.advanceTimersByTime(RECEIPT_MS); });
    expect(location.hash).toBe('#/request/b/kb');
  });
});

describe('an OpenRig ask in full (AskDetail)', () => {
  it('shows its whole text and source, with the answers of its card', () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([])));
    t.deliver(asks([ask('r1')]));
    render(<AskDetail store={t.store} id="r1" />);
    expect(screen.getByText('Le code ne change plus.')).toBeInTheDocument();
    expect(screen.getByText('openrig/notes.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fusionner maintenant/ })).toBeInTheDocument();
  });

  it('waits for OpenRig\'s list before saying anything, then says an ask gone was settled elsewhere', async () => {
    const t = setup();
    t.deliver(withOpenRig(snapshot([])));
    render(<AskDetail store={t.store} id="r9" />);
    expect(screen.getByRole('status')).toHaveTextContent('Chargement');
    act(() => t.deliver(asks([])));
    await waitFor(() => expect(screen.getByText('Déjà réglée ailleurs')).toBeInTheDocument());
  });
});
