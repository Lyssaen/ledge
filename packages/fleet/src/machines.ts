import { MachinesSchema, type Machine } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';
import { parseServerMessage, type ClientMessage, type DaemonInfo, type Recent, type Session, type ServerMessage } from '@ledge/protocol';
import { useSyncExternalStore } from 'react';

/** The url exists for `local` only: set by the fleet, never persisted nor sent. */
export type MachineConfig = Machine & { url?: string };
export interface MachineState extends MachineConfig { status: DaemonStatus; ready: boolean; recents: Recent[]; sessions: Session[]; launcher: string[] | null; version?: string; daemon?: DaemonInfo; error?: string }
/** A one-off connection test: the remote Ledge answered with its snapshot, or the raw error SSH or the daemon gave. */
export type ProbeResult = { ok: true; version?: string; sessions: number } | { ok: false; error: string };
export interface Fleet {
  primary: DaemonClient;
  subscribe(fn: () => void): () => void;
  machines(): MachineState[];
  selected(): string;
  select(id: string): void;
  configure(config: MachineConfig[]): void;
  /** Where the machine list comes from: the local daemon once it has sent one (`machinesFromDaemon`), else localStorage. */
  machinesSource(): 'daemon' | 'local';
  /** Tests an SSH alias over its own connection, without touching the configured machines. */
  probe(ssh: string): Promise<ProbeResult>;
  /** Reconnects a machine now instead of waiting for the next backoff. */
  retry(id: string): void;
  terminal(id: string): string[] | null;
  turnMachine(qid: string): MachineState | undefined;
  documentMachine(id: string): string | undefined;
  localSnapshot(): Extract<ServerMessage, { type: 'snapshot' }> | null;
  /** Sends to one machine; false when it is not connected (nothing sent). */
  sendTo(machine: string, msg: ClientMessage): boolean;
  /** Every daemon message, unqualified, with the machine it came from. */
  onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void;
}
export const LOCAL_MACHINE: MachineConfig = { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' };
/** The shared list rules live in the protocol; the fleet only pins the local URL (spec §5.1). */
export function parseMachines(raw: unknown): MachineConfig[] {
  const list = MachinesSchema.parse(Array.isArray(raw) ? raw.map(m => { const { url: _url, ...rest } = (m ?? {}) as Record<string, unknown>; return rest; }) : raw);
  return list.map((m, i) => i === 0 ? { ...m, url: LOCAL_MACHINE.url } : m);
}
export function machineUrl(machine: MachineConfig, local: MachineConfig): string {
  if (!machine.ssh) return local.url!;
  const url = new URL(local.url!);
  if (machine.ssh) url.pathname = `/ssh/${machine.ssh}`;
  return url.toString();
}
export function loadMachines(prefix = 'ledge'): MachineConfig[] {
  try { return parseMachines(JSON.parse(localStorage.getItem(`${prefix}.machines`) ?? 'null')); } catch { return [LOCAL_MACHINE]; }
}
type ProbeSocket = { close(): void; onclose: null | (() => void); onerror: null | (() => void); onmessage: null | ((ev: { data: unknown }) => void) };
/** Opens `/ssh/<alias>` on the local daemon once and settles on the first snapshot, error or close. */
export function probeMachine(url: string, ssh: string, opts: { WebSocketImpl?: new (url: string) => ProbeSocket; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const Ws = opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (url: string) => ProbeSocket }).WebSocket;
  return new Promise(resolve => {
    let sock: ProbeSocket, error = '', done = false;
    const finish = (r: ProbeResult) => { if (done) return; done = true; clearTimeout(timer); if (sock) { sock.onclose = sock.onmessage = sock.onerror = null; sock.close(); } resolve(r); };
    // The daemon gives up on a silent remote after 60 s; this only guards against a daemon that never answers.
    const timer = setTimeout(() => finish({ ok: false, error: 'SSH: no Ledge snapshot received.' }), opts.timeoutMs ?? 75_000);
    try { sock = new Ws(machineUrl({ id: 'probe', label: ssh, ssh }, { ...LOCAL_MACHINE, url })); } catch (e) { finish({ ok: false, error: (e as Error).message }); return; }
    sock.onmessage = ev => {
      let m: ServerMessage; try { m = parseServerMessage(JSON.parse(String(ev.data))); } catch { return; }
      if (m.type === 'error') error = m.message;
      else if (m.type === 'snapshot') finish(m.sshAlias === ssh ? { ok: true, version: m.daemon?.version, sessions: m.sessions.length } : { ok: false, error: 'Update the local Ledge daemon: SSH transport is unavailable' });
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => finish({ ok: false, error: error || 'The local Ledge daemon closed the connection.' });
  });
}
export type SshProblem = 'alias' | 'key' | 'hostKey' | 'unreachable' | 'ledge' | 'stopped' | 'local' | 'other';
/** The usual cause behind a raw SSH or remote Ledge error, to explain it in plain words. */
export function sshProblem(raw: string): SshProblem {
  if (/Update the local Ledge daemon/i.test(raw)) return 'local';
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(raw)) return 'alias';
  if (/Host key verification failed|HOST IDENTIFICATION HAS CHANGED|No (?:ED25519|RSA|ECDSA)? ?host key is known/i.test(raw)) return 'hostKey';
  if (/Permission denied|Too many authentication failures/i.test(raw)) return 'key';
  if (/ECONNREFUSED|Ledge daemon disconnected/i.test(raw)) return 'stopped';
  if (/unknown command|command not found|did not start the Ledge protocol|no Ledge snapshot|ledge: not found/i.test(raw)) return 'ledge';
  if (/timed out|Connection refused|No route to host|Network is unreachable|Connection (?:closed|reset) by|kex_exchange_identification/i.test(raw)) return 'unreachable';
  return 'other';
}
export const qualify = (machine: string, id: string) => `${machine}:${encodeURIComponent(id)}`;
export function splitId(id: string): { machine: string; id: string } | null {
  const at = id.indexOf(':'); if (at < 0) return null;
  try { return { machine: id.slice(0, at), id: decodeURIComponent(id.slice(at + 1)) }; } catch { return null; }
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function terminalCommand(machine: MachineState, rawId: string): string[] | null {
  if (!machine.launcher) return null;
  const command = [...machine.launcher, 'attach', rawId];
  return machine.ssh ? ['ssh', '-t', '--', machine.ssh, command.map(quote).join(' ')] : command;
}
const EMPTY: MachineState[] = [];
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
export function useMachines(client: DaemonClient): MachineState[] {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.machines ?? emptySnapshot, emptySnapshot);
}
