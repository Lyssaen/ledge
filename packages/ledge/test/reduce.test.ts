import { ATTACHMENT_MAX, CAPTURE_RAW_MAX, PREVIEW_MAX } from '@ledge/protocol';
import { decode, encode } from 'jpeg-js';
import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reduceCapture } from '../src/daemon/reduce.js';
import { imageInfo } from '../src/imageInfo.js';

// Counts the reducer's JPEG encodes (the fixtures below encode through it too: reset before each reduction).
const encodes = vi.hoisted(() => ({ n: 0 }));
vi.mock('jpeg-js', async orig => {
  const m = await orig<typeof import('jpeg-js')>();
  return { ...m, encode: (...a: Parameters<typeof m.encode>) => { encodes.n++; return m.encode(...a); } };
});
beforeEach(() => { encodes.n = 0; });

const le24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
const webpExt = (w: number, h: number) => {
  const body = Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]), Buffer.alloc(4), le24(w - 1), le24(h - 1)]);
  return Buffer.concat([Buffer.from('RIFF'), Buffer.from([body.length + 4, 0, 0, 0]), Buffer.from('WEBP'), body]);
};

/** A deterministic PNG: 'flat' compresses to almost nothing, 'noise' stays big like a busy page. */
function png(w: number, h: number, fill: 'flat' | 'noise', alpha = 255): Buffer {
  const p = new PNG({ width: w, height: h });
  const grain = new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4));
  let s = 12345;
  for (let i = 0; i < grain.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; grain[i] = (s >>> 24) % 64; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 'noise' is a gradient with a 4 px grain: per-pixel randomness would never fit the raw limit, real pages do.
      const v = fill === 'noise' ? (((x * 192) / w + grain[(y >> 2) * Math.ceil(w / 4) + (x >> 2)]!) & 255) : 0x80;
      p.data.set([v, v, v, alpha], (y * w + x) * 4);
    }
  }
  return PNG.sync.write(p);
}

/** A photo-like PNG (gradients plus a per-pixel binary grain, ~1.9 MB at 1440 x 900): the grain stays over ATTACHMENT_MAX even at the floor quality, full size. */
function photo(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  let s = 7;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0; const n = ((s >>> 24) & 1) * 40; const i = (y * w + x) * 4;
    p.data[i] = ((x * 255) / w + n) & 255; p.data[i + 1] = ((y * 255) / h + n) & 255; p.data[i + 2] = (128 + Math.sin(x / 37 + y / 23) * 60 + n) & 255; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}
const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
/** A PNG header announcing w x h, with a body no decoder can read. */
const pngHeader = (w: number, h: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(64, 7)]);
/** A JPEG whose SOF0 announces w x h, followed by garbage. */
const jpegHeader = (w: number, h: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3]), Buffer.alloc(64, 7)]);

// Pure-JS codecs on multi-megapixel fixtures: slow under a parallel full run, so a roomy timeout.
describe('reduceCapture', { timeout: 30_000 }, () => {
  it('keeps a small PNG as is and makes a preview', () => {
    const raw = png(1280, 800, 'flat');
    const out = reduceCapture(raw);
    expect(out.image).toBe(raw);
    expect(imageInfo(out.preview!)).toMatchObject({ mime: 'image/jpeg', width: 480, height: 300 });
    expect(out.preview!.length).toBeLessThanOrEqual(PREVIEW_MAX);
  });
  it('re-encodes a large PNG under both limits', () => {
    const out = reduceCapture(png(2560, 1600, 'noise'));
    expect(imageInfo(out.image)).toMatchObject({ mime: 'image/jpeg', width: 1600, height: 1000 });
    expect(out.image.length).toBeLessThanOrEqual(ATTACHMENT_MAX);
    expect(out.preview!.length).toBeLessThanOrEqual(PREVIEW_MAX);
  });
  it('reduces a full-page capture by its long side', () => {
    expect(imageInfo(reduceCapture(png(1280, 6400, 'noise')).image)).toMatchObject({ width: 320, height: 1600 });
  });
  it('keeps a small JPEG as is', () => {
    const raw = Buffer.from(encode({ data: Buffer.alloc(800 * 600 * 4, 200), width: 800, height: 600 }, 80).data);
    expect(reduceCapture(raw).image).toBe(raw);
  });
  it('composites alpha on white', () => {
    const jpg = reduceCapture(png(2000, 400, 'flat', 0)).image;
    const px = decode(jpg, { useTArray: true });
    expect(imageInfo(jpg)).toMatchObject({ width: 1600, height: 320 });
    expect(px.data[0]).toBeGreaterThan(245);
    expect(px.data[1]).toBeGreaterThan(245);
  });
  it('composites alpha on white without downscaling too', () => {
    const px = decode(reduceCapture(png(300, 200, 'flat', 0)).preview!, { useTArray: true });
    expect(px.data[0]).toBeGreaterThan(245);
    expect(px.data[1]).toBeGreaterThan(245);
    expect(px.data[2]).toBeGreaterThan(245);
  });
  it('averages the covered pixels', () => {
    const p = new PNG({ width: 3200, height: 2 });
    for (let i = 0; i < p.width * 2; i++) { const v = (i % 2) * 255; p.data.set([v, v, v, 255], i * 4); }
    const px = decode(reduceCapture(PNG.sync.write(p)).image, { useTArray: true });
    expect(Math.abs(px.data[0]! - 128)).toBeLessThan(6);
  });
  it('keeps a small WebP without preview, refuses a large one', () => {
    expect(reduceCapture(webpExt(1440, 900)).preview).toBeUndefined();
    expect(() => reduceCapture(webpExt(4000, 3000))).toThrow(expect.objectContaining({ reason: 'too_large' }));
  });
  it('encodes at most 3 times per output, and lands under both limits', () => {
    const raw = photo(1440, 900);
    expect(raw.length).toBeLessThanOrEqual(CAPTURE_RAW_MAX);
    encodes.n = 0;
    const out = reduceCapture(raw);
    expect(encodes.n).toBeLessThanOrEqual(6);
    expect(imageInfo(out.image)!.mime).toBe('image/jpeg');
    expect(Math.max(imageInfo(out.image)!.width, imageInfo(out.image)!.height)).toBeLessThanOrEqual(1600);
    expect(out.image.length).toBeLessThanOrEqual(ATTACHMENT_MAX);
    expect(Math.max(imageInfo(out.preview!)!.width, imageInfo(out.preview!)!.height)).toBeLessThanOrEqual(480);
    expect(out.preview!.length).toBeLessThanOrEqual(PREVIEW_MAX);
  });
  it('keeps an undecodable PNG or JPEG already within limits, without preview; refuses one that is not', () => {
    for (const raw of [pngHeader(800, 600), jpegHeader(800, 600)]) {
      const out = reduceCapture(raw);
      expect(out.image).toBe(raw);
      expect(out.preview).toBeUndefined();
    }
    expect(() => reduceCapture(pngHeader(3000, 2000))).toThrow(expect.objectContaining({ reason: 'not_image' }));
  });
  it('refuses to decode more than 20 megapixels', () => {
    expect(() => reduceCapture(pngHeader(5000, 4500))).toThrow(expect.objectContaining({ reason: 'too_large' }));
  });
  it('refuses what is not an image, and what is over CAPTURE_RAW_MAX', () => {
    expect(() => reduceCapture(Buffer.from('nope'))).toThrow(expect.objectContaining({ reason: 'not_image' }));
    expect(() => reduceCapture(Buffer.alloc(CAPTURE_RAW_MAX + 1))).toThrow(expect.objectContaining({ reason: 'too_large' }));
  });
});
