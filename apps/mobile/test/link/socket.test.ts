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

  it('tells every failed attempt, the refused ones before any welcome included, while the state stays connecting', async () => {
    const states: SocketState[] = [];
    let failed = 0;
    openRelaySocket({
      url: 'https://relay.example',
      WebSocketImpl: Impl,
      fetchImpl: answer(200) as unknown as typeof fetch,
      onFrame: () => {},
      onState: (s) => states.push(s),
      onAttemptFailed: () => { failed++; }
    });
    last().drop(1006);
    expect(failed).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWs.instances).toHaveLength(2);
    last().drop(1006);
    expect(failed).toBe(2);
    expect(states).toEqual(['connecting']);
    await vi.advanceTimersByTimeAsync(2_000);
    last().welcome();
    last().drop(4000);
    // Replaced is final, not a failed attempt.
    expect(failed).toBe(2);
  });

  it('a socket refused before it opened, with /auth/me answering 200, retries on the backoff', async () => {
    open(answer(200));
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWs.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.instances).toHaveLength(2);
  });

  it('a /auth/me without an answer within 10 s is aborted, counts as not signed out, and retries', async () => {
    const timeouts: Array<{ ms: number; ctl: AbortController }> = [];
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const ctl = new AbortController();
      timeouts.push({ ms, ctl });
      return ctl.signal;
    });
    try {
      const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
      }));
      const { states } = open(hanging as never);
      last().welcome();
      last().drop(4001);
      await vi.advanceTimersByTimeAsync(60_000);
      // Still waiting on /auth/me: no retry yet.
      expect(FakeWs.instances).toHaveLength(1);
      expect(timeouts.map((t) => t.ms)).toEqual([10_000]);
      timeouts[0]!.ctl.abort();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(FakeWs.instances).toHaveLength(2);
      expect(states).toEqual(['connecting', 'open', 'connecting']);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['relay.example', 'ftp://relay.example', 'wss://relay.example', 'https://relay.example/app', 'https://u:p@relay.example', 'https://relay.example/?x=1'])(
    'refuses %s at once, before any socket', (url) => {
      expect(() => openRelaySocket({ url, WebSocketImpl: Impl, onFrame: () => {}, onState: () => {} })).toThrow(TypeError);
      expect(FakeWs.instances).toHaveLength(0);
    }
  );

  it('takes http:// for a local relay and opens ws://', () => {
    openRelaySocket({ url: 'http://127.0.0.1:8787/', WebSocketImpl: Impl, onFrame: () => {}, onState: () => {} });
    expect(last().url).toBe('ws://127.0.0.1:8787/ws');
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

  it('reconnect() while waiting out a backoff: a new attempt at once, and the backoff timer dropped', async () => {
    const { sock } = open();
    last().welcome();
    last().drop(1006);
    sock.reconnect();
    expect(FakeWs.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWs.instances).toHaveLength(2);
  });

  it('reconnect() on an open socket: the old one closed with 1000, a new one opened', () => {
    const { sock, states } = open();
    const ws = last();
    ws.welcome();
    sock.reconnect();
    expect(ws.closedWith).toBe(1000);
    expect(FakeWs.instances).toHaveLength(2);
    expect(states).toEqual(['connecting', 'open', 'connecting']);
  });

  it('reconnect() does nothing during an attempt, while /auth/me is asked, or within the 10 s of a 4008', async () => {
    let answerMe: (r: Response) => void = () => {};
    const slow = vi.fn(() => new Promise<Response>((r) => { answerMe = r; }));
    const { sock } = open(slow as unknown as ReturnType<typeof answer>);
    sock.reconnect();
    expect(FakeWs.instances).toHaveLength(1);
    last().drop(1006);
    sock.reconnect();
    expect(FakeWs.instances).toHaveLength(1);
    answerMe({ status: 200 } as Response);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWs.instances).toHaveLength(2);
    last().welcome();
    last().drop(4008);
    sock.reconnect();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(FakeWs.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWs.instances).toHaveLength(3);
  });

  it('reconnect() after close(): nothing', () => {
    const { sock } = open();
    sock.close();
    sock.reconnect();
    expect(FakeWs.instances).toHaveLength(1);
  });
});
