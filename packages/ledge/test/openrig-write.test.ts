import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerMessageSchema, type Escalation, type Projects } from '@ledge/protocol';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { createBridge, type Bridge, type BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { createOpenRigHttp } from '../src/daemon/openrig/http.js';
import { createRigCli } from '../src/daemon/openrig/cli.js';
import { createCursorWriter, readOpenRigFile } from '../src/daemon/openrig/cursor.js';

const until = async (ok: () => boolean, ms = 4000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const dirs: string[] = []; let fake: FakeOpenRig | null = null; let bridge: Bridge | null = null;
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-write-')); dirs.push(d); return d; };
afterEach(async () => { await bridge?.stop(); bridge = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });
const answer = (at: string): NonNullable<Escalation['answer']> => ({ by: 'user', answers: { q1: 'sqlite' }, at });

describe('OpenRig http action', () => {
  it('POSTs the mission-control action with the session header, bearer token when given, and never throws on 409', async () => {
    fake = await createFakeOpenRig(); fake.queue.push(humanRow('qi-1'));
    const h = createOpenRigHttp({ base: fake.url, token: 'tok-1' });
    const first = await h.action({ verb: 'approve', qitemId: 'qi-1', annotation: 'note' }, { session: 'ledge@external' });
    expect(first.status).toBe(200);
    const req = fake.requests.find(r => r.method === 'POST')!;
    expect(req.path).toBe('/api/mission-control/action');
    expect(req.body).toEqual({ verb: 'approve', qitemId: 'qi-1', annotation: 'note' });
    expect(req.headers).toMatchObject({ 'x-openrig-session': 'ledge@external', authorization: 'Bearer tok-1', 'content-type': 'application/json' });
    const second = await h.action({ verb: 'approve', qitemId: 'qi-1' }, { session: 'ledge@external' });
    expect(second).toEqual({ status: 409, json: expect.objectContaining({ error: 'qitem_already_terminal', state: 'done' }) });
  });

  it('sends no authorization header without a token', async () => {
    fake = await createFakeOpenRig(); fake.queue.push(humanRow('qi-1'));
    await createOpenRigHttp({ base: fake.url }).action({ verb: 'approve', qitemId: 'qi-1' }, { session: 'ledge@external' });
    expect(fake.requests.find(r => r.method === 'POST')!.headers).not.toHaveProperty('authorization');
  });
});

describe('rig queue create', () => {
  it('builds the argv, with --reply-to for an update, and reads the new row id from --json', async () => {
    fake = await createFakeOpenRig(); const exec = fakeRigCli(fake); const cli = createRigCli(exec);
    const body = join(tmp(), 'reply.md'); writeFileSync(body, 'Réponse de Ledge : base → sqlite');
    const r = await cli.queueCreate({ source: 'ledge@external', destination: 'dev-build@starter', summary: 'Réponse de Ledge : base → sqlite', bodyFile: body, replyTo: 'qi-9' });
    expect(exec.calls[0]).toEqual(['queue', 'create', '--source', 'ledge@external', '--destination', 'dev-build@starter', '--summary', 'Réponse de Ledge : base → sqlite',
      '--body-file', body, '--reply-to', 'qi-9', '--json']);
    expect(r.ok).toBe(true); expect(r.qitemId).toBe(fake.queue[0]!.qitemId);
    expect(fake.queue[0]).toMatchObject({ sourceSession: 'ledge@external', destinationSession: 'dev-build@starter', replyTo: 'qi-9', body: 'Réponse de Ledge : base → sqlite' });
    await cli.queueCreate({ source: 'ledge@external', destination: 'dev-build@starter', summary: 's', bodyFile: body });
    expect(exec.calls[1]).not.toContain('--reply-to');
  });

  it('parses the row id defensively and reports a failure', async () => {
    const out = (stdout: string, code = 0) => createRigCli(async () => ({ code, stdout, stderr: code ? 'refused' : '' }));
    const o = { source: 'a', destination: 'b', summary: 's', bodyFile: '/x' };
    expect(await out('{"qitemId":"qitem-1"}').queueCreate(o)).toEqual({ ok: true, qitemId: 'qitem-1' });
    expect(await out('{"item":{"qitemId":"qitem-2","state":"pending"}}').queueCreate(o)).toEqual({ ok: true, qitemId: 'qitem-2' });
    expect(await out('created qitem-20261030-abc (pending)\n').queueCreate(o)).toEqual({ ok: true, qitemId: 'qitem-20261030-abc' });
    expect(await out('{"sourceSession":"a","state":"pending"}').queueCreate(o)).toEqual({ ok: true });
    expect(await out('', 1).queueCreate(o)).toEqual({ ok: false, detail: 'refused' });
  });
});

describe('openrig.json reply rows', () => {
  it('keeps replyRows through cursor writes and reads them back', async () => {
    const f = join(tmp(), 'openrig.json');
    const w = createCursorWriter({ file: f, now: () => 'NOW' });
    w.setReplyRow('qi-1', 'qitem-r1'); expect(w.replyRow('qi-1')).toBe('qitem-r1');
    w.set('local', { lastEventId: 3 }); await w.flush();
    expect(readOpenRigFile(f)).toEqual({ version: 1, machines: { local: { lastEventId: 3, rigs: [], at: 'NOW' } }, replyRows: { 'qi-1': 'qitem-r1' } });
    const again = createCursorWriter({ file: f }); again.set('local', { lastEventId: 4 }); await again.flush();
    expect(JSON.parse(readFileSync(f, 'utf8')).replyRows).toEqual({ 'qi-1': 'qitem-r1' });
    expect(again.replyRow('qi-1')).toBe('qitem-r1');
  });

  it('drops a malformed replyRows key', () => {
    const f = join(tmp(), 'openrig.json');
    writeFileSync(f, JSON.stringify({ version: 1, machines: {}, replyRows: { a: 'r', b: 3 } }));
    expect(readOpenRigFile(f).replyRows).toEqual({ a: 'r' });
  });
});

describe('bridge write side', () => {
  async function setup(now = () => new Date().toISOString()) {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'), humanRow('E2'));
    const d = tmp(); const file = join(d, 'openrig.json'); const msgs: BridgeMessage[] = [];
    const b = bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => none, home: d, file,
      sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 40, now });
    b.onMessage(m => { ServerMessageSchema.parse(m); msgs.push(m); });
    await b.start(); await until(() => b.status().state === 'running' && b.escalations().length === 2);
    const of = <T extends BridgeMessage['type']>(t: T) => msgs.filter((m): m is Extract<BridgeMessage, { type: T }> => m.type === t);
    return { b, file, msgs, of };
  }
  const close = (id: string) => { fake!.queue.find(r => r.qitemId === id)!.state = 'done'; fake!.emit({ type: 'queue.updated', qitemId: id, fromState: 'pending', toState: 'done' }); };

  it('a patched escalation survives re-reads and the closing of its row, and replays', async () => {
    const { b, of, msgs } = await setup();
    const p = b.patchEscalation('E1', { state: 'answered', answer: answer('2026-10-31T10:00:00.000Z') });
    expect(p).toMatchObject({ id: 'E1', state: 'answered' });
    expect(of('escalation.updated').at(-1)!.escalation).toMatchObject({ id: 'E1', state: 'answered', answer: { by: 'user' } });
    close('E1'); close('E2');
    await until(() => of('escalation.removed').some(m => m.id === 'E2'));
    await new Promise(r => setTimeout(r, 120)); // several resyncs
    expect(of('escalation.removed').some(m => m.id === 'E1')).toBe(false);
    expect(b.escalation('E1')).toMatchObject({ state: 'answered', answer: { answers: { q1: 'sqlite' } } });
    expect(b.escalation('E2')).toBeUndefined();
    expect(b.escalations().map(e => e.id)).toEqual(['E1']);
    expect(b.replay().filter(m => m.type === 'escalation.updated').map(m => (m as { escalation: Escalation }).escalation)).toEqual([expect.objectContaining({ id: 'E1', state: 'answered' })]);
    expect(msgs.filter(m => m.type === 'escalation.updated' && m.escalation.id === 'E1' && m.escalation.state === 'pending').length).toBe(1); // only the first read
  });

  it('a rollback drops the overlay: the row is pending again, without answer', async () => {
    const { b, of } = await setup();
    const before = b.escalation('E1')!;
    b.patchEscalation('E1', { state: 'answered', answer: answer('2026-10-31T10:00:00.000Z') });
    b.patchEscalation('E1', { state: 'pending', answer: undefined, graceUntil: undefined });
    expect(b.escalation('E1')).toEqual(before);
    expect(of('escalation.updated').at(-1)!.escalation).toEqual(before);
    close('E1'); await until(() => of('escalation.removed').some(m => m.id === 'E1'));
  });

  it('an answered escalation is forgotten 24 h after its patch', async () => {
    let t = Date.parse('2026-10-31T10:00:00.000Z'); const { b, of } = await setup(() => new Date(t).toISOString());
    b.patchEscalation('E1', { state: 'answered', answer: answer('2026-10-31T10:00:00.000Z') }); close('E1');
    await new Promise(r => setTimeout(r, 100)); expect(b.escalation('E1')).toBeDefined();
    t += 24 * 3600_000 + 1;
    await until(() => of('escalation.removed').some(m => m.id === 'E1'));
    expect(b.escalation('E1')).toBeUndefined();
  });

  it('patching an unknown id does nothing', async () => {
    const { b } = await setup();
    expect(b.patchEscalation('nope', { state: 'answered' })).toBeUndefined();
  });

  it('exposes the rig CLI, the action route and the reply rows of openrig.json', async () => {
    const { b, file } = await setup();
    expect(typeof b.cli().queueCreate).toBe('function');
    expect((await b.http()!.action({ verb: 'approve', qitemId: 'E2' }, { session: 'ledge@external' })).status).toBe(200);
    b.setReplyRow('E1', 'qitem-r1'); expect(b.replyRow('E1')).toBe('qitem-r1');
    await b.stop(); bridge = null;
    expect(readOpenRigFile(file).replyRows).toEqual({ E1: 'qitem-r1' });
  });
});
