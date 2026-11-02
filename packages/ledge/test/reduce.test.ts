import { ATTACHMENT_MAX, CAPTURE_RAW_MAX, PREVIEW_MAX } from '@ledge/protocol';
import { decode, encode } from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { reduceCapture } from '../src/daemon/reduce.js';
import { imageInfo } from '../src/imageInfo.js';

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
  it('refuses what is not an image, and what is over CAPTURE_RAW_MAX', () => {
    expect(() => reduceCapture(Buffer.from('nope'))).toThrow(expect.objectContaining({ reason: 'not_image' }));
    expect(() => reduceCapture(Buffer.alloc(CAPTURE_RAW_MAX + 1))).toThrow(expect.objectContaining({ reason: 'too_large' }));
  });
});
