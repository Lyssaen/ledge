import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDaemonClient } from '../src/daemonClient';

class FakeWs {
  static all: FakeWs[] = [];
  sent: string[] = []; readyState = 0;
  onopen: null | (() => void) = null; onclose: null | ((ev: { code?: number }) => void) = null;
  onerror: null | (() => void) = null; onmessage: null | ((ev: { data: unknown }) => void) = null;
  constructor(public url: string) { FakeWs.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
}
beforeEach(() => { FakeWs.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const make = (o: Partial<Parameters<typeof createDaemonClient>[0]> = {}) => createDaemonClient({ url: 'ws://x', WebSocketImpl: FakeWs as never, minBackoffMs: 100, maxBackoffMs: 200, ...o });

describe('createDaemonClient', () => {
  it('sends client messages as JSON once open', () => {
    const c = make(); c.connect(); const ws = FakeWs.all[0]!;
    c.send({ type: 'snapshot.request' }); expect(ws.sent).toEqual([]);
    ws.open(); c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect(ws.sent.map(s => JSON.parse(s))).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept' }]);
  });

  it('reconnects with backoff after a drop and reports unreachable', () => {
    const c = make(); const statuses: string[] = []; c.onStatus(s => statuses.push(s));
    c.connect(); FakeWs.all[0]!.open(); FakeWs.all[0]!.drop(1006);
    expect(c.status()).toBe('unreachable'); expect(FakeWs.all).toHaveLength(1);
    vi.advanceTimersByTime(100); expect(FakeWs.all).toHaveLength(2);
    FakeWs.all[1]!.open(); expect(c.status()).toBe('open');
    expect(statuses).toEqual(['open', 'unreachable', 'open']);
  });

  it('ignores a stale socket close after close() then connect()', () => {
    const c = make(); c.connect(); const first = FakeWs.all[0]!; first.open();
    c.close(); c.connect(); const second = FakeWs.all[1]!; second.open();
    first.drop(1006); vi.advanceTimersByTime(1000);
    expect(c.status()).toBe('open'); expect(FakeWs.all).toHaveLength(2);
  });

  it('sends hello before anything else on each open', () => {
    const c = make({ hello: () => ({ type: 'auth', token: 't'.repeat(40) }) });
    c.connect(); const a = FakeWs.all[0]!; a.open(); c.send({ type: 'snapshot.request' });
    expect(a.sent.map(s => JSON.parse(s).type)).toEqual(['auth', 'snapshot.request']);
    a.drop(1006); vi.advanceTimersByTime(100); const b = FakeWs.all[1]!; b.open();
    expect(b.sent.map(s => JSON.parse(s).type)).toEqual(['auth']);
  });

  it('sends nothing when hello returns null', () => {
    const c = make({ hello: () => null }); c.connect(); FakeWs.all[0]!.open();
    expect(FakeWs.all[0]!.sent).toEqual([]);
  });

  it('reports the close code', () => {
    const onClose = vi.fn(); const c = make({ onClose }); c.connect(); FakeWs.all[0]!.open(); FakeWs.all[0]!.drop(4401);
    expect(onClose).toHaveBeenCalledWith(4401);
  });

  it('does not reconnect after a stop code', () => {
    const c = make({ stopOn: [4401] }); c.connect(); FakeWs.all[0]!.open(); FakeWs.all[0]!.drop(4401);
    vi.advanceTimersByTime(60_000); expect(FakeWs.all).toHaveLength(1); expect(c.status()).toBe('unreachable');
  });

  it('still reconnects after a code that is not a stop code', () => {
    const c = make({ stopOn: [4401] }); c.connect(); FakeWs.all[0]!.open(); FakeWs.all[0]!.drop(1006);
    vi.advanceTimersByTime(100); expect(FakeWs.all).toHaveLength(2);
  });
});
