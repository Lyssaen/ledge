import { describe, it, expect } from 'vitest';
import { imageInfo } from '../src/imageInfo.js';

const u16 = (n: number) => Buffer.from([n >> 8, n & 255]);
const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);

const png = (w: number, h: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])]);
const gif = (w: number, h: number) => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8]), Buffer.from([0, 0, 0])]);
const jpeg = (w: number, h: number, sof = 0xc0) => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe0]), u16(16), Buffer.from('JFIF\0'), Buffer.alloc(9),
  Buffer.from([0xff, 0xc4]), u16(4), Buffer.from([0, 0]),
  Buffer.from([0xff, sof]), u16(11), Buffer.from([8]), u16(h), u16(w), Buffer.from([1, 1, 0x11, 0])
]);
const riff = (body: Buffer) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([body.length + 4, 0, 0, 0]), Buffer.from('WEBP'), body]);
const webpLossy = (w: number, h: number) => riff(Buffer.concat([Buffer.from('VP8 '), Buffer.from([10, 0, 0, 0]), Buffer.from([0x10, 0, 0]), Buffer.from([0x9d, 0x01, 0x2a]), Buffer.from([w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f])]));
const webpLossless = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff(Buffer.concat([Buffer.from('VP8L'), Buffer.from([5, 0, 0, 0]), Buffer.from([0x2f]), Buffer.from([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255])]));
};
const webpExt = (w: number, h: number) => riff(Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]), Buffer.alloc(4), le24(w - 1), le24(h - 1)]));

describe('imageInfo', () => {
  it('reads a PNG IHDR', () => { expect(imageInfo(png(1440, 900))).toEqual({ mime: 'image/png', width: 1440, height: 900 }); });
  it('reads a GIF logical screen', () => { expect(imageInfo(gif(1440, 900))).toEqual({ mime: 'image/gif', width: 1440, height: 900 }); });
  it('reads a JPEG SOF0 after an APP0 segment and a DHT', () => { expect(imageInfo(jpeg(1440, 900))).toEqual({ mime: 'image/jpeg', width: 1440, height: 900 }); });
  it('reads a progressive JPEG (SOF2)', () => { expect(imageInfo(jpeg(1440, 900, 0xc2))).toEqual({ mime: 'image/jpeg', width: 1440, height: 900 }); });
  it('reads the three WebP variants', () => {
    for (const b of [webpLossy(1440, 900), webpLossless(1440, 900), webpExt(1440, 900)]) expect(imageInfo(b)).toEqual({ mime: 'image/webp', width: 1440, height: 900 });
  });
  it('returns null for a non-image', () => { expect(imageInfo(Buffer.from('%PDF-1.4'))).toBeNull(); });
  it('returns null for truncated buffers instead of throwing', () => {
    expect(imageInfo(png(1440, 900).subarray(0, 20))).toBeNull();
    expect(imageInfo(jpeg(1440, 900).subarray(0, 30))).toBeNull();
    expect(imageInfo(webpExt(1440, 900).subarray(0, 26))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
  });
});
