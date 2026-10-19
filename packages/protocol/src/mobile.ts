import { z } from 'zod';

/** The relay the daemon and the overlay use until the user picks another one. */
export const DEFAULT_RELAY_URL = 'https://server.ledge.paradow.dev';

/** A relay URL reduced to its origin: https, or http for localhost and 127.0.0.1 only; no path, query or fragment. */
export const RelayUrlSchema = z.string().transform((v, ctx) => {
  const bad = (): never => { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid relay URL' }); return z.NEVER; };
  let u: URL;
  try { u = new URL(v.replace(/\/$/, '')); } catch { return bad(); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return bad();
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return bad();
  return u.origin;
});

/** Mobile access settings kept in mobile.json. */
export const MobileConfigSchema = z.object({ enabled: z.boolean(), relayUrl: RelayUrlSchema });
export type MobileConfig = z.infer<typeof MobileConfigSchema>;
