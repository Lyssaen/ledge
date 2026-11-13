import type { FleetFollowedSession, FleetForgeStatus, FleetPullRequest } from './forge';
import { CONTEXT_NEAR, MachinesSchema, type Machine, type IslandPrefs, type MobileClientMessage, type MobileState, type UsageStateMessage, type OperatorNotice, type ForgeAction, type PrDetail } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';
import { parseServerMessage, type ClientMessage, type DaemonInfo, type Projects, type Recent, type Session, type ServerMessage, type Task } from '@ledge/protocol';
import { useSyncExternalStore } from 'react';
import { DAEMON_PROTOCOL_PREFIX, type TokenSource } from './token';

/** Where a `session.broadcast` goes, and its answer. */
export type BroadcastTo = Extract<ClientMessage, { type: 'session.broadcast' }>['to'];
export type BroadcastResult = Extract<ServerMessage, { type: 'session.broadcast.result' }>;
/** The url exists for `local` only: set by the fleet, never persisted nor sent. */
export type MachineConfig = Machine & { url?: string };
export interface MachineState extends MachineConfig { status: DaemonStatus; ready: boolean; recents: Recent[]; sessions: Session[]; launcher: string[] | null; version?: string; daemon?: DaemonInfo; error?: string }
/** Whether the machine's daemon can archive, restore, resume and delete sessions. */
export const canManage = (machine: { daemon?: DaemonInfo }): boolean => machine.daemon?.archive === true;
/** A one-off connection test: the remote Ledge answered with its snapshot, or the raw error SSH or the daemon gave. */
export type ProbeResult = { ok: true; version?: string; sessions: number } | { ok: false; error: string };
export interface Fleet {
  primary: DaemonClient;
  subscribe(fn: () => void): () => void;
  machines(): MachineState[];
  selected(): string;
  select(id: string): void;
  configure(config: MachineConfig[]): void;
  /** Every configured machine, disabled ones included, as `configure` takes them (`machines()` leaves the disabled out). */
  configured(): MachineConfig[];
  /** Where the machine list comes from: the local daemon once it has sent one (`machinesFromDaemon`), else localStorage. */
  machinesSource(): 'daemon' | 'local';
  /** Tests an SSH alias over its own connection, without touching the configured machines. */
  probe(ssh: string): Promise<ProbeResult>;
  /** Reconnects a machine now instead of waiting for the next backoff. */
  retry(id: string): void;
  terminal(id: string, opts?: { readOnly?: boolean }): string[] | null;
  /** A login shell in the session's folder (`workdir ?? cwd`), or null when it cannot be opened. */
  shell(id: string): string[] | null;
  turnMachine(qid: string): MachineState | undefined;
  documentMachine(id: string): string | undefined;
  localSnapshot(): Extract<ServerMessage, { type: 'snapshot' }> | null;
  /** Sends to one machine; false when it is not connected (nothing sent). */
  sendTo(machine: string, msg: ClientMessage): boolean;
  /** Every daemon message, unqualified, with the machine it came from. */
  onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void;
  /** The local daemon's projects and folder rules (build spec §5): null until it sends them, kept while it is down. */
  projects(): Projects | null;
  /** Asks the local daemon to replace them; applied on its broadcast. Throws when invalid, `DaemonOffline` when not connected, `DaemonOutdated` when it never sent projects. */
  setProjects(next: Projects): void;
  /** The island's settings as the local daemon holds them: undefined until it speaks of them, null while none was set; kept while it is down. */
  island(): IslandPrefs | null | undefined;
  /** Asks the local daemon to replace them; applied on its broadcast. Throws when invalid, `DaemonOffline` when not connected, `DaemonOutdated` when it never sent them. */
  setIsland(next: IslandPrefs): void;
  /** The mobile access state as the local daemon holds it: undefined until it speaks of it; kept while it is down. */
  mobile(): MobileState | undefined;
  /** The local daemon's last refused mobile.* command; cleared by the next command and by the next mobile state. */
  mobileError(): MobileError | undefined;
  /** Sends a mobile access command to the local daemon; the effect arrives on its broadcast. Throws `DaemonOffline` when not connected, `DaemonOutdated` when it never sent the state. */
  sendMobile(msg: MobileClientMessage): void;
  /** The device typing from a phone into the session's terminal (« Téléphone au clavier »), by its label; sessions qualified, the local daemon's only. */
  terminalHolders(): ReadonlyMap<string, string>;
  /** « Reprendre la main »: the phone goes back to reading the session's terminal. Throws `DaemonOffline` when not connected. */
  releaseTerminal(id: string): void;
  /** The tasks known to the local daemon, oldest first; sessions qualified. */
  tasks(): Task[];
  /** Each machine's harness limits as it last sent them (`usage.state`), by machine id; empty until one does. */
  usage(): ReadonlyMap<string, UsageStateMessage>;
  /** Each machine's operator notices as it last sent them (`operator.state`), by machine id; empty until one does. */
  operator(): ReadonlyMap<string, OperatorNotice[]>;
  /** Sets the usage alert threshold (0.5–0.95) on every machine that speaks of usage; the effect arrives on their broadcasts. */
  setUsageAlert(alert: number): void;
  /** « Compris » on an alert: sent to each machine that holds it. */
  ackUsage(id: string): void;
  /** Every machine's pull and merge requests (lot 8a), sessions qualified, each with the machine that read it. */
  prs(): FleetPullRequest[];
  /** Each machine's forges (`gh` / `glab` missing, not signed in, in error), with the machine. */
  forges(): FleetForgeStatus[];
  /** Each machine's followed sessions (qualified) and the forge of their repository: for the chip « PR ? » (`sessionForge`). */
  followed(): FleetFollowedSession[];
  /** Called when a machine's requests or forges change, or a machine falls. */
  onForge(cb: () => void): () => void;
  /** A request's detail, from the machine that read it (`log`: a job's log too). Rejects with `{ code, message }`: `offline`
   *  (« hors ligne ») when the machine is down or falls, `outdated` when its daemon does not serve requests, else the daemon's code. */
  prDetail(prId: string, machineId: string, opts?: { log?: string }): Promise<PrDetail>;
  /** An action on a request, on the machine that read it; resolves with the command run. Rejects as `prDetail`. */
  prAct(prId: string, machineId: string, action: ForgeAction): Promise<{ command: string }>;
  /** The context threshold the local daemon keeps (context handover spec §3.2): undefined until it speaks of it. */
  contextNear(): number | undefined;
  /** Sets it on the local daemon; the effect arrives on its broadcast. Throws `DaemonOffline` / `DaemonOutdated` as `setIsland`. */
  setContextNear(near: number): void;
  /** Writes `text` to a project or to sessions on every machine that holds them, each daemon writing to its own (broadcast
   *  spec), and resolves with the merged `session.broadcast.result` of that `rid`. A machine whose daemon (or, for a remote,
   *  the local SSH gateway) does not announce `broadcast` is sent nothing: « version trop ancienne ». Nobody reached: `reason`,
   *  BROADCAST_SILENT when every machine asked was silent past BROADCAST_TIMEOUT_MS. A resend with the same `rid` is answered once. */
  broadcast(to: BroadcastTo, text: string, rid?: string): Promise<BroadcastResult>;
}
/** A refused mobile.* command, as the Mobile access settings say it. */
export interface MobileError { request: string; message: string; code?: string }
export const LOCAL_MACHINE: MachineConfig = { id: 'local', label: 'Local', url: 'ws://127.0.0.1:47831' };
/** The local daemon takes `session.broadcast` (its snapshot says so): the app offers to write to a project or a selection only then. */
export const canBroadcast = (machines: readonly Pick<MachineState, 'id' | 'daemon'>[]): boolean => !!machines.find(m => m.id === LOCAL_MACHINE.id)?.daemon?.broadcast;
/** The shared list rules live in the protocol; the fleet only pins the local URL (spec §5.1). */
export function parseMachines(raw: unknown): MachineConfig[] {
  const list = MachinesSchema.parse(Array.isArray(raw) ? raw.map(m => { const rest = { ...(m ?? {}) } as Record<string, unknown>; delete rest.url; return rest; }) : raw);
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
type ProbeSocket = { close(): void; onopen?: null | (() => void); onclose: null | (() => void); onerror: null | (() => void); onmessage: null | ((ev: { data: unknown }) => void) };
/** Opens `/ssh/<alias>` on the local daemon once and settles on the first snapshot, error or close. With `token`, the socket offers it, and none opens without one. */
export function probeMachine(url: string, ssh: string, opts: { token?: TokenSource; WebSocketImpl?: new (url: string, protocols?: string[]) => ProbeSocket; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const Ws = opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (url: string, protocols?: string[]) => ProbeSocket }).WebSocket;
  return new Promise(resolve => {
    let sock: ProbeSocket | undefined, error = '', done = false, opened = false;
    const finish = (r: ProbeResult) => { if (done) return; done = true; clearTimeout(timer); if (sock) { sock.onclose = sock.onmessage = sock.onerror = null; sock.close(); } resolve(r); };
    // The daemon gives up on a silent remote after 60 s; this only guards against a daemon that never answers.
    const timer = setTimeout(() => finish({ ok: false, error: 'SSH: no Ledge snapshot received.' }), opts.timeoutMs ?? 75_000);
    const start = (protocols?: string[]) => {
      if (done) return;
      // With a token, the browser's own error would quote a malformed subprotocol, hence the token: not repeated.
      try { const target = machineUrl({ id: 'probe', label: ssh, ssh }, { ...LOCAL_MACHINE, url }); sock = protocols ? new Ws(target, protocols) : new Ws(target); } catch (e) { finish({ ok: false, error: protocols ? 'The local Ledge daemon could not be reached.' : (e as Error).message }); return; }
      sock.onmessage = ev => {
        let m: ServerMessage; try { m = parseServerMessage(JSON.parse(String(ev.data))); } catch { return; }
        if (m.type === 'error') error = m.message;
        else if (m.type === 'snapshot') finish(m.sshAlias === ssh ? { ok: true, version: m.daemon?.version, sessions: m.sessions.length } : { ok: false, error: 'Update the local Ledge daemon: SSH transport is unavailable' });
      };
      sock.onopen = () => { opened = true; };
      sock.onerror = () => { /* onclose follows */ };
      // Never opened (refused, perhaps a stale cached token): the next probe reads the token again, as the client does.
      sock.onclose = () => { if (!opened) void opts.token?.get(true); finish({ ok: false, error: error || 'The local Ledge daemon closed the connection.' }); };
    };
    if (!opts.token) { start(); return; }
    void opts.token.get(false).then(r => {
      if (r.kind === 'token') start([DAEMON_PROTOCOL_PREFIX + r.token]);
      else finish({ ok: false, error: r.kind === 'absent' ? 'The local Ledge daemon token is missing: start or update the daemon.' : 'The local Ledge daemon token could not be read.' });
    });
  });
}
export type SshProblem = 'alias' | 'key' | 'hostKey' | 'unreachable' | 'ledge' | 'stopped' | 'local' | 'other';
/** The usual cause behind a raw SSH or remote Ledge error, to explain it in plain words. */
export function sshProblem(raw: string): SshProblem {
  if (/Update the local Ledge daemon|local Ledge daemon token is missing/i.test(raw)) return 'local';
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
/** An argument `wsl.exe --exec` hands to the program as is (no shell reads it, so `$(…)` or a space is only text), after
 *  Windows Terminal wrapped each one holding a space in double quotes, escaping nothing: a `"`, a control character or a
 *  final backslash would split it or run into the next one (ledge-native's `wsl_arg_ok`). */
const wslArg = (s: string) => s !== '' && !/["\u0000-\u001f\u007f-\u009f]/.test(s) && !s.endsWith('\\');
export function terminalCommand(machine: MachineState, rawId: string, opts: { readOnly?: boolean } = {}): string[] | null {
  if (!machine.launcher || !rawId) return null;
  const command = [...machine.launcher, 'attach', ...(opts.readOnly ? ['--read-only'] : []), rawId];
  // The launcher and the id come from the machine's daemon: through ssh, the remote shell reads them quoted.
  const argv = machine.ssh ? ['ssh', '-t', '--', machine.ssh, command.map(quote).join(' ')] : command;
  return argv.every(wslArg) ? argv : null;
}
/** A free shell's nonce (#299): 32 hexadecimal characters, drawn by the front for each shell. */
export const SHELL_NONCE = /^[0-9a-f]{32}$/;
/** What `<launcher> shell` prints first (#299, agreed with dev-back): any other output (an older ledge, noise, an error) is never
 *  evaluated. `:` is POSIX's no-op. */
export const SHELL_LINE_MARK = ': ledge-shell; ';
/** UTF-8 base64, browser and Node alike. */
const base64 = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
/** A login shell in `dir` (home when it is gone): the user's own shell, read from passwd here and from `$SHELL` over ssh. With
 *  `nonce`, and a machine whose daemon says `freeShell`, its launcher prints the line that starts the shell with the integration
 *  (OSC 633, E signed with `nonce`), evaluated only when it starts with SHELL_LINE_MARK; else the plain login shell as before. */
export function shellCommand(machine: MachineState, dir: string, nonce?: string): string[] | null {
  if (!wslArg(dir)) return null; // empty, or one wsl.exe would mangle: no shell
  const plain = `cd ${quote(dir)} 2>/dev/null || cd; exec`;
  const login = machine.ssh ? '$SHELL' : '$(getent passwd $(id -un) | cut -d: -f7)';
  if (!integrated(machine, nonce)) {
    const argv = machine.ssh ? ['ssh', '-t', '--', machine.ssh, `${plain} ${login} -l`] : ['sh', '-c', `${plain} ${login} -l`];
    return argv.every(wslArg) ? argv : null;
  }
  // No double quote (wsl.exe would split the argument on it): IFS empty and globbing off keep the printed line one word, as is.
  // Its errors stay out of it (2>/dev/null): a launcher gone prints nothing here, and the plain shell starts.
  const ask = [...machine.launcher!, 'shell', '--nonce', nonce!, dir].map(quote).join(' ');
  const line = `set -f; IFS=; l=$(${ask} 2>/dev/null); case $l in ${quote(SHELL_LINE_MARK)}*) eval $l;; esac; unset IFS; set +f; ${plain} ${login} -l`;
  // Over ssh the string is read by the remote login shell, which may not be sh: fish refuses `IFS=`, and reads a quote nested in
  // single quotes (`'\\''`) its own way. So sh runs it, and it travels in base64: the quoted part holds no quote nor backslash,
  // and base64's alphabet means the same to sh and fish (review #299, point 1).
  // A remote that cannot decode it (no base64; an old macOS spells it -D) evaluates nothing: the plain login shell then, at home.
  const decode = ' (printf %s $0 | base64 -d || printf %s $0 | base64 -D) 2>/dev/null'; // a space first: `$((` would be arithmetic
  const argv = machine.ssh ? ['ssh', '-t', '--', machine.ssh, `sh -c 'IFS=; set -f; eval $(${decode}); unset IFS; set +f; exec $SHELL -l' ${base64(line)}`] : ['sh', '-c', line];
  return argv.every(wslArg) ? argv : null;
}
/** Whether a free shell on `machine` starts with the integration: its daemon says so, its launcher is known, the nonce is one. */
export const integrated = (machine: MachineState, nonce: string | undefined): boolean =>
  !!nonce && SHELL_NONCE.test(nonce) && machine.daemon?.freeShell === true && !!machine.launcher?.length;
const EMPTY: MachineState[] = [];
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
export function useMachines(client: DaemonClient): MachineState[] {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.machines ?? emptySnapshot, emptySnapshot);
}
const noConfigs: MachineConfig[] = [];
const emptyConfigs = () => noConfigs;
/** Every configured machine, disabled ones included: what Settings › Machines lists and saves. */
export function useConfiguredMachines(client: DaemonClient): MachineConfig[] {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.configured ?? emptyConfigs, emptyConfigs);
}
const nullSnapshot = () => null;
/** The local daemon's projects, null until it sends them. */
const noTasks: Task[] = [];
const emptyTasks = () => noTasks;
/** The context threshold (context handover spec §3.2): the local daemon's, else the default. */
const defaultNear = () => CONTEXT_NEAR;
export function useContextNear(client: DaemonClient): number {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, () => client.fleet?.contextNear() ?? CONTEXT_NEAR, defaultNear);
}
/** The tasks known to the local daemon. */
export function useTasks(client: DaemonClient): Task[] {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.tasks ?? emptyTasks, emptyTasks);
}
export function useProjects(client: DaemonClient): Projects | null {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.projects ?? nullSnapshot, nullSnapshot);
}
const undefinedSnapshot = () => undefined;
const emptyUsage: ReadonlyMap<string, UsageStateMessage> = new Map();
/** Each machine's harness limits (`usage.state`), by machine id. */
export function useUsage(client: DaemonClient): ReadonlyMap<string, UsageStateMessage> {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.usage ?? (() => emptyUsage), () => emptyUsage);
}
const emptyOperator: ReadonlyMap<string, OperatorNotice[]> = new Map();
/** Each machine's operator notices (`operator.state`), by machine id: what the notch lets Ledge say. */
export function useOperatorNotices(client: DaemonClient): ReadonlyMap<string, OperatorNotice[]> {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.operator ?? (() => emptyOperator), () => emptyOperator);
}
/** The island's settings as the local daemon holds them: undefined until it speaks of them, null while none was set. */
export function useIsland(client: DaemonClient): IslandPrefs | null | undefined {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.island ?? undefinedSnapshot, undefinedSnapshot);
}
/** The mobile access state as the local daemon holds it: undefined until it speaks of it. */
export function useMobile(client: DaemonClient): MobileState | undefined {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.mobile ?? undefinedSnapshot, undefinedSnapshot);
}
const emptyHolders: ReadonlyMap<string, string> = new Map();
/** The sessions a phone types into, by the device's label. */
export function useTerminalHolders(client: DaemonClient): ReadonlyMap<string, string> {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.terminalHolders ?? (() => emptyHolders), () => emptyHolders);
}
/** The local daemon's last refused mobile.* command. */
export function useMobileError(client: DaemonClient): MobileError | undefined {
  return useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.mobileError ?? undefinedSnapshot, undefinedSnapshot);
}
