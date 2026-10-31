import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import type { MobileState, PushPayload, PushSend, PushSendResult } from '@ledge/protocol';
import { createNotifier } from '../src/mobile/push/notifier.js';
import { chatEndPayload } from '../src/mobile/push/triggers.js';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/SECRET-ENDPOINT-TOKEN';
const TEXT = 'private-words-of-the-agent';

const payload = (kind: PushPayload['kind'] = 'request', over: Partial<PushPayload> = {}): PushPayload => ({
  v: 1, kind, title: 'api attend votre accord', body: TEXT, url: '/#/request/api/k1', badge: 1, tag: 'api', ...over
});

function setup(o: { enabled?: boolean; result?: PushSendResult | (() => Promise<PushSendResult>) } = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const pushes = new Map<string, { endpoint: string; p256dh: string; auth: string; key: string }>([['dev1', { endpoint: ENDPOINT, ...keys, key: 'K1' }]]);
  const online = new Set(['dev1']);
  const visible = new Set<string>();
  const sent: PushSend[] = [];
  const logs: string[] = [];
  let relayKey: string | null | undefined = 'K1';
  const clock = { t: 1_000_000 };
  const n = createNotifier({
    mobile: {
      state: () => ({ enabled: o.enabled ?? true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [...pushes.keys()].map(id => ({ id, label: id, approvedAt: 'x', online: online.has(id) })), pairings: [] }) as MobileState,
      pushOf: id => pushes.get(id) ?? null,
      setPush: (id, p) => { if (p) pushes.set(id, p); else pushes.delete(id); },
      relayPushKey: () => relayKey,
      sendPush: async msg => {
        sent.push(msg);
        const r = o.result ?? { result: 'sent' as const };
        return typeof r === 'function' ? r() : r;
      }
    },
    presence: id => visible.has(id),
    now: () => clock.t,
    log: l => logs.push(l)
  });
  return { n, sent, logs, pushes, visible, online, clock, setRelayKey: (k: string | null | undefined) => { relayKey = k; } };
}

