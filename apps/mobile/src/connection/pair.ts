import type { startRegistration as StartRegistration } from '@simplewebauthn/browser';
import { MOBILE_WS_PATH, PairErrorSchema, type PairErrorReason, type RegistrationJson } from '@ledge/protocol';
import { DEVICE_KEY, TOKEN_KEY } from '../state/persist';

/** Why pairing failed: a reason the daemon gave, or `network` when the PC could not be reached. */
export class PairFailure extends Error {
  constructor(readonly reason: PairErrorReason | 'network') { super(reason); this.name = 'PairFailure'; }
}

/** The pre-auth socket, one request at a time: `receive` resolves with the next message and rejects once the socket is gone. */
export interface PairSocket {
  send(msg: Record<string, unknown>): void;
  receive(): Promise<Record<string, unknown>>;
  close(): void;
}

export interface PairDeps {
  open(): Promise<PairSocket>;
  startRegistration: typeof StartRegistration;
  deviceName: string;
}

const NAME_MAX = 60;

export async function pairDevice(code: string, deps: PairDeps): Promise<{ token: string; deviceId: string }> {
  let socket: PairSocket;
  try { socket = await deps.open(); } catch { throw new PairFailure('network'); }
  const ask = async (msg: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let reply: Record<string, unknown>;
    try { socket.send(msg); reply = await socket.receive(); } catch { throw new PairFailure('network'); }
    if (reply.type === 'pair.error') {
      const reason = PairErrorSchema.safeParse(reply.reason);
      throw new PairFailure(reason.success ? reason.data : 'webauthn_failed');
    }
    return reply;
  };
  try {
    const challenge = await ask({ type: 'pair.options', code });
    if (challenge.type !== 'pair.challenge' || typeof challenge.options !== 'object' || challenge.options === null) throw new PairFailure('network');
    let webauthn: RegistrationJson;
    try { webauthn = await deps.startRegistration({ optionsJSON: challenge.options as never }) as unknown as RegistrationJson; }
    catch { throw new PairFailure('webauthn_failed'); }
    const done = await ask({ type: 'pair.complete', code, deviceName: deps.deviceName.slice(0, NAME_MAX) || 'Navigateur', webauthn });
    if (done.type !== 'pair.done' || typeof done.token !== 'string' || typeof done.deviceId !== 'string') throw new PairFailure('network');
    return { token: done.token, deviceId: done.deviceId };
  } finally {
    try { socket.close(); } catch { /* already closed */ }
  }
}

export function guessDeviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return 'Navigateur';
}

/** iOS Safari in a plain tab: Web Push and a durable passkey need the installed app, so pairing waits for the home-screen icon. */
export function isIosBrowserTab(nav: Navigator = navigator, mm: typeof matchMedia = globalThis.matchMedia): boolean {
  const ios = /iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone = (nav as Navigator & { standalone?: boolean }).standalone === true || Boolean(mm?.('(display-mode: standalone)').matches);
  return !standalone;
}

/** A real socket to the daemon's pre-auth entry. */
export function openPairSocket(url = `wss://${globalThis.location.host}${MOBILE_WS_PATH}`, Ws: typeof WebSocket = WebSocket): Promise<PairSocket> {
  return new Promise((resolve, reject) => {
    const ws = new Ws(url);
    const queue: Record<string, unknown>[] = [];
    let waiter: { ok(m: Record<string, unknown>): void; no(e: Error): void } | null = null;
    let gone = false, opened = false;
    ws.onmessage = ev => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(ev.data)) as Record<string, unknown>; } catch { return; }
      if (waiter) { const w = waiter; waiter = null; w.ok(m); } else queue.push(m);
    };
    ws.onclose = () => { gone = true; if (!opened) reject(new Error('closed')); waiter?.no(new Error('closed')); waiter = null; };
    ws.onerror = () => { if (!opened) reject(new Error('error')); };
    ws.onopen = () => {
      opened = true;
      resolve({
        send: msg => ws.send(JSON.stringify(msg)),
        receive: () => queue.length ? Promise.resolve(queue.shift()!) : gone ? Promise.reject(new Error('closed')) : new Promise((ok, no) => { waiter = { ok, no }; }),
        close: () => ws.close()
      });
    };
  });
}

/** Keep the token and the device name the app reads at its next start. */
export function savePairing(r: { token: string; deviceId: string }, deviceName: string, storage: Storage = globalThis.localStorage): void {
  storage.setItem(TOKEN_KEY, r.token);
  try { storage.setItem(DEVICE_KEY, JSON.stringify({ id: r.deviceId, name: deviceName })); } catch { /* the next auth.ok rewrites it */ }
}
