// The name the phone gives itself in its `pair_commit`: shown on the PC, so a device kind and nothing that identifies it.
import { copy } from '../copy';

/** `iPhone`, `iPad`, `Android`, or `Téléphone` when the user agent names none of them; always within `PAIR_LABEL_MAX`. */
export function deviceLabel(userAgent: string): string {
  if (/\biPad\b/.test(userAgent)) return 'iPad';
  if (/\b(iPhone|iPod)\b/.test(userAgent)) return 'iPhone';
  if (/\bAndroid\b/.test(userAgent)) return 'Android';
  return copy.compare.deviceLabel;
}
