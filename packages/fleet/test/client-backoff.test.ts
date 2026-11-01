// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDaemonClient, STABLE_LINK_MS } from '../src/client';

// The reconnect backoff starts over only once a link has stayed up STABLE_LINK_MS after its snapshot: a link that drops right after it
// (a remote that sends a frame the front cannot read, say) backs off instead of looping every few seconds.
class FakeWs {
  static all: FakeWs[] = [];
  onopen: null | (() => void) = null; onclose: null | (() => void) = null; onerror: null | (() => void) = null; onmessage: null | ((ev: { data: unknown }) => void) = null; readyState = 0;
  constructor(public url: string) { FakeWs.all.push(this); }
  send() {} close() { this.readyState = 3; }
  /** The socket opens and the daemon sends its snapshot. */
  up() { this.readyState = 1; this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', sessions: [] }) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

beforeEach(() => { vi.useFakeTimers(); FakeWs.all = []; });
afterEach(() => { vi.useRealTimers(); });

describe('daemon client reconnect backoff', () => {
  it('a link that drops right after its snapshot waits longer each time; one that stayed up past STABLE_LINK_MS starts over', () => {
    const client = createDaemonClient({ url: 'ws://x', WebSocketImpl: FakeWs as never, minBackoffMs: 2000, maxBackoffMs: 30000 });
    client.connect();
    const sockets = () => FakeWs.all.length;
    // First link: snapshot, then dropped at once.
    FakeWs.all[0]!.up(); FakeWs.all[0]!.drop();
    vi.advanceTimersByTime(1999); expect(sockets()).toBe(1);
    vi.advanceTimersByTime(1); expect(sockets()).toBe(2);
    // Second: same, and the wait has grown.
    FakeWs.all[1]!.up(); FakeWs.all[1]!.drop();
    vi.advanceTimersByTime(2000); expect(sockets()).toBe(2);
    vi.advanceTimersByTime(2000); expect(sockets()).toBe(3);
    // Third stays up past the stable time, then drops: the wait starts over at the minimum.
    FakeWs.all[2]!.up();
    vi.advanceTimersByTime(STABLE_LINK_MS);
    FakeWs.all[2]!.drop();
    vi.advanceTimersByTime(1999); expect(sockets()).toBe(3);
    vi.advanceTimersByTime(1); expect(sockets()).toBe(4);
    client.close();
  });
});
