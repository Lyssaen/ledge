import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayServerMessage, SealedFrame } from '@ledge/protocol';
import { openRelaySocket, type SocketState } from '../../src/link/socket';

/** A browser-shaped WebSocket the test drives by hand. */
class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly sent: string[] = [];
  readonly argCount: number;
  closedWith: number | undefined;

  constructor(readonly url: string, ...rest: unknown[]) {
    this.argCount = 1 + rest.length;
    FakeWs.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close(code?: number) { this.closedWith = code ?? 1000; this.readyState = 3; }

  // Driven by the test, as the relay would.
  open() { this.readyState = 1; this.onopen?.({}); }
  deliver(raw: unknown) { this.onmessage?.({ data: typeof raw === 'string' ? raw : JSON.stringify(raw) }); }
  welcome() { this.open(); this.deliver({ type: 'welcome', accountId: 'A', self: 'd_aaaaaaaaaaaaaaaa', online: ['pc'] }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

const Impl = FakeWs as unknown as typeof WebSocket;
const last = () => FakeWs.instances[FakeWs.instances.length - 1]!;
const answer = (status: number) => vi.fn(async (_url: string, _init?: RequestInit) => ({ status, ok: status >= 200 && status < 300 }) as Response);

function open(fetchImpl = answer(200)) {
  const states: SocketState[] = [];
  const frames: RelayServerMessage[] = [];
  const sock = openRelaySocket({
    url: 'https://relay.example',
    WebSocketImpl: Impl,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onFrame: (m) => frames.push(m),
    onState: (s) => states.push(s)
  });
  return { sock, states, frames, fetchImpl };
}

beforeEach(() => {
  FakeWs.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('openRelaySocket', () => {
  it('opens wss://<host>/ws with no subprotocol at all', () => {
    open();
    expect(FakeWs.instances).toHaveLength(1);
    expect(last().url).toBe('wss://relay.example/ws');
    expect(last().argCount).toBe(1);
  });

  it('is open on welcome, hands over valid relay frames only, and sends a sealed frame as a relay send', () => {
    const { sock, states, frames } = open();
    const frame: SealedFrame = { k: 'pair_ok' };
    expect(sock.send('pc', frame)).toBe(false);
    last().welcome();
    expect(states).toEqual(['connecting', 'open']);
    last().deliver('not json');
    last().deliver({ type: 'deliver', from: 'pc' });
    last().deliver({ type: 'presence', peer: 'pc', online: false });
    expect(frames.map((f) => f.type)).toEqual(['welcome', 'presence']);
    expect(sock.send('pc', frame)).toBe(true);
    expect(JSON.parse(last().sent[0]!)).toEqual({ type: 'send', to: 'pc', body: JSON.stringify(frame) });
  });

  it('4000 (replaced): replaced, and never reconnects', async () => {
    const { states } = open();
    last().welcome();
    last().drop(4000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states).toEqual(['connecting', 'open', 'replaced']);
    expect(FakeWs.instances).toHaveLength(1);
  });

  it('4001 with /auth/me answering 200: reconnects', async () => {
    const { states, fetchImpl } = open(answer(200));
    last().welcome();
    last().drop(4001);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://relay.example/auth/me');
    expect(FakeWs.instances).toHaveLength(2);
    expect(states).toEqual(['connecting', 'open', 'connecting']);
  });

  it('4001 with /auth/me answering 401: signed_out, and never reconnects', async () => {
    const { states } = open(answer(401));
    last().welcome();
    last().drop(4001);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states).toEqual(['connecting', 'open', 'connecting', 'signed_out']);
    expect(FakeWs.instances).toHaveLength(1);
  });

  it('4008 (rate limited): no new attempt before 10 s', async () => {
    open();
    last().welcome();
    last().drop(4008);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(FakeWs.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.instances).toHaveLength(2);
  });

  it('1006: backoff 1 s, 2 s, 4 s… capped at 30 s, back to 1 s after a welcome', async () => {
    const { fetchImpl } = open();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      last().open();
      last().drop(1006);
      const before = FakeWs.instances.length;
      let waited = 0;
      while (FakeWs.instances.length === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    last().welcome();
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWs.instances).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.instances).toHaveLength(9);
    // A socket that had opened was authenticated: no /auth/me.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a socket refused before it opened asks /auth/me: 401 is signed_out', async () => {
    const { states, fetchImpl } = open(answer(401));
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'signed_out']);
    expect(FakeWs.instances).toHaveLength(1);
  });

  it('a socket refused before it opened, with /auth/me answering 200, retries on the backoff', async () => {
    open(answer(200));
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWs.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.instances).toHaveLength(2);
  });

  it('close(): closed, the socket closed with 1000, no reconnection', async () => {
    const { sock, states } = open();
    const ws = last();
    ws.welcome();
    sock.close();
    ws.drop(1000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ws.closedWith).toBe(1000);
    expect(states).toEqual(['connecting', 'open', 'closed']);
    expect(FakeWs.instances).toHaveLength(1);
    expect(sock.send('pc', { k: 'pair_ok' })).toBe(false);
  });
});