describe('push notifier', () => {
  it('sends nothing to a device that is online and visible, one when it is hidden', async () => {
    const t = setup();
    t.visible.add('dev1');
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(0);
    t.visible.clear();
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ endpoint: ENDPOINT, ttl: 3600, urgency: 'high', topic: 'api' });
  });

  it('an offline device with a subscription is sent to (the phone is not in front)', async () => {
    const t = setup();
    t.online.delete('dev1');
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('finished: urgency normal; one per minute per session, 61 s later another', async () => {
    const t = setup();
    await t.n.notify(payload('finished'), 'api');
    expect(t.sent[0]!.urgency).toBe('normal');
    t.clock.t += 30_000;
    await t.n.notify(payload('finished'), 'api');
    expect(t.sent).toHaveLength(1);
    t.clock.t += 31_000;
    await t.n.notify(payload('finished'), 'api');
    expect(t.sent).toHaveLength(2);
    // another session is not held back
    await t.n.notify(payload('finished', { tag: 'web' }), 'web');
    expect(t.sent).toHaveLength(3);
  });

  it('a finished that was not sent (device visible) does not start the delay', async () => {
    const t = setup();
    t.visible.add('dev1');
    await t.n.notify(payload('finished'), 'api');
    expect(t.sent).toHaveLength(0);
    t.clock.t += 30_000;
    t.visible.clear();
    await t.n.notify(payload('finished'), 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('a decision put to the user: to every hidden device, urgency high, its task as topic', async () => {
    const t = setup();
    await t.n.notify(payload('decision', { title: 'Otto attend votre décision', url: '/#/chat', tag: 't1a2b3c' }), undefined);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ urgency: 'high', topic: 't1a2b3c' });
  });

  it('requests are not held back by the finished delay', async () => {
    const t = setup();
    await t.n.notify(payload('finished'), 'api');
    await t.n.notify(payload('request'), 'api');
    expect(t.sent).toHaveLength(2);
  });

  it('enabled false: nothing is sent', async () => {
    const t = setup({ enabled: false });
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(0);
  });

  it('gone removes the subscription', async () => {
    const t = setup({ result: { result: 'gone', status: 410 } });
    await t.n.notify(payload(), 'api');
    expect(t.pushes.has('dev1')).toBe(false);
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('failed is logged and not retried', async () => {
    const t = setup({ result: { result: 'failed', status: 502 } });
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(1);
    expect(t.logs.join('\n')).toContain('not sent to device dev1');
    expect(t.pushes.has('dev1')).toBe(true);
  });

  it('a sender that throws does not reject notify', async () => {
    const t = setup({ result: () => Promise.reject(new TypeError('boom ' + ENDPOINT)) });
    await expect(t.n.notify(payload(), 'api')).resolves.toBeUndefined();
    expect(t.logs.join('\n')).not.toContain('SECRET-ENDPOINT-TOKEN');
  });

  it('a relay key that changed makes the device stale: no more sends; unavailable too', async () => {
    const t = setup();
    t.setRelayKey('K2');
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(0);
    t.setRelayKey(null);
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(0);
    t.setRelayKey('K1');
    await t.n.notify(payload(), 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('the body always has the same size, even for a long text', async () => {
    const t = setup();
    await t.n.notify(payload('request', { body: 'a' }), 'api');
    await t.n.notify(payload('request', { body: 'é'.repeat(120), title: 'é'.repeat(80) }), 'api');
    const sizes = t.sent.map(m => Buffer.from(m.body, 'base64url').length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(86 + 1024 + 16);
  });

  it('a payload that cannot fit one record is cut in its body, to the same size', async () => {
    const t = setup();
    await t.n.notify(payload('request', { body: 'a' }), 'api');
    // control characters are escaped to six octets each in JSON
    await t.n.notify(payload('request', { title: '\u0001'.repeat(80), body: '\u0002'.repeat(120), url: '/#/request/' + 'a'.repeat(250) }), 'api');
    expect(t.sent).toHaveLength(2);
    expect(new Set(t.sent.map(m => Buffer.from(m.body, 'base64url').length)).size).toBe(1);
  });

  it('a payload whose url exceeds the schema is skipped, not thrown', async () => {
    const t = setup();
    await expect(t.n.notify(payload('request', { url: '/#/request/' + 'a'.repeat(400) }), 'api')).resolves.toBeUndefined();
    expect(t.sent).toHaveLength(0);
    expect(t.logs.join('\n')).not.toContain(TEXT);
  });

  it('no log carries the endpoint or the text', async () => {
    for (const result of [{ result: 'sent' }, { result: 'gone', status: 404 }, { result: 'failed', status: 500 }] as PushSendResult[]) {
      const t = setup({ result });
      await t.n.notify(payload(), 'api');
      await t.n.notify(payload('request', { url: '/#/' + 'a'.repeat(400) }), 'api');
      const all = t.logs.join('\n');
      expect(all).not.toContain('SECRET-ENDPOINT-TOKEN');
      expect(all).not.toContain('fcm.googleapis.com');
      expect(all).not.toContain(TEXT);
    }
  });

  it('the end of a device question: one push to that device only, urgency normal, never the text of the answer', async () => {
    const t = setup();
    t.pushes.set('dev2', { ...t.pushes.get('dev1')!, endpoint: ENDPOINT + '-2' });
    t.visible.add('dev2');
    await t.n.notify(chatEndPayload(undefined, 3), undefined, 'dev1');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ endpoint: ENDPOINT, urgency: 'normal', topic: 'chat' });
    // Hidden or not, `only` names who may be told; the visible one gets nothing.
    await t.n.notify(chatEndPayload(undefined, 3), undefined, 'dev2');
    expect(t.sent).toHaveLength(1);
    t.visible.clear();
    await t.n.notify(chatEndPayload(undefined, 3), undefined, 'dev2');
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]!.endpoint).toBe(ENDPOINT + '-2');
  });

  it('chat payloads: the notification of the constraints, the text of the code on an error, a badge', () => {
    expect(chatEndPayload(undefined, 2)).toEqual({ v: 1, kind: 'chat', title: 'Ledge a répondu', body: 'Touchez pour lire la réponse.', url: '/#/chat', badge: 2, tag: 'chat' });
    expect(chatEndPayload('busy', 0).body).toBe('Ledge répond déjà à d\'autres questions. Réessayez dans un instant.');
    expect(chatEndPayload('timeout', 0).body).toBe('Ledge n\'a pas répondu à temps.');
    expect(chatEndPayload('failed', 0).body).toBe('Ledge n\'a pas pu répondre.');
    expect(chatEndPayload('cancelled', 0).body).toBe('Question arrêtée.');
  });

  it('a chat end is not held back by the finished delay, and a device without a subscription gets nothing', async () => {
    const t = setup();
    await t.n.notify(chatEndPayload(undefined, 0), undefined, 'dev1');
    await t.n.notify(chatEndPayload(undefined, 0), undefined, 'dev1');
    expect(t.sent).toHaveLength(2);
    await t.n.notify(chatEndPayload(undefined, 0), undefined, 'nobody');
    expect(t.sent).toHaveLength(2);
  });
});
