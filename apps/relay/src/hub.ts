import {
  RELAY_CLOSE_RATE_LIMITED, RELAY_CLOSE_REPLACED, RelayClientMessageSchema, RelayPeerSchema, SEALED_MAX,
  type RelayPeer, type RelayServerMessage
} from '@ledge/protocol';
import type { RelayLog } from './log.js';

export interface Who { accountId: string; peer: RelayPeer }
export interface Conn {
  send(msg: RelayServerMessage): void;
  close(code: number, reason: string): void;
}
/** Per socket and per window. `bytesPerWindow` counts raw frame length. Exceeding either closes the socket with 4008. */
export interface Limits { framesPerWindow: number; bytesPerWindow: number; windowMs: number; now: () => number }

interface State {
  who: Who;
  since: number;
  windowStart: number;
  windowCount: number;
  windowBytes: number;
  limited: boolean;
  framesIn: number;
  framesOut: number;
  bytesIn: number;
  bytesOut: number;
}

type ErrorCode = Extract<RelayServerMessage, { type: 'error' }>['code'];

/** Routes opaque bodies between a PC and its devices, per account. Transport-independent; stores nothing. */
export class Hub {
  private readonly limits: Limits;
  private readonly accounts = new Map<string, Map<RelayPeer, Conn>>();
  private readonly states = new Map<Conn, State>();

  constructor(private readonly log: RelayLog, limits: Partial<Limits> = {}) {
    const defined = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as Partial<Limits>;
    this.limits = { framesPerWindow: 300, bytesPerWindow: 8 * 1_048_576, windowMs: 10_000, now: Date.now, ...defined };
  }

  attach(conn: Conn, who: Who): void {
    const now = this.limits.now();
    this.states.set(conn, { who, since: now, windowStart: now, windowCount: 0, windowBytes: 0, limited: false, framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0 });
    let peers = this.accounts.get(who.accountId);
    if (!peers) { peers = new Map(); this.accounts.set(who.accountId, peers); }
    const old = peers.get(who.peer);
    peers.set(who.peer, conn);
    if (old) old.close(RELAY_CLOSE_REPLACED, 'replaced');
    this.log({ ev: 'connect', account: who.accountId, peer: who.peer });
    this.out(conn, { type: 'welcome', accountId: who.accountId, self: who.peer, online: this.onlineFor(who) });
    // A replacement is not a presence change for the others.
    if (!old) this.tellOthers(who, true);
  }

  /** Closes this peer's socket if it is the one routed. Presence follows from the socket's own close, as for any other. */
  kick(accountId: string, peer: RelayPeer, code: number, reason: string): void {
    this.accounts.get(accountId)?.get(peer)?.close(code, reason);
  }

  detach(conn: Conn, code: number): void {
    const st = this.states.get(conn);
    if (!st) return;
    this.states.delete(conn);
    const { who } = st;
    const peers = this.accounts.get(who.accountId);
    if (peers?.get(who.peer) === conn) {
      peers.delete(who.peer);
      if (peers.size === 0) this.accounts.delete(who.accountId);
      this.tellOthers(who, false);
    }
    this.log({
      ev: 'disconnect', account: who.accountId, peer: who.peer, code, ms: this.limits.now() - st.since,
      framesIn: st.framesIn, framesOut: st.framesOut, bytesIn: st.bytesIn, bytesOut: st.bytesOut
    });
  }

  receive(conn: Conn, raw: string): void {
    const st = this.states.get(conn);
    if (!st) return;
    // A replaced socket is closed but may still be open for a moment: it must not route anything.
    if (this.accounts.get(st.who.accountId)?.get(st.who.peer) !== conn) return;
    // A socket over its limits is being closed: nothing more is answered or routed (no amplification).
    if (st.limited) return;
    const now = this.limits.now();
    if (now - st.windowStart >= this.limits.windowMs) { st.windowStart = now; st.windowCount = 0; st.windowBytes = 0; }
    st.windowCount++;
    st.windowBytes += raw.length;
    st.framesIn++;
    st.bytesIn += raw.length;
    if (st.windowCount > this.limits.framesPerWindow || st.windowBytes > this.limits.bytesPerWindow) {
      // Dropping a frame silently would break the sender's strict-sequence channel unseen.
      // Closing forces a reconnect, hence a fresh handshake.
      st.limited = true;
      this.fail(conn, st, 'rate_limited');
      return conn.close(RELAY_CLOSE_RATE_LIMITED, 'rate_limited');
    }

    let json: unknown;
    try { json = JSON.parse(raw); } catch { return this.fail(conn, st, 'bad_frame'); }
    const parsed = RelayClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      const { body, to } = (json ?? {}) as { body?: unknown; to?: unknown };
      if (typeof body !== 'string' || body.length <= SEALED_MAX) return this.fail(conn, st, 'bad_frame');
      // Name the channel the sender just lost, when the target is a valid peer.
      const peer = RelayPeerSchema.safeParse(to);
      return this.fail(conn, st, 'too_large', peer.success ? peer.data : undefined);
    }
    const { to, body } = parsed.data;
    const { who } = st;
    if (who.peer === 'pc' ? to === 'pc' : to !== 'pc') return this.fail(conn, st, 'bad_target');
    const target = this.accounts.get(who.accountId)?.get(to);
    if (!target) return this.fail(conn, st, 'offline', to);
    this.out(target, { type: 'deliver', from: who.peer, body });
  }

  private fail(conn: Conn, st: State, code: ErrorCode, to?: RelayPeer): void {
    this.log({ ev: 'frame_error', account: st.who.accountId, peer: st.who.peer, code });
    this.out(conn, to === undefined ? { type: 'error', code } : { type: 'error', code, to });
  }

  private out(conn: Conn, msg: RelayServerMessage): void {
    const st = this.states.get(conn);
    if (st) {
      st.framesOut++;
      if (msg.type === 'deliver') st.bytesOut += msg.body.length;
    }
    conn.send(msg);
  }

  private onlineFor(who: Who): RelayPeer[] {
    const peers = this.accounts.get(who.accountId);
    if (!peers) return [];
    return [...peers.keys()].filter((p) => p !== who.peer && (who.peer === 'pc' || p === 'pc'));
  }

  private tellOthers(who: Who, online: boolean): void {
    const peers = this.accounts.get(who.accountId);
    if (!peers) return;
    for (const [peer, c] of peers) {
      if (peer === who.peer) continue;
      if (who.peer !== 'pc' && peer !== 'pc') continue;
      this.out(c, { type: 'presence', peer: who.peer, online });
    }
  }
}
