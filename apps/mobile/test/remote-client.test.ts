import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@ledge/protocol';
import { connectRemote } from '../src/connection/remoteClient';
import { createMobileStore } from '../src/state/store';
import { TOKEN_KEY } from '../src/state/persist';

class FakeWs {
  static all: FakeWs[] = [];
  sent: string[] = []; readyState = 0;
  onopen: null | (() => void) = null; onclose: null | ((ev: { code?: number }) => void) = null;
  onerror: null | (() => void) = null; onmessage: null | ((ev: { data: unknown }) => void) = null;
  constructor(public url: string) { FakeWs.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
}
const TOKEN = 't'.repeat(43);
const sess = { id: 'a', name: 'Otto', tool: 'claude', cwd: '/w/x', project: 'x', title: 'Otto · x', tmuxSession: null, state: 'working', helpers: [], startedAt: '2026-10-09T18:00:00.000Z', lastActivityAt: '2026-10-09T18:00:00.000Z', source: 'launcher' } as Session;

const clients: { close(): void }[] = [];
const setup = (token: string | null = TOKEN) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  const store = createMobileStore();
  const client = connectRemote({ store, url: 'wss://pc/m/ws', WebSocketImpl: FakeWs as never });
  clients.push(client);
  return { store, client };
};

beforeEach(() => { FakeWs.all = []; localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { clients.forEach(c => c.close()); clients.length = 0; vi.useRealTimers(); });

describe('connectRemote', () => {
  it('sends auth with the stored token first', () => {
    setup(); const ws = FakeWs.all[0]!; ws.open();
    expect(ws.sent.map(x => JSON.parse(x))).toEqual([{ type: 'auth', token: TOKEN }]);
  });

  it('without a token it shows pairing and opens no socket', () => {
    const { store } = setup(null);
    expect(store.getState().link).toBe('unpaired'); expect(FakeWs.all).toHaveLength(0);
  });

  it('goes online on auth.ok', () => {
    const { store } = setup(); const ws = FakeWs.all[0]!; ws.open();
    expect(store.getState().link).toBe('connecting');
    ws.push({ type: 'auth.ok', deviceId: 'd', deviceName: 'iPhone', pcName: 'PC' });
    expect(store.getState().link).toBe('online');
  });

  it('offline keeps the last known sessions readable', () => {
    const { store } = setup(); const ws = FakeWs.all[0]!; ws.open();
    ws.push({ type: 'auth.ok', deviceId: 'd', deviceName: 'iPhone', pcName: 'PC' });
    ws.push({ type: 'snapshot', sessions: [sess] });
    ws.drop(1006);
    expect(store.getState().link).toBe('offline');
    expect(store.getState().sessions).toEqual([sess]);
  });

  it.each([4401, 4403])('%i clears the token and shows pairing without reconnecting', code => {
    const { store } = setup(); const ws = FakeWs.all[0]!; ws.open();
    ws.push({ type: 'snapshot', sessions: [sess] });
    ws.drop(code);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(store.getState()).toMatchObject({ link: 'unpaired', sessions: [] });
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
  });

  it('returning to the foreground reconnects at once', () => {
    const { store } = setup(); FakeWs.all[0]!.open(); FakeWs.all[0]!.drop(1006);
    expect(FakeWs.all).toHaveLength(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWs.all).toHaveLength(2);
    expect(store.getState().link).toBe('offline');
  });
});
