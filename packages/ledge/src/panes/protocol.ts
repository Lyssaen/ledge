import { createHash, createHmac } from 'node:crypto';
import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Tmux } from '../tmux.js';

/**
 * The pane host's protocol (`ledge panehost`, Windows): one JSON object per line over a local socket. A connection
 * starts with a handshake where each side proves it holds the daemon token without sending it: `hello` (the client's
 * nonce) is answered with the host's nonce and proof, then `auth` carries the client's proof. Every request carries an
 * `id` its response repeats. After an accepted `attach`
 * the connection carries `AttachFrame`s from the host and `{ input }` lines from the client, until `end`.
 */
export const PANEHOST_PROTOCOL = 1;

export type NewSessionOpts = Parameters<Tmux['newSession']>[0];

export type PaneRequest = { id: number } & (
  | { op: 'hello'; protocol: number; nonce: string }
  | { op: 'auth'; proof: string }
  | { op: 'newSession'; opts: NewSessionOpts }
  | { op: 'sendText'; name: string; text: string }
  | { op: 'sendKeys'; name: string; keys: string[] }
  | { op: 'capture'; name: string; lines: number }
  | { op: 'width' | 'hasSession' | 'killSession' | 'exitCode'; name: string }
  | { op: 'listSessions' }
  | { op: 'attach'; name: string; readOnly: boolean }
);

export type PaneResponse = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string };

export type AttachFrame = { attach: 'screen' | 'data'; data: string } | { attach: 'end'; code: number | null };

/** The longest line either side accepts: a capture of the whole scrollback fits well within it. */
const MAX_LINE = 4 * 1024 * 1024;

/** Splits a byte stream into lines, whatever the chunking (a UTF-8 character cut between chunks stays whole). */
export function frameLines(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  return chunk => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); onLine(line); }
    if (buf.length > MAX_LINE) throw new Error('pane host: line too long');
  };
}

/** Where the pane host of a Ledge folder listens. On Windows a named pipe named after the daemon token: a pipe name is
 *  open to every account, and one that could be guessed could be taken first by another; elsewhere a socket inside
 *  the (user-only) Ledge folder. */
export function panehostPath(platform: NodeJS.Platform, ledgeDir: string, token: string): string {
  if (platform === 'win32') return `\\\\.\\pipe\\ledge-panes-${createHash('sha256').update(`ledge-panes:${token}`).digest('hex').slice(0, 32)}`;
  return posix.join(ledgeDir, 'panes.sock');
}

/** What a side sends to prove it holds the token: an HMAC of both nonces, keyed by the token, never the token. */
export function proof(token: string, side: 'host' | 'client', clientNonce: string, hostNonce: string): string {
  return createHmac('sha256', token).update(`ledge-panes/${side}/${clientNonce}/${hostNonce}`).digest('hex');
}
