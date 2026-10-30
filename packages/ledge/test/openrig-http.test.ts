import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeOpenRig, type FakeOpenRig } from './fakes/openrig.js';
import { createOpenRigHttp, OpenRigUnreachable } from '../src/daemon/openrig/http.js';
import { OPEN_QUEUE_STATES } from '../src/daemon/openrig/facts.js';

let fake: FakeOpenRig;
beforeEach(async () => { fake = await createFakeOpenRig(); });
afterEach(async () => { await fake.stop(); });

const node = { logicalId: 'dev.impl', canonicalSessionName: 'dev-impl@r1', sessionStatus: 'running' };
const row = (id: string, extra = {}) => ({ qitemId: id, sourceSession: 'a@r1', destinationSession: 'ledge@external', state: 'pending', ...extra });

describe('OpenRig http client', () => {
  it('health, ps, nodes, kernel', async () => {
    fake.rigs.push({ rigId: 'r1', name: 'alpha', status: 'running', nodes: [node] });
    const h = createOpenRigHttp({ base: fake.url });
    expect((await h.health()).semver).toBe('0.6.14');
    const ps = await h.ps();
    expect(ps.map(r => r.rigId)).toEqual(['r1']);
    expect((await h.nodes('r1'))[0]!.logicalId).toBe('dev.impl');
    expect((await h.kernel()).state).toBe('ready');
  });

  it('queue sends destinationSession and comma-joined state', async () => {
    fake.queue.push(row('q1'));
    const urls: string[] = [];
    const h = createOpenRigHttp({ base: fake.url, fetch: (i, init) => { urls.push(String(i)); return fetch(i, init); } });
    await h.queue({ destinationSession: 'ledge@external', state: OPEN_QUEUE_STATES });
    expect(urls[0]).toContain('?destinationSession=ledge%40external&state=pending,in-progress,blocked');
  });

  it('skips a queue row without qitemId and keeps the others', async () => {
    fake.queue.push(row('q1'), { sourceSession: 'x', destinationSession: 'y', state: 'pending' } as never, row('q2'));
    const rows = await createOpenRigHttp({ base: fake.url }).queue({});
    expect(rows.map(r => r.qitemId)).toEqual(['q1', 'q2']);
  });

  it('accepts an object wrapping items, passes unknown fields through', async () => {
    const h = createOpenRigHttp({ base: fake.url, fetch: async () => new Response(JSON.stringify({ items: [{ ...row('q1'), newField: 1 }] })) });
    const [r] = await h.queue({});
    expect((r as Record<string, unknown>).newField).toBe(1);
  });

  it('outbox lists by sender', async () => {
    fake.outbox.set('ledge@external', [{ outboxId: 'outbox-1', senderSession: 'ledge@external', destinationSession: 'a@r1', body: 'hi', deliveryState: 'delivered' }]);
    expect((await createOpenRigHttp({ base: fake.url }).outbox('ledge@external')).map(o => o.outboxId)).toEqual(['outbox-1']);
  });

  it('non-2xx throws with the status', async () => {
    await expect(createOpenRigHttp({ base: fake.url }).nodes('nope')).rejects.toThrow(/404/);
  });

  it('rejects OpenRigUnreachable once the port is closed', async () => {
    const h = createOpenRigHttp({ base: fake.url });
    await fake.stop();
    await expect(h.health()).rejects.toBeInstanceOf(OpenRigUnreachable);
  });

  it('maps ECONNRESET and timeouts to OpenRigUnreachable', async () => {
    const reset = createOpenRigHttp({ base: fake.url, fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } });
    await expect(reset.health()).rejects.toBeInstanceOf(OpenRigUnreachable);
    const slow = createOpenRigHttp({ base: fake.url, timeoutMs: 20, fetch: (_i, init) => new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason))) });
    await expect(slow.health()).rejects.toBeInstanceOf(OpenRigUnreachable);
  });
});
