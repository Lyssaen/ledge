import { generateKeyPairSync } from 'node:crypto';

/** A new VAPID key pair, derived as `scripts/vapid-keys.mjs` does: the public key is the uncompressed P-256 point, base64url. */
export function generateVapid(subject: string): { publicKey: string; privateKey: string; subject: string } {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x as string, 'base64url'), Buffer.from(jwk.y as string, 'base64url')]);
  return { publicKey: point.toString('base64url'), privateKey: jwk.d as string, subject };
}
