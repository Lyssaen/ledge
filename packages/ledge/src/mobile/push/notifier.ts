// The PC's side of Web Push: for a change `pushFor` found worth telling, every approved device that is hidden gets the
// payload sealed (RFC 8291) and handed to the relay, which only forwards it. Logs carry a device id and a result, never
// an endpoint or a text.
import { PushPayloadSchema, type DevicePrefs, type PushPayload, type PushSend } from '@ledge/protocol';
import type { MobileService } from '../service.js';
import { encryptPush } from './encrypt.js';
import { cut } from './triggers.js';

/** Every body has this size once padded: the length of a text tells nothing. */
const PAD_TO = 1_024;
const TTL_S = 3_600;
/** At most one « finished » per session in this time. */
const FINISHED_EVERY_MS = 60_000;

export interface Notifier {
  /** `sessionId` paces `finished` (none for a chat end); `only` limits the targets to one device. */
  notify(p: PushPayload, sessionId: string | undefined, only?: string): Promise<void>;
}

/** The payload as bytes that still fit in one padded record (one octet is the delimiter): its `body` is cut if need be. */
function fit(p: PushPayload): Uint8Array | null {
  let body = p.body;
  for (;;) {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...p, body }));
    if (bytes.length < PAD_TO) return bytes;
    if (body.length === 0) return null;
    body = cut(body, Math.max(0, body.length - Math.max(1, bytes.length - PAD_TO + 1)));
    if (body === '…') body = '';
  }
}

/**
 * Whether the device's own settings let `p` through at `at` (ms): a pause holds every kind but `resolved` (it only replaces a
 * notification already shown); « Agent terminé » (which now gates the point), « Réponse de Ledge » and « Décision » can each be turned off; requests and
 * questions cannot.
 */
export function wanted(p: Pick<PushPayload, 'kind'>, prefs: DevicePrefs | undefined, at: number): boolean {
  if (!prefs || p.kind === 'resolved') return true;
  if (prefs.quietUntil !== null && Date.parse(prefs.quietUntil) > at) return false;
  return p.kind === 'point' ? prefs.notify.finished : p.kind === 'finished' || p.kind === 'chat' || p.kind === 'decision' ? prefs.notify[p.kind] : true;
}

export function createNotifier(deps: {
  mobile: Pick<MobileService, 'state' | 'pushOf' | 'setPush' | 'relayPushKey' | 'sendPush'> & Partial<Pick<MobileService, 'prefsOf'>>;
  /** Whether the device's app is in front. */
  presence: (deviceId: string) => boolean;
  now?: () => number;
  log: (line: string) => void;
}): Notifier {
  const { mobile, log } = deps;
  const now = deps.now ?? Date.now;
  const lastFinished = new Map<string, number>();
  /** The tags of the requests and questions each device was sent, until their `resolved` (memory only). */
  const told = new Map<string, Set<string>>();
  const tell = (id: string, tag: string) => { let s = told.get(id); if (!s) { s = new Set(); told.set(id, s); } s.add(tag); };

  return {
    async notify(payload, sessionId, only) {
      if (!mobile.state().enabled) return;
      const checked = PushPayloadSchema.safeParse(payload);
      if (!checked.success) { log('push: payload skipped (invalid)'); return; }
      const p = checked.data;
      if (p.kind === 'finished' && sessionId !== undefined) {
        const last = lastFinished.get(sessionId);
        if (last !== undefined && now() - last < FINISHED_EVERY_MS) return;
      }
      const plain = fit(p);
      if (!plain) { log('push: payload skipped (too long)'); return; }
      const relayKey = mobile.relayPushKey();
      if (relayKey === null) return;
      const targets = mobile.state().devices.flatMap(d => {
        if (only !== undefined && d.id !== only) return [];
        const sub = mobile.pushOf(d.id);
        if (!sub || (relayKey !== undefined && sub.key !== relayKey) || deps.presence(d.id)) return [];
        if (!wanted(p, mobile.prefsOf?.(d.id), now())) return [];
        // A `resolved` only replaces a notification the device got, and only on a service worker that shows it.
        if (p.kind === 'resolved' && (!sub.resolved || !told.get(d.id)?.has(p.tag))) return [];
        return [{ id: d.id, online: d.online, sub }];
      });
      if (targets.length === 0) return;
      // Only a real send starts the delay: the turn ends once, whatever the number of devices.
      if (p.kind === 'finished' && sessionId !== undefined) lastFinished.set(sessionId, now());
      await Promise.all(targets.map(async ({ id, sub }) => {
        try {
          const msg: PushSend = {
            endpoint: sub.endpoint,
            body: Buffer.from(encryptPush(plain, { p256dh: sub.p256dh, auth: sub.auth }, { padTo: PAD_TO })).toString('base64url'),
            ttl: TTL_S,
            urgency: p.kind === 'finished' || p.kind === 'chat' || p.kind === 'resolved' || p.kind === 'point' ? 'normal' : 'high',
            topic: p.tag
          };
          const r = await mobile.sendPush(msg);
          if (p.kind === 'resolved') told.get(id)?.delete(p.tag);
          else if ((p.kind === 'request' || p.kind === 'question') && r.result === 'sent') tell(id, p.tag);
          if (r.result === 'gone') {
            log(`push: subscription of device ${id} is gone, removed`);
            mobile.setPush(id, null);
          } else if (r.result === 'failed') {
            log(`push: not sent to device ${id}${r.status !== undefined ? ` (status ${r.status})` : ''}`);
          }
        } catch (e) {
          log(`push: not sent to device ${id} (${e instanceof Error ? e.name : 'error'})`);
        }
      }));
    }
  };
}
