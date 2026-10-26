import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PREVIEW_MAX } from '@ledge/protocol';
import { AttachmentStore, AttachmentError } from '../src/daemon/attachments.js';

const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const png = (w: number, h: number, pad = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(pad, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const H = 3_600_000;
let dir: string; let store: AttachmentStore;
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'ledge-att-')), 'attachments'); store = new AttachmentStore(dir); });
const reason = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof AttachmentError ? e.reason : 'other'; } return 'none'; };

describe('AttachmentStore', () => {
  it('stores by sha256 and reports the ref', async () => {
    const img = png(1440, 900, 50); const ref = await store.put(img, png(480, 300), 1000);
    expect(ref).toEqual({ id: sha(img), mime: 'image/png', width: 1440, height: 900, bytes: img.length, preview: true });
    expect((await store.put(png(10, 10), undefined, 1000)).preview).toBe(false);
    expect(readdirSync(dir).filter(f => f.startsWith(ref.id)).sort()).toEqual([`${ref.id}.json`, `${ref.id}.png`, `${ref.id}.preview.png`]);
  });

  it('dedupes the same bytes and refreshes the mtime', async () => {
    const img = png(10, 10); const ref = await store.put(img, undefined, 1000);
    const file = join(dir, `${ref.id}.png`); const old = new Date(Date.now() - 20 * H);
    await utimes(file, old, old);
    await store.put(img, undefined, 1000);
    expect(readdirSync(dir)).toHaveLength(2);
    expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(60_000);
  });

  it('refuses oversize, non-images and bad previews', async () => {
    expect(await reason(store.put(png(10, 10, 100), undefined, 10))).toBe('too_large');
    expect(await reason(store.put(Buffer.from('%PDF-1.4'), undefined, 1000))).toBe('not_image');
    expect(await reason(store.put(png(10, 10), png(10, 10, PREVIEW_MAX), 1_000_000))).toBe('too_large');
    expect(await reason(store.put(png(10, 10), Buffer.from('nope'), 1000))).toBe('not_image');
    expect(existsSync(dir)).toBe(false);
  });

  it('answers null for malformed or unknown ids', async () => {
    await store.put(png(10, 10), undefined, 1000);
    for (const id of ['../etc/passwd', 'A'.repeat(64), 'a'.repeat(64)]) {
      expect(store.ref(id)).toBeNull(); expect(store.path(id)).toBeNull(); expect(await store.read(id)).toBeNull();
    }
  });

  it('reads the image and its preview', async () => {
    const img = png(10, 10, 5); const pv = png(5, 5);
    const ref = await store.put(img, pv, 1000); const bare = await store.put(png(20, 20), undefined, 1000);
    expect(await store.read(ref.id)).toEqual({ mime: 'image/png', data: img });
    expect(await store.read(ref.id, true)).toEqual({ mime: 'image/png', data: pv });
    expect(await store.read(bare.id, true)).toBeNull();
    expect(store.path(ref.id)).toBe(join(dir, `${ref.id}.png`));
  });

  it('reloads its index from disk', async () => {
    const ref = await store.put(png(10, 10), png(5, 5), 1000);
    const again = new AttachmentStore(dir); await again.load();
    expect(again.ref(ref.id)).toEqual(ref);
    await new AttachmentStore(join(dir, 'missing')).load();
  });

  it('sweeps unreferenced files after 24 h', async () => {
    const ref = await store.put(png(10, 10), png(5, 5), 1000);
    const at = (h: number) => { const s = new AttachmentStore(dir, () => Date.now() + h * H); return s; };
    const young = at(23); await young.load();
    expect(await young.sweep(new Set())).toEqual([]);
    const old = at(25); await old.load();
    expect(await old.sweep(new Set([ref.id]))).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(3);
    expect(await old.sweep(new Set())).toEqual([ref.id]);
    expect(readdirSync(dir)).toEqual([]);
    expect(old.ref(ref.id)).toBeNull();
  });

  it('survives concurrent puts of the same bytes', async () => {
    const img = png(10, 10, 5); const pv = png(5, 5);
    const refs = await Promise.all([store.put(img, pv, 1000), store.put(img, pv, 1000), store.put(img, pv, 1000)]);
    expect(refs[1]).toEqual(refs[0]); expect(refs[2]).toEqual(refs[0]);
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('sweeps stray files no index entry owns, once old', async () => {
    const ref = await store.put(png(10, 10), undefined, 1000);
    const orphan = `${'b'.repeat(64)}.png`; const tmp = `${'c'.repeat(64)}.png.x.tmp`; const keep = `${'d'.repeat(64)}.png`;
    for (const f of [orphan, tmp, keep]) await writeFile(join(dir, f), 'x');
    const old = new Date(Date.now() - 30 * H);
    for (const f of [orphan, tmp]) await utimes(join(dir, f), old, old);
    expect(await store.sweep(new Set([ref.id, 'd'.repeat(64)]))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([keep, `${ref.id}.json`, `${ref.id}.png`].sort());
  });
});
