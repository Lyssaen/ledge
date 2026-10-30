import { afterEach, describe, expect, it } from 'vitest';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';

let fake: FakeOpenRig | null = null;
afterEach(async () => { await fake?.stop(); fake = null; });

/** Reads SSE frames from `res` until `n` data frames arrived or the stream ends. */
async function frames(res: Response, n: number) {
  const out: { id?: string; data: any }[] = []; const dec = new TextDecoder(); let buf = '';
  const reader = res.body!.getReader();
  while (out.length < n) {
    const r = await reader.read(); if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split('\n').find(l => l.startsWith('data: ')); const id = block.split('\n').find(l => l.startsWith('id: '));
      if (data) out.push({ id: id?.slice(4), data: JSON.parse(data.slice(6)) });
    }
  }
  reader.cancel().catch(() => {});
  return out;
}

describe('fake OpenRig', () => {
  it('resumes with Last-Event-ID then streams live; replay=0 is live only', async () => {
    fake = await createFakeOpenRig();
    for (let i = 0; i < 3; i++) fake.emit({ type: 'queue.created', n: i });
    const res = await fetch(`${fake.url}/api/events`, { headers: { 'Last-Event-ID': '1' } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const p = frames(res, 3);
    setTimeout(() => fake!.emit({ type: 'queue.updated' }), 30);
    const got = await p;
    expect(got.map(f => f.data.seq)).toEqual([2, 3, 4]);
    expect(got.map(f => f.id)).toEqual(['2', '3', '4']);
    expect(got[2]!.data.type).toBe('queue.updated');
    expect(fake.requests.at(-1)).toMatchObject({ method: 'GET', path: '/api/events', lastEventId: '1' });
    const res0 = await fetch(`${fake.url}/api/events?replay=0`);
    const p0 = frames(res0, 1);
    setTimeout(() => fake!.emit({ type: 'seat.activity_changed' }), 30);
    expect((await p0)[0]!.data.seq).toBe(5);
  });

  it('stop() ends open streams; restart() reuses port and journal', async () => {
    fake = await createFakeOpenRig({ version: '0.6.14' });
    fake.emit({ type: 'a' });
    const port = fake.port;
    const res = await fetch(`${fake.url}/api/events?replay=0`);
    const reader = res.body!.getReader();
    await fake.stop();
    const r = await reader.read().catch(() => ({ done: true }));
    expect(r.done).toBe(true);
    await expect(fetch(`${fake.url}/healthz`)).rejects.toThrow();
    await fake.restart();
    expect(fake.port).toBe(port);
    expect(await (await fetch(`${fake.url}/healthz`)).json()).toMatchObject({ status: 'ok', semver: '0.6.14' });
    expect(fake.emit({ type: 'b' })).toBe(2);
  });

  it('healthz omits semver when version is null; serves ps, nodes, kernel, queue, outbox', async () => {
    fake = await createFakeOpenRig({ version: null });
    expect(await (await fetch(`${fake.url}/healthz`)).json()).not.toHaveProperty('semver');
    fake.rigs.push({ rigId: 'r1', name: 'starter', status: 'running', nodes: [{ logicalId: 'dev.build', podId: 'dev', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w', activityState: { activity: 'working' } }] });
    const ps = await (await fetch(`${fake.url}/api/ps`)).json();
    expect(ps[0]).toMatchObject({ rigId: 'r1', name: 'starter', status: 'running', nodeCount: 1 });
    const nodes = await (await fetch(`${fake.url}/api/rigs/r1/nodes`)).json();
    expect(nodes[0]).toMatchObject({ rigId: 'r1', canonicalSessionName: 'dev-build@starter' });
    expect((await fetch(`${fake.url}/api/rigs/nope/nodes`)).status).toBe(404);
    fake.kernel.state = 'booting';
    expect(await (await fetch(`${fake.url}/api/kernel/status`)).json()).toMatchObject({ state: 'booting', kernel_state: 'booting' });
    fake.queue.push({ qitemId: 'q1', sourceSession: 'a@r', destinationSession: 'ledge@external', state: 'pending', summary: 's', body: 'b' }, { qitemId: 'q2', sourceSession: 'a@r', destinationSession: 'x@r', state: 'pending' });
    const q = await (await fetch(`${fake.url}/api/queue/list?destinationSession=ledge%40external&state=pending`)).json();
    expect(q.map((r: any) => r.qitemId)).toEqual(['q1']);
    fake.outbox.set('a@r', [{ outboxId: 'outbox-1', senderSession: 'a@r', destinationSession: 'b@r', body: 'hi', deliveryState: 'pending' }]);
    expect((await (await fetch(`${fake.url}/api/queue/outbox/list?senderSession=a%40r`)).json())[0].outboxId).toBe('outbox-1');
    expect(await (await fetch(`${fake.url}/api/queue/outbox/list?senderSession=zz`)).json()).toEqual([]);
  });
});

describe('fakeRigCli', () => {
  it('versions, daemon start, humans', async () => {
    fake = await createFakeOpenRig({ version: '0.6.14' });
    const cli = fakeRigCli(fake);
    expect(await cli(['--version'])).toEqual({ code: 0, stdout: '0.6.14 (fake)\n', stderr: '' });
    expect((await fakeRigCli(null)(['--version'])).code).toBe(127);
    await fake.stop();
    expect((await cli(['daemon', 'start'])).code).toBe(0);
    expect((await fetch(`${fake.url}/healthz`)).status).toBe(200);
    expect((await fakeRigCli(fake, { startFails: true })(['daemon', 'start'])).code).toBe(1);
    expect(JSON.parse((await cli(['gateway', 'human', 'list', '--json'])).stdout)).toEqual([]);
    expect((await cli(['gateway', 'human', 'add', 'ledge', '--x'])).code).toBe(0);
    expect(JSON.parse((await cli(['gateway', 'human', 'list', '--json'])).stdout)).toEqual([{ id: 'ledge' }]);
    const refused = await cli(['gateway', 'human', 'add', 'other']);
    expect(refused.code).toBe(1); expect(refused.stderr).toMatch(/refused: a human is already configured \(ledge\)/);
    expect((await cli(['gateway', 'human', 'add', 'other', '--replace'])).code).toBe(0);
    expect(fake.humans).toEqual(['other']);
    expect(cli.calls.length).toBe(7);
  });
});
