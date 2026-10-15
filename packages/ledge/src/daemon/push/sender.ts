import webpush from 'web-push';
import type { PushPayload } from '@ledge/protocol';
import { log } from '../../log.js';
import type { DeviceStore } from '../devices.js';
import { safeTag } from './triggers.js';
import { pushEndpointAllowed, type Vapid } from './vapid.js';

/**
 * Posts a notification to every subscribed phone. Failures are logged, never raised and never retried; a subscription the
 * push service says is gone (404, 410) is dropped. `env` is the login shell's, which is where the proxy lives under systemd.
 */
export function createPushSender(o: { devices: DeviceStore; vapid: () => Promise<Vapid | null>; env: () => Promise<NodeJS.ProcessEnv>; send?: typeof webpush.sendNotification }): { notify(p: PushPayload): Promise<void> } {
  const send = o.send ?? webpush.sendNotification;
  return {
    async notify(p) {
      const targets = o.devices.list().map(d => o.devices.get(d.id)).filter(r => !!r?.push);
      if (!targets.length) return;
      const vapid = await o.vapid();
      if (!vapid) { log('push skipped: no VAPID keys'); return; }
      const env = await o.env();
      const proxy = env.HTTPS_PROXY ?? env.https_proxy;
      const body = JSON.stringify(p);
      await Promise.all(targets.map(async r => {
        const sub = r!.push!;
        // Records come from disk: the allow-list is checked again at the moment of sending.
        if (!pushEndpointAllowed(sub.endpoint)) { log(`push to ${r!.id} skipped: endpoint not allowed`); return; }
        try {
          await send(sub, body, { vapidDetails: vapid, TTL: 3600, urgency: p.kind === 'finished' ? 'normal' : 'high', topic: safeTag(p.tag), timeout: 10_000, ...(proxy ? { proxy } : {}) });
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            log(`push subscription of ${r!.id} is gone (${status}), removed`);
            await o.devices.setPush(r!.id, null).catch(err => log(`push subscription not removed: ${(err as Error).message}`));
          } else log(`push to ${r!.id} failed: ${(e as Error).message}`);
        }
      }));
    }
  };
}
