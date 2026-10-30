import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeOpenRig, type FakeOpenRig } from './fakes/openrig.js';
import { openEventStream, type OpenRigEvent, type EventStream } from '../src/daemon/openrig/sse.js';
import { readOpenRigFile, createCursorWriter } from '../src/daemon/openrig/cursor.js';

const until = async (ok: () => boolean, ms = 2000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-openrig-')); dirs.push(d); return d; };
let fake: FakeOpenRig | null = null; let stream: EventStream | null = null;
afterEach(async () => { stream?.close(); stream = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('openEventStream', () => {
  it('resumes after lastEventId with the Last-Event-ID header', async () => {
    fake = await createFakeOpenRig();
    for (let i = 1; i <= 4; i++) fake.emit({ type: 'rig.created', rigId: `r${i}` });
    const got: OpenRigEvent[] = []; let opened = 0;
    stream = openEventStream({ base: fake.url, lastEventId: 2, onEvent: e => got.push(e), onOpen: () => opened++, onEnd: () => {} });
    await until(() => got.length === 2);
    expect(got.map(e => e.seq)).toEqual([3, 4]); expect(got[0]).toMatchObject({ type: 'rig.created', rigId: 'r3' }); expect(opened).toBe(1);
    expect(fake.requests.find(r => r.path === '/api/events')?.lastEventId).toBe('2');
    fake.emit({ type: 'node.x' }); await until(() => got.length === 3); expect(got[2]!.seq).toBe(5);
  });
  it('asks ?replay=0 without a cursor', async () => {
    fake = await createFakeOpenRig(); fake.emit({ type: 'old' });
    const got: OpenRigEvent[] = []; let opened = false;
    stream = openEventStream({ base: fake.url, lastEventId: null, onEvent: e => got.push(e), onOpen: () => { opened = true; }, onEnd: () => {} });
    await until(() => opened);
    const req = fake.requests.find(r => r.path === '/api/events')!; expect(req.search).toBe('?replay=0'); expect(req.lastEventId).toBeUndefined();
    fake.emit({ type: 'new' }); await until(() => got.length === 1); expect(got[0]!.type).toBe('new');
  });
  it('calls onEnd once when the server goes away, never on close()', async () => {
    fake = await createFakeOpenRig(); const ends: (Error | undefined)[] = []; let opened = false;
    stream = openEventStream({ base: fake.url, lastEventId: null, onEvent: () => {}, onOpen: () => { opened = true; }, onEnd: e => ends.push(e) });
    await until(() => opened); await fake.stop(); await until(() => ends.length > 0); await sleep(50); expect(ends).toHaveLength(1);
    fake = await createFakeOpenRig(); let o2 = false; let e2 = 0;
    const s2 = openEventStream({ base: fake.url, lastEventId: null, onEvent: () => {}, onOpen: () => { o2 = true; }, onEnd: () => e2++ });
    await until(() => o2); s2.close(); await sleep(50); expect(e2).toBe(0);
  });
  it('ends with an error when the port is closed or the answer is not 200', async () => {
    fake = await createFakeOpenRig(); const base = fake.url; await fake.stop();
    const ends: (Error | undefined)[] = [];
    stream = openEventStream({ base, lastEventId: null, onEvent: () => {}, onOpen: () => { throw new Error('opened'); }, onEnd: e => ends.push(e) });
    await until(() => ends.length > 0); expect(ends[0]).toBeInstanceOf(Error);
    const bad = openEventStream({ base: 'http://x', lastEventId: null, onEvent: () => {}, onOpen: () => {}, onEnd: e => ends.push(e),
      fetch: (async () => new Response('no', { status: 503 })) as typeof fetch });
    await until(() => ends.length > 1); expect(ends[1]!.message).toContain('503'); bad.close();
  });
  it('parses chunked frames, comments, multi-line data, junk, and skips non-increasing seq', async () => {
    const enc = new TextEncoder();
    const body = ['data: {"type":"a",', '"seq":1}\nid: 1\n\n:keep-alive\n\nda', 'ta: not json\nid: 2\n\ndata: {"type":"b"\ndata: ,"seq":3}\nid: 3\n\n',
      'data: {"type":"dup","seq":3}\nid: 3\n\ndata: {"type":"old","seq":2}\nid: 2\n\r\n\r\ndata: {"type":"c","seq":9}\r\nid: 9\r\n\r\n'];
    const fetchFn = (async () => new Response(new ReadableStream({ start(c) { for (const b of body) c.enqueue(enc.encode(b)); c.close(); } }), { status: 200 })) as typeof fetch;
    const got: OpenRigEvent[] = []; const ends: unknown[] = [];
    stream = openEventStream({ base: 'http://x', fetch: fetchFn, lastEventId: null, onEvent: e => got.push(e), onOpen: () => {}, onEnd: e => ends.push(e) });
    await until(() => ends.length > 0); await sleep(20);
    expect(got.map(e => [e.type, e.seq])).toEqual([['a', 1], ['b', 3], ['c', 9]]); expect(ends).toEqual([undefined]);
  });
});

describe('cursor file', () => {
  it('reads absent and truncated files as the empty default without throwing', () => {
    const d = tmp(); const f = join(d, 'openrig.json');
    expect(readOpenRigFile(f)).toEqual({ version: 1, machines: {} });
    writeFileSync(f, '{"version":'); expect(readOpenRigFile(f)).toEqual({ version: 1, machines: {} });
    writeFileSync(f, '{"version":2,"machines":{}}'); expect(readOpenRigFile(f)).toEqual({ version: 1, machines: {} });
  });
  it('drops malformed machine entries but keeps good ones', () => {
    const f = join(tmp(), 'openrig.json');
    writeFileSync(f, JSON.stringify({ version: 1, machines: { local: { lastEventId: 4, rigs: ['a'], at: 't' }, bad: { lastEventId: 'x' } } }));
    expect(readOpenRigFile(f).machines).toEqual({ local: { lastEventId: 4, rigs: ['a'], at: 't' } });
  });
  it('coalesces a burst into one write, flush() puts it on disk', async () => {
    const f = join(tmp(), 'openrig.json'); const w = createCursorWriter({ file: f, now: () => 'NOW' });
    for (let i = 1; i <= 10; i++) { w.set('local', { lastEventId: i === 10 ? 7 : i }); await sleep(5); }
    expect(existsSync(f)).toBe(false);
    await w.flush();
    expect(readOpenRigFile(f)).toEqual({ version: 1, machines: { local: { lastEventId: 7, rigs: [], at: 'NOW' } } });
    expect(existsSync(`${f}.tmp`)).toBe(false);
  });
  it('merges patches, keeps other machines, and writes the trailing state after the interval', async () => {
    const f = join(tmp(), 'openrig.json');
    writeFileSync(f, JSON.stringify({ version: 1, machines: { nas: { lastEventId: 1, rigs: [], at: 't' } } }));
    const w = createCursorWriter({ file: f, minIntervalMs: 30 });
    w.set('local', { lastEventId: 3 }); w.set('local', { rigs: ['r1'] });
    await until(() => readOpenRigFile(f).machines.local !== undefined);
    expect(readOpenRigFile(f).machines).toMatchObject({ nas: { lastEventId: 1 }, local: { lastEventId: 3, rigs: ['r1'] } });
    await w.flush(); // nothing pending: resolves
  });
  it('flush() with nothing pending resolves and writes nothing', async () => {
    const f = join(tmp(), 'openrig.json'); await createCursorWriter({ file: f }).flush(); expect(existsSync(f)).toBe(false);
  });
  it('survives an unwritable path', async () => {
    const w = createCursorWriter({ file: join(tmp(), 'no', 'such', 'dir', 'o.json') }); w.set('local', { lastEventId: 1 }); await expect(w.flush()).resolves.toBeUndefined();
  });
});
