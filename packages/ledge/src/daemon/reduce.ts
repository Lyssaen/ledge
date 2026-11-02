import { ATTACHMENT_MAX, CAPTURE_RAW_MAX, IMAGE_LONG_SIDE, PREVIEW_LONG_SIDE, PREVIEW_MAX } from '@ledge/protocol';
import { decode, encode } from 'jpeg-js';
import { PNG } from 'pngjs';
import { imageInfo } from '../imageInfo.js';
import { AttachmentError } from './attachments.js';

/** Decoded pixels above this are refused before decoding: a small PNG can announce a huge canvas. */
const DECODE_MAX_PIXELS = 20_000_000;
const MIN_SIDE = 16;

interface Raster { width: number; height: number; data: Uint8Array }

/** jpeg-js ignores alpha, so transparent pixels must become white before any encode, resized or not. */
function flattenOnWhite(data: Uint8Array): Uint8Array {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((data[i + c]! * a + 255 * (255 - a)) / 255);
    data[i + 3] = 255;
  }
  return data;
}

function decodeRaster(raw: Buffer, mime: string): Raster {
  try {
    if (mime === 'image/png') { const p = PNG.sync.read(raw); return { width: p.width, height: p.height, data: flattenOnWhite(p.data) }; }
    const j = decode(raw, { useTArray: true, formatAsRGBA: true });
    return { width: j.width, height: j.height, data: j.data };
  } catch { throw new AttachmentError('not_image'); }
}

/** Area average: each output pixel is the mean of the source pixels it covers (fractional edges weighted). Rows are reduced one at a time to keep memory flat on tall pages. */
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
        const i = (y * sw + x) * 4;
        r += w * data[i]!; g += w * data[i + 1]!; b += w * data[i + 2]!;
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

/**
 * The size an encode at `q` is expected to have, as a share of one at `from`: jpeg-js measured on screenshots and photo-like
 * pages loses 40-60 % from q85 to q45; this line stays above those curves so a choice made from it errs small.
 */
const qualityShare = (q: number, from: number) => 1 - (from - q) * 0.0115;

/**
 * Shrinks to `long` px on the long side and JPEG-encodes it under `max` bytes in at most 3 encodes (each one costs a pass over
 * the raster): one at `from`; then the quality, and the size if `floor` is not enough, chosen from the byte ratio to land under
 * `max` with a margin; then, if still over, a last one at `floor` shrunk again with a wider margin.
 */
function toJpeg(src: Raster, long: number, max: number, from: number, floor: number): Buffer {
  const srcLong = Math.max(src.width, src.height);
  const encodeAt = (side: number, q: number): Buffer => {
    if (side < MIN_SIDE) throw new AttachmentError('too_large');
    const scale = side / srcLong;
    const r = scale < 1 ? resize(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale))) : src;
    return encode({ data: r.data, width: r.width, height: r.height }, q).data;
  };
  let side = Math.min(long, srcLong);
  let jpg = encodeAt(side, from);
  if (jpg.length <= max) return jpg;
  // Bytes go roughly with the area: what the quality cannot win comes from the side, by the square root.
  const ratio = (max * 0.85) / jpg.length;
  let q = from;
  while (q > floor && qualityShare(q, from) > ratio) q = Math.max(floor, q - 5);
  if (qualityShare(q, from) > ratio) side = Math.floor(side * Math.sqrt(ratio / qualityShare(q, from)));
  jpg = encodeAt(side, q);
  if (jpg.length <= max) return jpg;
  // A smaller raster packs more detail per pixel than the area says: the last step keeps a wide margin.
  jpg = encodeAt(Math.floor(side * Math.sqrt((max * 0.7) / jpg.length)), floor);
  if (jpg.length <= max) return jpg;
  throw new AttachmentError('too_large');
}

/** Turns the raw image of a tool result into what the store keeps: a PNG or JPEG already within limits stays untouched, anything else bigger is re-encoded as JPEG (long side <= 1600, <= 400 kB); a 480 px JPEG preview comes with it. WebP, GIF and what the codecs cannot read are kept as is when within limits, no preview. */
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
  let src: Raster;
  try { src = decodeRaster(raw, info.mime); } catch (e) {
    // What the codec cannot read is kept like a WebP when its header says it is within limits (a JPEG jpeg-js does not handle).
    if (within) return { image: raw };
    throw e;
  }
  const image = within ? raw : toJpeg(src, IMAGE_LONG_SIDE, ATTACHMENT_MAX, 85, 45);
  return { image, preview: toJpeg(src, PREVIEW_LONG_SIDE, PREVIEW_MAX, 70, 40) };
}
