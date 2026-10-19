import type { RelayServerMessage } from '@ledge/protocol';

/** Structured events. No free-text field: an event cannot carry content. */
export type RelayLogEvent =
  | { ev: 'connect'; account: string; peer: string }
  | { ev: 'disconnect'; account: string; peer: string; code: number; ms: number; framesIn: number; framesOut: number; bytesIn: number; bytesOut: number }
  | { ev: 'refused'; reason: 'no_auth' | 'bad_path' | 'auth_error' }
  | { ev: 'frame_error'; account: string; peer: string; code: Extract<RelayServerMessage, { type: 'error' }>['code'] };

export type RelayLog = (e: RelayLogEvent) => void;

export const jsonLog: RelayLog = (e) => {
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
};
