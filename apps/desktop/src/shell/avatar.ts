import { useSyncExternalStore } from 'react';

const KEY = 'desktop.avatar';
/** The stored side, in px: the thread's disc is 28 px, the Settings preview 56 px, both sharp at 2× and more. */
export const AVATAR_PX = 128;
/** The heaviest picture Desktop reads; only its 128 px square is kept. */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export type AvatarRefusal = 'notImage' | 'tooLarge' | 'unreadable';

const valid = (v: string | null): string | null => (v && /^data:image\/(png|webp|jpeg);base64,/.test(v) ? v : null);
function loadAvatar(): string | null {
  try { return valid(localStorage.getItem(KEY)); } catch { return null; }
}

// The profile photo (#50): a Desktop preference like the theme, kept in `desktop.avatar` as a small data URL. It never goes
// through the daemon, so no machine receives it.
let avatar = loadAvatar();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** `null` removes the photo (the user icon comes back); anything but an image data URL is ignored. */
export function setAvatar(url: string | null): void {
  if (url !== null && valid(url) === null) return;
  avatar = url;
  try {
    if (url === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, url);
  } catch { /* storage unavailable: the in-memory value still applies */ }
  listeners.forEach(l => l());
}

/** The profile photo as a data URL, null without one. */
export function useAvatar(): string | null { return useSyncExternalStore(subscribe, () => avatar, () => avatar); }

/** The centre square of a w × h picture. */
export function squareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size };
}

/** Decodes the picture, crops its centre square and draws it at AVATAR_PX: WebP, or PNG where the WebView cannot encode WebP. */
export async function squareAvatar(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_PX;
    const g = canvas.getContext('2d');
    if (!g || size === 0) throw new Error('no canvas');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX);
    return canvas.toDataURL('image/webp', 0.9);
  } finally { bitmap.close(); }
}

let shrinkOverride: ((file: Blob) => Promise<string>) | null = null;
/** Test hook: jsdom decodes no picture, the Settings tests stand in for squareAvatar; null restores it. */
export function setAvatarShrinkForTests(fn: ((file: Blob) => Promise<string>) | null): void { shrinkOverride = fn; }

/** Checks then shrinks a chosen file: neither an image nor too heavy is read at all. */
export async function prepareAvatar(file: File, shrink: (file: Blob) => Promise<string> = shrinkOverride ?? squareAvatar): Promise<{ ok: true; url: string } | { ok: false; reason: AvatarRefusal }> {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'notImage' };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, reason: 'tooLarge' };
  try {
    const url = valid(await shrink(file));
    return url ? { ok: true, url } : { ok: false, reason: 'unreadable' };
  } catch { return { ok: false, reason: 'unreadable' }; }
}

/** Test hook: the next read reloads from storage. */
export function resetAvatarForTests(): void { avatar = loadAvatar(); listeners.forEach(l => l()); }
