// Every phone message is padded to a size tier before sealing, so the relay sees a tier and not an exact length.
import { PAD_TIERS, PLAIN_MAX } from '@ledge/protocol';

/** Trailing spaces up to the smallest tier >= the UTF-8 size of `json`; null past `PLAIN_MAX`. `JSON.parse` ignores the spaces. */
export function pad(json: string): string | null {
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > PLAIN_MAX) return null;
  const tier = PAD_TIERS.find((t) => t >= bytes);
  if (tier === undefined) return null;
  return json + ' '.repeat(tier - bytes);
}
