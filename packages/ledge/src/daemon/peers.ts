import type { ServerMessage } from '@ledge/protocol';

/** Who is on the other end of a socket: the overlay, a hook or the CLI on this machine, or a paired phone. */
export type PeerContext = { kind: 'local' } | { kind: 'remote'; deviceId: string };

/** The part of a WebSocket the daemon uses, so a socket accepted by another listener can be attached the same way. */
export interface PeerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(ev: 'message' | 'close' | 'error', fn: (...a: any[]) => void): unknown;
  readyState: number;
}

/** A connected client. A remote peer's `send` always goes through `toRemote`. */
export interface Peer { ctx: PeerContext; send(msg: ServerMessage): void; close(code: number): void }

export function createPeers(): { add(p: Peer): () => void; broadcast(msg: ServerMessage): void; closeDevice(deviceId: string, code: number): number; all(): Peer[] } {
  const peers = new Set<Peer>();
  return {
    add(p) { peers.add(p); return () => { peers.delete(p); }; },
    broadcast(msg) { for (const p of peers) p.send(msg); },
    closeDevice(deviceId, code) {
      const hit = [...peers].filter(p => p.ctx.kind === 'remote' && p.ctx.deviceId === deviceId);
      for (const p of hit) p.close(code);
      return hit.length;
    },
    all: () => [...peers]
  };
}
