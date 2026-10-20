// The PC's side of Web Push: for a change `pushFor` found worth telling, every approved device that is hidden gets the
// payload sealed (RFC 8291) and handed to the relay, which only forwards it. Logs carry a device id and a result, never
// an endpoint or a text.
import { PushPayloadSchema, type PushPayload, type PushSend } from '@ledge/protocol';
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

export function createNotifier(deps: {
  mobile: Pick<MobileService, 'state' | 'pushOf' | 'setPush' | 'relayPushKey' | 'sendPush'>;
  /** Whether the device's app is in front. */
  presence: (deviceId: string) => boolean;
  now?: () => number;
  log: (line: string) => void;
}): Notifier {
  const { mobile, log } = deps;
  const now = deps.now ?? Date.now;
  const lastFinished = new Map<string, number>();

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
            urgency: p.kind === 'finished' || p.kind === 'chat' ? 'normal' : 'high',
            topic: p.tag
          };
          const r = await mobile.sendPush(msg);
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
