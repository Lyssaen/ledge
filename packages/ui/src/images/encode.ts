import { ATTACHMENT_MAX, IMAGE_LONG_SIDE, PREVIEW_LONG_SIDE, PREVIEW_MAX, type ImageUpload } from '@ledge/protocol';

export type EncodeFailure = 'notImage' | 'tooLarge' | 'unreadable';
export interface Encoded { image: ImageUpload; width: number; height: number; bytes: number }

/** The picture side of the encoder: decode a file, draw it at a size, encode that drawing. */
export interface Codec {
  decode(b: Blob): Promise<{
    width: number; height: number;
    draw(w: number, h: number): Promise<{ encode(mime: 'image/webp' | 'image/jpeg', q: number): Promise<Blob> }>;
    /** Releases the decoded picture. */
    close?(): void;
  }>;
}

const INPUT_TYPES = ['image/png', 'image/gif', 'image/jpeg', 'image/webp'];
/** Larger inputs are refused unread: decoding them would cost more memory than any phone gives a tab. */
const INPUT_MAX = 25_000_000;
const QUALITIES = [0.85, 0.7, 0.55, 0.4];
const MIN_LONG_SIDE = 640;
const SHRINK = 0.8;
const PREVIEW_QUALITIES = [0.7, 0.5];

/** The WebView's own decoder and canvas, like the avatar's (apps/desktop/src/shell/avatar.ts). */
const canvasCodec: Codec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    // iOS Safari caps the memory of all canvases: only the latest one stays sized.
    let last: HTMLCanvasElement | null = null;
    const release = () => { if (last) last.width = last.height = 0; last = null; };
    return {
      width: bitmap.width, height: bitmap.height,
      close: () => { release(); bitmap.close(); },
      async draw(w, h) {
        release();
        const canvas = last = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const g = canvas.getContext('2d');
        if (!g) throw new Error('no canvas');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, w, h);
        return { encode: (mime, q) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no blob'))), mime, q)) };
      }
    };
  }
};

let codecOverride: Codec | null = null;
/** Test hook: jsdom decodes no picture; null restores the canvas codec. */
export function setCodecForTests(c: Codec | null): void { codecOverride = c; }

const fit = (w: number, h: number, long: number): { w: number; h: number } => {
  const scale = Math.min(1, long / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
};

type Drawing = { encode(mime: 'image/webp' | 'image/jpeg', q: number): Promise<Blob> };
/** WebP, or JPEG where the engine cannot encode WebP (it then hands back a PNG, or a JPEG itself). */
async function encodeOnce(drawing: Drawing, q: number): Promise<{ blob: Blob; mime: 'image/webp' | 'image/jpeg' }> {
  let blob = await drawing.encode('image/webp', q);
  if (blob.type === 'image/webp' || blob.type === 'image/jpeg') return { blob, mime: blob.type };
  blob = await drawing.encode('image/jpeg', q);
  return { blob, mime: 'image/jpeg' };
}

const toBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Shrinks and re-encodes a picked, pasted or dropped file to fit the daemon, the phone relay and the agents: long side ≤ 1600 px,
 *  ≤ ATTACHMENT_MAX bytes (lower quality first, then a smaller size), plus a small preview when one fits PREVIEW_MAX. */
export async function encodeImage(file: Blob, codec: Codec = codecOverride ?? canvasCodec): Promise<{ ok: true; value: Encoded } | { ok: false; reason: EncodeFailure }> {
  if (!INPUT_TYPES.includes(file.type)) return { ok: false, reason: 'notImage' };
  if (file.size > INPUT_MAX) return { ok: false, reason: 'tooLarge' };
  let source: Awaited<ReturnType<Codec['decode']>>;
  try { source = await codec.decode(file); } catch { return { ok: false, reason: 'unreadable' }; }
  try {
    let long = Math.min(IMAGE_LONG_SIDE, Math.max(source.width, source.height));
    for (;;) {
      const { w, h } = fit(source.width, source.height, long);
      const drawing = await source.draw(w, h);
      for (const q of QUALITIES) {
        const { blob, mime } = await encodeOnce(drawing, q);
        if (blob.size > ATTACHMENT_MAX) continue;
        const image: ImageUpload = { mime, data: await toBase64(blob) };
        const preview = await makePreview(source);
        if (preview) image.preview = preview;
        return { ok: true, value: { image, width: w, height: h, bytes: blob.size } };
      }
      if (long <= MIN_LONG_SIDE) return { ok: false, reason: 'tooLarge' };
      long = Math.max(MIN_LONG_SIDE, Math.round(long * SHRINK));
    }
  } catch { return { ok: false, reason: 'unreadable' }; }
  finally { source.close?.(); }
}

/** A preview that cannot be made is no reason to lose the image: none is sent, the phone then shows its « trop lourde » note. */
async function makePreview(source: Awaited<ReturnType<Codec['decode']>>): Promise<ImageUpload['preview']> {
  try { return await drawPreview(source); } catch { return undefined; }
}

async function drawPreview(source: Awaited<ReturnType<Codec['decode']>>): Promise<ImageUpload['preview']> {
  const { w, h } = fit(source.width, source.height, PREVIEW_LONG_SIDE);
  const drawing = await source.draw(w, h);
  for (const q of PREVIEW_QUALITIES) {
    const { blob, mime } = await encodeOnce(drawing, q);
    if (blob.size <= PREVIEW_MAX) return { mime, data: await toBase64(blob) };
  }
  return undefined;
}

/** `212 Ko` / `212 KB`; from a million bytes one decimal, `1,4 Mo` / `1.4 MB`. */
export function formatBytes(n: number, lang: 'fr' | 'en'): string {
  if (n >= 1_000_000) {
    const v = (Math.round(n / 100_000) / 10).toFixed(1);
    return `${lang === 'fr' ? v.replace('.', ',') : v} ${lang === 'fr' ? 'Mo' : 'MB'}`;
  }
  return `${Math.round(n / 1000)} ${lang === 'fr' ? 'Ko' : 'KB'}`;
}
