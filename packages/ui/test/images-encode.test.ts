import { describe, it, expect } from 'vitest';
import { encodeImage, formatBytes, setCodecForTests, type Codec } from '../src/images/encode';

type Encode = { mime: string; q: number };
/** A codec that records every draw and encode; `size(w, mime, q)` is the produced blob's byte length. */
function fakeCodec(opts: { w?: number; h?: number; size?: (w: number, q: number) => number; type?: (asked: string) => string; decodeThrows?: boolean; previewThrows?: boolean } = {}) {
  const closed = { n: 0 };
  const draws: Array<[number, number]> = [];
  const encodes: Array<Encode & { w: number }> = [];
  const codec: Codec = {
    async decode() {
      if (opts.decodeThrows) throw new Error('bad');
      return {
        close: () => { closed.n++; },
        width: opts.w ?? 3000, height: opts.h ?? 2000,
        async draw(w, h) {
          draws.push([w, h]);
          return { async encode(mime, q) { if (opts.previewThrows && w <= 480) throw new Error('boom'); encodes.push({ mime, q, w }); return new Blob([new Uint8Array((opts.size ?? (() => 1000))(w, q))], { type: opts.type?.(mime) ?? mime }); } };
        }
      };
    }
  };
  return { codec, draws, encodes, closed };
}
const png = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/png' });

describe('encodeImage', () => {
  it('draws a 3000×2000 input at 1600×1067 and encodes WebP q 0.85', async () => {
    const f = fakeCodec();
    const r = await encodeImage(png(), f.codec);
    expect(r.ok).toBe(true);
    expect(f.draws[0]).toEqual([1600, 1067]);
    expect(f.encodes[0]).toMatchObject({ mime: 'image/webp', q: 0.85 });
    if (r.ok) expect(r.value).toMatchObject({ width: 1600, height: 1067, bytes: 1000, image: { mime: 'image/webp' } });
  });
  it('reports JPEG when the codec returns a JPEG blob for WebP', async () => {
    const f = fakeCodec({ type: () => 'image/jpeg' });
    const r = await encodeImage(png(), f.codec);
    expect(r.ok && r.value.image.mime).toBe('image/jpeg');
  });
  it('steps the quality 0.85 → 0.7 → 0.55 when the first two encodes are too big', async () => {
    const f = fakeCodec({ size: (_w, q) => (q > 0.6 ? 500_000 : 300_000) });
    const r = await encodeImage(png(), f.codec);
    expect(f.encodes.slice(0, 3).map(e => e.q)).toEqual([0.85, 0.7, 0.55]);
    expect(r.ok && r.value.bytes).toBe(300_000);
  });
  it('lowers the long side ×0.8 down to 640 once 0.4 is not enough, then gives up', async () => {
    const f = fakeCodec({ size: () => 500_000 });
    const r = await encodeImage(png(), f.codec);
    expect(r).toEqual({ ok: false, reason: 'tooLarge' });
    expect(f.draws.map(d => Math.max(...d))).toEqual([1600, 1280, 1024, 819, 655, 640]);
    expect(f.encodes.filter(e => e.w === 1600).map(e => e.q)).toEqual([0.85, 0.7, 0.55, 0.4]);
  });
  it('shrinks until it fits', async () => {
    const f = fakeCodec({ size: w => (w > 1100 ? 500_000 : 100_000) });
    const r = await encodeImage(png(), f.codec);
    expect(r.ok && r.value.width).toBe(1024);
  });
  it('makes a 480 px preview at q 0.7', async () => {
    const f = fakeCodec();
    const r = await encodeImage(png(), f.codec);
    expect(f.draws[1]).toEqual([480, 320]);
    expect(f.encodes[1]).toMatchObject({ q: 0.7 });
    expect(r.ok && r.value.image.preview?.mime).toBe('image/webp');
  });
  it('retries the preview at q 0.5 and omits it when still over 40 000 bytes', async () => {
    const f = fakeCodec({ size: w => (w === 480 ? 50_000 : 1000) });
    const r = await encodeImage(png(), f.codec);
    expect(f.encodes.filter(e => e.w === 480).map(e => e.q)).toEqual([0.7, 0.5]);
    expect(r.ok && r.value.image.preview).toBeUndefined();
  });
  it('keeps the image when only the preview fails', async () => {
    const r = await encodeImage(png(), fakeCodec({ previewThrows: true }).codec);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.image.preview).toBeUndefined();
  });
  it('releases the decoded picture on success and on tooLarge', async () => {
    const ok = fakeCodec(); await encodeImage(png(), ok.codec);
    const big = fakeCodec({ size: () => 500_000 }); await encodeImage(png(), big.codec);
    expect([ok.closed.n, big.closed.n]).toEqual([1, 1]);
  });
  it('refuses a non-image without decoding', async () => {
    const f = fakeCodec();
    expect(await encodeImage(new Blob(['x'], { type: 'text/plain' }), f.codec)).toEqual({ ok: false, reason: 'notImage' });
    expect(f.draws).toEqual([]);
  });
  it('reports unreadable when decoding throws', async () => {
    expect(await encodeImage(png(), fakeCodec({ decodeThrows: true }).codec)).toEqual({ ok: false, reason: 'unreadable' });
  });
  it('refuses an input over 25 000 000 bytes without decoding', async () => {
    const f = fakeCodec();
    expect(await encodeImage(png(25_000_001), f.codec)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(f.draws).toEqual([]);
  });
  it('uses the test codec when none is given', async () => {
    setCodecForTests(fakeCodec().codec);
    try { expect((await encodeImage(png())).ok).toBe(true); } finally { setCodecForTests(null); }
  });
});

describe('formatBytes', () => {
  it('formats in Ko / KB, and Mo / MB with one decimal from a million', () => {
    expect(formatBytes(212_345, 'fr')).toBe('212 Ko');
    expect(formatBytes(212_345, 'en')).toBe('212 KB');
    expect(formatBytes(1_400_000, 'fr')).toBe('1,4 Mo');
    expect(formatBytes(1_400_000, 'en')).toBe('1.4 MB');
  });
});
