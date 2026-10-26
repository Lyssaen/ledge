import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { AttachmentStore } from '../src/daemon/attachments.js';
import { History } from '../src/daemon/history.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const png = (w: number, h: number, pad = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(pad, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const upload = (b: Buffer, preview?: Buffer) => ({ mime: 'image/png' as const, data: b.toString('base64'), ...(preview ? { preview: { mime: 'image/png' as const, data: preview.toString('base64') } } : {}) });

const tmux = { async hasSession() { return false; }, async listSessions() { return []; }, async capture() { return ''; }, async setOption() {}, attachArgs: (n: string) => ['attach', n] } as unknown as Tmux;
let srv: Awaited<ReturnType<typeof startServer>>;
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  srv = await startServer({ store: new Store(), tmux, port: 0, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
});
afterEach(async () => { await srv.close(); });

describe('attachments', () => {
  it('stores an image and serves it back by id', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const img = png(100, 50, 20);
    c.send({ type: 'attachment.put', requestId: 'r1', image: upload(img) });
    const stored = await c.next('attachment.stored');
    expect(stored).toMatchObject({ requestId: 'r1', ref: { id: sha(img), mime: 'image/png', width: 100, height: 50, bytes: img.length, preview: false } });
    c.send({ type: 'attachment.get', requestId: 'r2', attachment: sha(img) });
    const got = await c.next('attachment.data');
    expect(got).toMatchObject({ requestId: 'r2', attachment: sha(img), mime: 'image/png' });
    expect(Buffer.from(got.data, 'base64').equals(img)).toBe(true);
    await c.close();
  });

  it('serves the preview, and refuses one that does not exist', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const img = png(100, 50, 20); const prev = png(48, 24, 5);
    c.send({ type: 'attachment.put', requestId: 'r1', image: upload(img, prev) }); await c.next('attachment.stored');
    c.send({ type: 'attachment.get', requestId: 'r2', attachment: sha(img), preview: true });
    expect(Buffer.from((await c.next('attachment.data')).data, 'base64').equals(prev)).toBe(true);
    const bare = png(10, 10);
    c.send({ type: 'attachment.put', requestId: 'r3', image: upload(bare) }); await c.next('attachment.stored');
    c.send({ type: 'attachment.get', requestId: 'r4', attachment: sha(bare), preview: true });
    expect(await c.next('attachment.error')).toMatchObject({ requestId: 'r4', reason: 'not_found' });
    c.send({ type: 'attachment.get', requestId: 'r5', attachment: 'f'.repeat(64) });
    expect(await c.next('attachment.error')).toMatchObject({ requestId: 'r5', reason: 'not_found' });
    await c.close();
  });

  it('refuses an image over the local limit, bytes that are not an image, and invalid base64', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'attachment.put', requestId: 'big', image: upload(png(100, 50, 2_000_001 - png(100, 50).length)) });
    expect(await c.next('attachment.error')).toMatchObject({ requestId: 'big', reason: 'too_large' });
    c.send({ type: 'attachment.put', requestId: 'txt', image: upload(Buffer.from('hello world, not an image')) });
    expect(await c.next('attachment.error')).toMatchObject({ requestId: 'txt', reason: 'not_image' });
    c.send({ type: 'attachment.put', requestId: 'b64', image: { mime: 'image/png', data: 'not base64 !!' } });
    expect(await c.next('attachment.error')).toMatchObject({ requestId: 'b64', reason: 'unreadable' });
    await c.close();
  });

  it('keeps the images of a chat question on its turn', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot'); await c.next('chat.history');
    const img = png(100, 50, 20);
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Regarde', images: [upload(img)] });
    const h = await c.next('chat.history');
    expect(h.turns[0]).toMatchObject({ qid: 'q1', question: 'Regarde', attachments: [{ id: sha(img), mime: 'image/png' }] });
    await c.next('chat.done', 5000);
    await c.close();
  });

  it('refuses a question with neither text nor images, and an image that is not one', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot'); await c.next('chat.history');
    c.send({ type: 'chat.ask', qid: 'q1', text: '' });
    expect(await c.next('error')).toMatchObject({ request: 'chat.ask', code: 'invalid' });
    c.send({ type: 'chat.ask', qid: 'q2', text: 'x', images: [upload(Buffer.from('not an image at all'))] });
    expect(await c.next('error')).toMatchObject({ request: 'chat.ask', code: 'invalid', message: 'image refused: not_image' });
    c.send({ type: 'snapshot.request' });
    expect((await c.next('chat.history')).turns).toEqual([]);
    await c.close();
  });
});

describe('the sweep', () => {
  it('deletes an old unsent image and keeps the ones a history prompt or a chat turn refers to', async () => {
    await srv.close();
    const root = mkdtempSync(join(tmpdir(), 'ledge-sweep-')); const dir = join(root, 'attachments'); const historyDir = join(root, 'history');
    let clock = Date.now(); const store = new AttachmentStore(dir, () => clock);
    const history = new History({ dir: historyDir });
    srv = await startServer({ store: new Store(), tmux, port: 0, attachments: store, history, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    const c = await connect({ port: srv.port }); await c.next('snapshot'); await c.next('chat.history');
    const [unsent, inHistory, inChat] = [png(10, 10, 1), png(10, 10, 2), png(10, 10, 3)];
    c.send({ type: 'attachment.put', requestId: 'u', image: upload(unsent) }); await c.next('attachment.stored');
    c.send({ type: 'attachment.put', requestId: 'h', image: upload(inHistory) }); await c.next('attachment.stored');
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Regarde', images: [upload(inChat)] }); await c.next('chat.done', 5000);
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(join(historyDir, 's.jsonl'), JSON.stringify({ kind: 'prompt', id: 'prompt-1', at: '2026-10-13T10:00:00.000Z', turn: 1, text: 'x', images: [{ id: sha(inHistory), mime: 'image/png', width: 10, height: 10, bytes: inHistory.length, preview: false }] }) + '\n');
    const files = (b: Buffer) => join(dir, `${sha(b)}.png`);
    await srv.sweepAttachments();
    expect([unsent, inHistory, inChat].map(b => existsSync(files(b)))).toEqual([true, true, true]); // still fresh
    clock += 25 * 3_600_000;
    await srv.sweepAttachments();
    expect([unsent, inHistory, inChat].map(b => existsSync(files(b)))).toEqual([false, true, true]);
    await c.close();
  });
});
