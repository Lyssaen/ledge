// The name the phone gives itself in its `pair_commit`: shown on the PC, so a device kind and nothing that identifies it.
// Once linked, the device names itself over the sealed channel only (`device.rename`): its model and its browser.
import { copy } from '../copy';

/** An iPad that says it is a Mac (iPadOS's Safari): a Mac user agent with a touch screen. */
const ipadAsMac = (userAgent: string, touchPoints: number) => /Macintosh/.test(userAgent) && touchPoints > 1;

/**
 * `iPhone`, `iPad`, `Android`, `Android tablette` (an Android whose user agent does not say `Mobile`), or `Téléphone` when
 * the user agent names none of them; always within `PAIR_LABEL_MAX`. The PC reads a tablet from it (`deviceKindOfLabel`).
 */
export function deviceLabel(userAgent: string, touchPoints = 0): string {
  if (/\biPad\b/.test(userAgent) || ipadAsMac(userAgent, touchPoints)) return 'iPad';
  if (/\b(iPhone|iPod)\b/.test(userAgent)) return 'iPhone';
  if (/\bAndroid\b/.test(userAgent)) return /\bMobile\b/.test(userAgent) ? 'Android' : 'Android tablette';
  return copy.compare.deviceLabel;
}

/** The browser a user agent names, the most specific first; null when none is known. */
function browserOf(userAgent: string): string | null {
  if (/\b(EdgiOS|EdgA|Edg)\//.test(userAgent)) return 'Edge';
  if (/\b(FxiOS|Firefox)\//.test(userAgent)) return 'Firefox';
  if (/\bSamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/\b(CriOS|Chrome)\//.test(userAgent)) return 'Chrome';
  if (/\bSafari\//.test(userAgent) || /\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'Safari';
  return null;
}

/** The name a device gives itself once linked, until the user gives it one: `iPad · Safari`, `Android · Chrome`. */
export function defaultDeviceName(userAgent: string, touchPoints = 0): string {
  const model = deviceLabel(userAgent, touchPoints).replace(/ tablette$/, '');
  const browser = browserOf(userAgent);
  return browser ? `${model} · ${browser}` : model;
}
