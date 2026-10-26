import type { ImageMime } from '@ledge/protocol';

export interface ImageInfo { mime: ImageMime; width: number; height: number }

const ok = (mime: ImageMime, width: number, height: number): ImageInfo | null => (width > 0 && height > 0 ? { mime, width, height } : null);

function jpeg(b: Buffer): ImageInfo | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return i + 9 <= b.length ? ok('image/jpeg', b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)) : null;
    i += 2 + len;
  }
  return null;
}

function webp(b: Buffer): ImageInfo | null {
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8X') return b.length >= 30 ? ok('image/webp', b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1) : null;
  if (kind === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return ok('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (kind === 'VP8 ') return b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? ok('image/webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff) : null;
  return null;
}

/** Sniffs a PNG, GIF, JPEG or WebP from its magic bytes and reads its pixel size; null for anything else, truncated included. Never throws. */
export function imageInfo(b: Buffer): ImageInfo | null {
  try {
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') return ok('image/png', b.readUInt32BE(16), b.readUInt32BE(20));
    if (b.length >= 10 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) return ok('image/gif', b.readUInt16LE(6), b.readUInt16LE(8));
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    if (b.length >= 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webp(b);
  } catch { /* out-of-range read: treat as not an image */ }
  return null;
}
