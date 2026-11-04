import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WebSocket } from 'ws';
import { parseClientMessage, parseServerMessage, SshAliasSchema, type ClientMessage, type ServerMessage } from '@ledge/protocol';
import { log as daemonLog } from '../log.js';
import { MAX_FRAME, readFrames } from './frames.js';
import { dropLogger, frameType, unknownRequest } from './unparsed.js';

/** Only the Ledge application command is exposed. OpenSSH resolves identities and ProxyCommand from user config. */
export function sshArgs(alias: string): string[] {
  SshAliasSchema.parse(alias);
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '--', alias, "bash -lc 'exec ledge bridge'"];
}

/** A frame this laptop cannot read is dropped and the link stays up (a front's answered with an `error`), with three exceptions that
 *  still stop it: anything unreadable before the remote's first `snapshot` (the remote command is not Ledge), a malformed `snapshot`,
 *  and the frame-size and overload limits. */
export function serveSsh(ws: WebSocket, alias: string, opts: { spawn?: (args: string[]) => ChildProcessWithoutNullStreams; readyMs?: number; env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {}): void {
  const dropped = dropLogger(opts.log ?? daemonLog, `ssh ${alias}`);
  const child = (opts.spawn ?? (args => spawn('ssh', args, { stdio: 'pipe', env: opts.env })))(sshArgs(alias));
  let stopped = false, ready = false, stderr = '';
  const timer = setTimeout(() => stop('SSH: no Ledge snapshot received. Check the alias and install a compatible Ledge on the server.'), opts.readyMs ?? 60_000);
  let off = () => {};
  function stop(error?: string) {
    if (stopped) return; stopped = true; clearTimeout(timer); off();
    child.stdin.end(); child.kill('SIGTERM');
    if (child.exitCode === null) { const kill = setTimeout(() => child.kill('SIGKILL'), 2000); kill.unref(); child.once('close', () => clearTimeout(kill)); }
    if (error && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: error }));
    if (ws.readyState === WebSocket.OPEN) ws.close(error ? 1011 : 1000);
  }
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
  child.on('error', e => stop(`SSH: ${e.message}`));
  child.on('close', code => stop(`SSH connection closed (${code ?? 'signal'}). ${stderr.trim() || 'Check the alias and remote Ledge installation.'}`));
  child.stdin.on('error', e => stop(`SSH: ${e.message}`));
  off = readFrames(child.stdout, raw => {
    let msg: ServerMessage;
    try { msg = parseServerMessage(raw); }
    catch (e) {
      // Before the snapshot an unreadable frame means the remote command is not Ledge; a snapshot the front cannot read leaves it no state.
      if (!ready || frameType(raw) === 'snapshot') throw e;
      return dropped(frameType(raw), e);
    }
    // The remote daemon's machine list, projects and island settings are meaningless to the front (spec §5.2, build spec §5), and an older peer rejects the unknown type (spec §14).
    if (msg.type === 'machines' || msg.type === 'projects' || msg.type === 'island') return;
    if (!ready && msg.type !== 'snapshot') throw new Error('Remote command did not start the Ledge protocol');
    if (msg.type === 'snapshot') { ready = true; clearTimeout(timer); }
    if (ws.bufferedAmount > MAX_FRAME) throw new Error('Ledge connection is overloaded');
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg.type === 'snapshot' ? { ...msg, sshAlias: alias } : msg));
  }, e => stop(`Remote Ledge: ${e.message}`), { onBadLine: (_line, e) => { if (!ready) throw e; dropped('?', e); } });
  ws.on('message', data => {
    if (stopped) return;
    try {
      if (!ready) throw new Error('Remote Ledge is not ready');
      if (child.stdin.writableLength > MAX_FRAME) throw new Error('SSH connection is overloaded');
      let raw: unknown, msg: ClientMessage;
      try { raw = JSON.parse(String(data)); msg = parseClientMessage(raw); }
      catch (e) {
        // A newer front's message: told at once, by name, and never written to the remote.
        dropped(frameType(raw), e);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(unknownRequest(raw)));
        return;
      }
      // The machines list, the projects and the island settings are private to their host (spec §5.2, build spec §5): never written to the remote daemon; the link stays up.
      if (msg.type === 'machines.set' || msg.type === 'projects.set' || msg.type === 'island.set' || msg.type === 'daemon.stop') return;
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    } catch (e) { stop((e as Error).message); }
  });
  ws.on('close', () => stop()); ws.on('error', () => stop());
}
