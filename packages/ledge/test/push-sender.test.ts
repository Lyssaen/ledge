import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PushPayload } from '@ledge/protocol';
import { DeviceStore } from '../src/daemon/devices.js';
import { createPushSender } from '../src/daemon/push/sender.js';

const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'https://pc.t.ts.net' };
const sub = (host = 'web.push.apple.com') => ({ endpoint: `https://${host}/s/1`, keys: { p256dh: 'p', auth: 'a' } });
const payload = (kind: PushPayload['kind'] = 'request'): PushPayload => ({ v: 1, kind, title: 't', body: 'b', url: '/m/#/x', badge: 1, tag: 'req-1' });

describe('push sender', () => {
  let dir: string; let devices: DeviceStore; let id: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-push-'));
    devices = new DeviceStore({ path: join(dir, 'devices.json') });
    id = (await devices.create('iPhone', { id: 'c', publicKey: 'pk', counter: 0 })).device.id;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const make = (send: any, env: NodeJS.ProcessEnv = {}) => createPushSender({ devices, vapid: async () => vapid, env: async () => env, send });

  it('no subscription, no call', async () => {
    const send = vi.fn();
    await make(send).notify(payload());
    expect(send).not.toHaveBeenCalled();
  });
  it('sends nothing while mobile access is disabled', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockResolvedValue({});
    let origin: string | null = null;
    const sender = createPushSender({ devices, vapid: async () => vapid, env: async () => ({}), send, enabled: () => origin !== null });
    await sender.notify(payload());
    expect(send).not.toHaveBeenCalled();
    origin = 'https://pc.t.ts.net';
    await sender.notify(payload());
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('sends the payload with the push options', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockResolvedValue({});
    await make(send).notify(payload('finished'));
    expect(send).toHaveBeenCalledWith(sub(), JSON.stringify(payload('finished')), { vapidDetails: vapid, TTL: 3600, urgency: 'normal', topic: 'req-1', timeout: 10_000 });
    await make(send).notify(payload('request'));
    expect(send.mock.calls[1]![2].urgency).toBe('high');
  });
  it('sends a topic web-push accepts, whatever the tag holds', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockResolvedValue({});
    await make(send).notify({ ...payload(), tag: 'fin-a b/é.1' });
    expect(send.mock.calls[0]![2].topic).toBe('fin-a_b___1');
  });
  it('uses the login shell proxy when there is one', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockResolvedValue({});
    await make(send, { https_proxy: 'http://proxy:3128' }).notify(payload());
    expect(send.mock.calls[0]![2].proxy).toBe('http://proxy:3128');
    await make(send, { HTTPS_PROXY: 'http://up:1', https_proxy: 'http://low:2' }).notify(payload());
    expect(send.mock.calls[1]![2].proxy).toBe('http://up:1');
  });
  it.each([404, 410])('drops a subscription the push service says is gone (%i)', async status => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: status }));
    await make(send).notify(payload());
    expect(devices.get(id)?.push).toBeUndefined();
  });
  it('keeps the subscription on any other failure and does not retry', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    await expect(make(send).notify(payload())).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(devices.get(id)?.push).toBeDefined();
  });
  it('never posts to an endpoint outside the allow-list, even one read from disk', async () => {
    await devices.setPush(id, sub('attacker.example'));
    const send = vi.fn();
    await make(send).notify(payload());
    expect(send).not.toHaveBeenCalled();
  });
  it('without VAPID keys nothing is sent', async () => {
    await devices.setPush(id, sub());
    const send = vi.fn();
    await createPushSender({ devices, vapid: async () => null, env: async () => ({}), send }).notify(payload());
    expect(send).not.toHaveBeenCalled();
  });
});
