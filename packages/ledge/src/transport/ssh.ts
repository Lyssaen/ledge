import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WebSocket } from 'ws';
import { parseClientMessage, parseServerMessage, SshAliasSchema } from '@ledge/protocol';
import { MAX_FRAME, readFrames } from './frames.js';

/** Only the Ledge application command is exposed. OpenSSH resolves identities and ProxyCommand from user config. */
export function sshArgs(alias: string): string[] {
  SshAliasSchema.parse(alias);
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '--', alias, "bash -lc 'exec ledge bridge'"];
}

export function serveSsh(ws: WebSocket, alias: string, opts: { spawn?: (args: string[]) => ChildProcessWithoutNullStreams; readyMs?: number; env?: NodeJS.ProcessEnv } = {}): void {
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
    const msg = parseServerMessage(raw);
    // The remote daemon's machine list is meaningless to the front (spec §5.2), and an older peer rejects the unknown type (spec §14).
    if (msg.type === 'machines') return;
    if (!ready && msg.type !== 'snapshot') throw new Error('Remote command did not start the Ledge protocol');
    if (msg.type === 'snapshot') { ready = true; clearTimeout(timer); }
    if (ws.bufferedAmount > MAX_FRAME) throw new Error('Ledge connection is overloaded');
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg.type === 'snapshot' ? { ...msg, sshAlias: alias } : msg));
  }, e => stop(`Remote Ledge: ${e.message}`));
  ws.on('message', data => {
    if (stopped) return;
    try {
      if (!ready) throw new Error('Remote Ledge is not ready');
      if (child.stdin.writableLength > MAX_FRAME) throw new Error('SSH connection is overloaded');
      const msg = parseClientMessage(JSON.parse(String(data)));
      // The machines list is private to its host (spec §5.2): never written to the remote daemon; the link stays up.
      if (msg.type === 'machines.set') return;
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    } catch (e) { stop((e as Error).message); }
  });
  ws.on('close', () => stop()); ws.on('error', () => stop());
}
