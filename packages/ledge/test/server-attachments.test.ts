import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
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
