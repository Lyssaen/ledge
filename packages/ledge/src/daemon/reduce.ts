import { ATTACHMENT_MAX, CAPTURE_RAW_MAX, IMAGE_LONG_SIDE, PREVIEW_LONG_SIDE, PREVIEW_MAX } from '@ledge/protocol';
import { decode, encode } from 'jpeg-js';
import { PNG } from 'pngjs';
import { imageInfo } from '../imageInfo.js';
import { AttachmentError } from './attachments.js';

/** Decoded pixels above this are refused before decoding: a small PNG can announce a huge canvas. */
const DECODE_MAX_PIXELS = 50_000_000;
const MIN_SIDE = 16;

interface Raster { width: number; height: number; data: Uint8Array }

function decodeRaster(raw: Buffer, mime: string): Raster {
  try {
    if (mime === 'image/png') { const p = PNG.sync.read(raw); return { width: p.width, height: p.height, data: p.data }; }
    const j = decode(raw, { useTArray: true, formatAsRGBA: true });
    return { width: j.width, height: j.height, data: j.data };
  } catch { throw new AttachmentError('not_image'); }
}

/** Area average: each output pixel is the mean of the source pixels it covers (fractional edges weighted), alpha composited on white. Rows are reduced one at a time to keep memory flat on tall pages. */
function resize(src: Raster, width: number, height: number): Raster {
  const { width: sw, height: sh, data } = src;
  const sx = sw / width, sy = sh / height;
  const out = Buffer.alloc(width * height * 4, 255);
  const rowCache = new Map<number, Float32Array>();
  const reduceRow = (y: number): Float32Array => {
    const cached = rowCache.get(y);
    if (cached) return cached;
    const row = new Float32Array(width * 3);
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * sx, x1 = (ox + 1) * sx;
      let r = 0, g = 0, b = 0;
      for (let x = Math.floor(x0); x < Math.min(sw, Math.ceil(x1)); x++) {
        const w = Math.min(x + 1, x1) - Math.max(x, x0);
        const i = (y * sw + x) * 4, a = data[i + 3]! / 255;
        r += w * (data[i]! * a + 255 * (1 - a)); g += w * (data[i + 1]! * a + 255 * (1 - a)); b += w * (data[i + 2]! * a + 255 * (1 - a));
      }
      row[ox * 3] = r / sx; row[ox * 3 + 1] = g / sx; row[ox * 3 + 2] = b / sx;
    }
    rowCache.set(y, row);
    return row;
  };
  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * sy, y1 = (oy + 1) * sy;
    const acc = new Float32Array(width * 3);
    for (let y = Math.floor(y0); y < Math.min(sh, Math.ceil(y1)); y++) {
      const w = Math.min(y + 1, y1) - Math.max(y, y0);
      const row = reduceRow(y);
      for (let k = 0; k < acc.length; k++) acc[k]! += w * row[k]!;
    }
    for (let ox = 0; ox < width; ox++) {
      const o = (oy * width + ox) * 4;
      out[o] = Math.round(acc[ox * 3]! / sy); out[o + 1] = Math.round(acc[ox * 3 + 1]! / sy); out[o + 2] = Math.round(acc[ox * 3 + 2]! / sy);
    }
    for (const k of rowCache.keys()) if (k < Math.floor(y1) - 1) rowCache.delete(k);
  }
  return { width, height, data: out };
}

/** Shrinks to `long` px on the long side, then JPEG-encodes stepping the quality down to `floor`; if still over `max`, shrinks the long side by 0.8 and goes again. */
function toJpeg(src: Raster, long: number, max: number, from: number, floor: number): Buffer {
  let side = Math.min(long, Math.max(src.width, src.height));
  while (side >= MIN_SIDE) {
    const scale = side / Math.max(src.width, src.height);
    const r = scale < 1 ? resize(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale))) : src;
    for (let q = from; q >= floor; q -= 10) {
      const jpg = Buffer.from(encode({ data: r.data, width: r.width, height: r.height }, q).data);
      if (jpg.length <= max) return jpg;
    }
    side = Math.floor(side * 0.8);
  }
  throw new AttachmentError('too_large');
}

/** Turns the raw image of a tool result into what the store keeps: a PNG or JPEG already within limits stays untouched, anything else bigger is re-encoded as JPEG (long side <= 1600, <= 400 kB); a 480 px JPEG preview comes with it. WebP and GIF cannot be decoded here: kept as is when within limits, no preview. */
export function reduceCapture(raw: Buffer): { image: Buffer; preview?: Buffer } {
  if (raw.length > CAPTURE_RAW_MAX) throw new AttachmentError('too_large');
  const info = imageInfo(raw);
  if (!info) throw new AttachmentError('not_image');
  const within = Math.max(info.width, info.height) <= IMAGE_LONG_SIDE && raw.length <= ATTACHMENT_MAX;
  if (info.mime === 'image/webp' || info.mime === 'image/gif') {
    if (!within) throw new AttachmentError('too_large');
    return { image: raw };
  }
  if (info.width * info.height > DECODE_MAX_PIXELS) throw new AttachmentError('too_large');
  const src = decodeRaster(raw, info.mime);
  const image = within ? raw : toJpeg(src, IMAGE_LONG_SIDE, ATTACHMENT_MAX, 85, 45);
  return { image, preview: toJpeg(src, PREVIEW_LONG_SIDE, PREVIEW_MAX, 70, 40) };
}
