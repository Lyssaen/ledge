import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { DEFAULT_DEVICE_PREFS, type DevicePrefs, type MobileState, type PushPayload, type PushSend, type PushSendResult } from '@ledge/protocol';
import { createNotifier, wanted } from '../src/mobile/push/notifier.js';
import { chatEndPayload, resolvedFor } from '../src/mobile/push/triggers.js';
import { pointPush } from '../src/operator/notices.js';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/SECRET-ENDPOINT-TOKEN';
const TEXT = 'private-words-of-the-agent';

const payload = (kind: PushPayload['kind'] = 'request', over: Partial<PushPayload> = {}): PushPayload => ({
  v: 1, kind, title: 'api attend votre accord', body: TEXT, url: '/#/request/api/k1', badge: 1, tag: 'api', ...over
});

function setup(o: { enabled?: boolean; result?: PushSendResult | (() => Promise<PushSendResult>); prefs?: Map<string, DevicePrefs> } = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const pushes = new Map<string, { endpoint: string; p256dh: string; auth: string; key: string; resolved?: true }>([['dev1', { endpoint: ENDPOINT, ...keys, key: 'K1' }]]);
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
      ...(o.prefs ? { prefsOf: (id: string) => o.prefs!.get(id) ?? DEFAULT_DEVICE_PREFS } : {}),
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
  return { n, sent, logs, pushes, keys, visible, online, clock, setRelayKey: (k: string | null | undefined) => { relayKey = k; } };
}

describe('point push', () => {
  it('point push is held by a pause and by notify.finished false', async () => {
    const at = Date.parse('2026-11-13T10:00:00.000Z');
    const off: DevicePrefs = { ...DEFAULT_DEVICE_PREFS, notify: { ...DEFAULT_DEVICE_PREFS.notify, finished: false } };
    const paused: DevicePrefs = { ...DEFAULT_DEVICE_PREFS, quietUntil: new Date(at + 60_000).toISOString() };
    expect(wanted({ kind: 'point' }, DEFAULT_DEVICE_PREFS, at)).toBe(true);
    expect(wanted({ kind: 'point' }, off, at)).toBe(false);
    expect(wanted({ kind: 'point' }, paused, at)).toBe(false);
    const t = setup();
    await t.n.notify(pointPush('Two things wait for you', 'q1', 2), undefined, 'dev1');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ urgency: 'normal', topic: 'point' });
    const held = setup({ prefs: new Map([['dev1', off]]) });
    await held.n.notify(pointPush('x', 'q1', 0), undefined, 'dev1');
    expect(held.sent).toHaveLength(0);
  });
});

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

  it('resolved: only to a device that got the request, knows the kind and is hidden; once', async () => {
    const t = setup();
    t.pushes.set('dev1', { ...t.pushes.get('dev1')!, resolved: true });
    t.pushes.set('dev2', { endpoint: ENDPOINT + '2', ...t.keys, key: 'K1', resolved: true });
    t.pushes.set('dev3', { endpoint: ENDPOINT + '3', ...t.keys, key: 'K1' });
    t.visible.add('dev2');
    await t.n.notify(payload(), 'api'); // dev1 and dev3 get the request; dev2 is in front
    expect(t.sent.map(m => m.endpoint).sort()).toEqual([ENDPOINT, ENDPOINT + '3']);
    t.visible.clear();
    t.sent.length = 0;
    const done = payload('resolved', { title: 'api · traitée', body: 'sur iPad' });
    await t.n.notify(done, 'api');
    // dev2 never got the request, dev3's service worker does not know `resolved`.
    expect(t.sent.map(m => m.endpoint)).toEqual([ENDPOINT]);
    expect(t.sent[0]).toMatchObject({ urgency: 'normal', topic: 'api' });
    await t.n.notify(done, 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('resolvedFor: a request gone without another names who answered, nothing for a new one or none before', () => {
    const s = (pending?: { kind: 'permission'; text: string; source: 'hook' }) => ({ id: 'api', name: 'Nova', pending } as never);
    const P = { kind: 'permission' as const, text: 'ls', source: 'hook' as const };
    expect(resolvedFor(s(P), s(), [], { kind: 'device', id: 'd', name: 'iPad' })).toMatchObject({ kind: 'resolved', title: 'Nova · traitée', body: 'sur iPad', tag: 'api', badge: 0 });
    expect(resolvedFor(s(P), s(), [], { kind: 'pc' })).toMatchObject({ body: 'sur le PC' });
    expect(resolvedFor(s(P), s(), [], null)).toMatchObject({ body: '' });
    expect(resolvedFor(s(P), s({ ...P, text: 'pwd' }), [])).toBeNull();
    expect(resolvedFor(s(), s(), [])).toBeNull();
    expect(resolvedFor(undefined, s(), [])).toBeNull();
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

describe('push notifier: the device\'s own settings (Réglages)', () => {
  const at = Date.parse('2026-11-05T12:00:00.000Z');
  const off = (kind: 'finished' | 'chat' | 'decision'): DevicePrefs => ({ ...DEFAULT_DEVICE_PREFS, notify: { ...DEFAULT_DEVICE_PREFS.notify, [kind]: false } });

  it('wanted: each mutable kind follows its switch, requests and questions always go, no settings lets all through', () => {
    for (const kind of ['finished', 'chat', 'decision'] as const) {
      expect(wanted({ kind }, off(kind), at)).toBe(false);
      expect(wanted({ kind }, DEFAULT_DEVICE_PREFS, at)).toBe(true);
    }
    const all: DevicePrefs = { ...DEFAULT_DEVICE_PREFS, notify: { finished: false, chat: false, decision: false } };
    expect(wanted({ kind: 'request' }, all, at)).toBe(true);
    expect(wanted({ kind: 'question' }, all, at)).toBe(true);
    expect(wanted({ kind: 'finished' }, undefined, at)).toBe(true);
  });

  it('wanted: a pause holds every kind until it ends, but never a resolved', () => {
    const paused: DevicePrefs = { ...DEFAULT_DEVICE_PREFS, quietUntil: '2026-11-05T13:00:00.000Z' };
    for (const kind of ['request', 'question', 'finished', 'chat', 'decision'] as const) expect(wanted({ kind }, paused, at)).toBe(false);
    expect(wanted({ kind: 'resolved' }, paused, at)).toBe(true);
    expect(wanted({ kind: 'request' }, paused, Date.parse('2026-11-05T13:00:00.001Z'))).toBe(true);
  });

  it('a device that turned « Agent terminé » off gets no finished, and the turn\'s delay does not start', async () => {
    const prefs = new Map([['dev1', off('finished')]]);
    const t = setup({ prefs });
    await t.n.notify(payload('finished', { url: '/#/thread/api' }), 'api');
    expect(t.sent).toHaveLength(0);
    prefs.set('dev1', DEFAULT_DEVICE_PREFS);
    await t.n.notify(payload('finished', { url: '/#/thread/api' }), 'api');
    expect(t.sent).toHaveLength(1);
  });

  it('a paused device gets nothing; another one still does', async () => {
    const t = setup({ prefs: new Map([['dev1', { ...DEFAULT_DEVICE_PREFS, quietUntil: new Date(2_000_000).toISOString() }]]) });
    t.pushes.set('dev2', { ...t.pushes.get('dev1')!, endpoint: 'https://fcm.googleapis.com/fcm/send/OTHER' });
    await t.n.notify(payload(), 'api');
    expect(t.sent.map(s => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/OTHER']);
    t.clock.t = 2_000_001;
    await t.n.notify(payload('request', { tag: 'api2' }), 'api2');
    expect(t.sent).toHaveLength(3);
  });
});
