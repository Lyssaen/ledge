// Prints the three LEDGE_RELAY_VAPID_* lines for a new VAPID key pair: node scripts/vapid-keys.mjs you@example.com
import { generateKeyPairSync } from 'node:crypto';

const contact = process.argv[2];
if (!contact) {
  process.stderr.write('usage: node scripts/vapid-keys.mjs <contact email>\n');
  process.exit(1);
}
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
process.stdout.write(`LEDGE_RELAY_VAPID_PUBLIC_KEY=${point.toString('base64url')}\n`);
process.stdout.write(`LEDGE_RELAY_VAPID_PRIVATE_KEY=${jwk.d}\n`);
process.stdout.write(`LEDGE_RELAY_VAPID_SUBJECT=mailto:${contact}\n`);
