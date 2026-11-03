import { PROTOCOL_PORT } from '@ledge/protocol';

/** The daemon's port: `LEDGE_PORT` when it is a valid port (a second daemon beside the usual one), else the protocol's. */
export function ledgePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LEDGE_PORT;
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : PROTOCOL_PORT;
}
