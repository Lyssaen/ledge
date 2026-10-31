import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, Projects, Rig, RigRepo, ServerMessage } from '@ledge/protocol';
import { fr } from '../i18n/fr.js';
import type { Messages } from '../i18n/lang.js';

export type RigCallMessage = Extract<ClientMessage, { type: 'rig.act' | 'rig.adopt' }>;
/** A rig.act or rig.adopt before its rid. */
export type RigCallRequest = RigCallMessage extends infer M ? (M extends unknown ? Omit<M, 'rid'> : never) : never;
export interface RigCallResult { ok: boolean; code?: string; reason?: string }

/** How long a rig.act / rig.adopt waits for its rig.result. */
export const RIG_CALL_MS = 5000;

/** The calls in flight, oldest first: a refusal the fleet makes itself (machine offline) names the request, not the rid. */
const waiting: { rid: string; type: RigCallMessage['type']; settle(r: RigCallResult): void }[] = [];

/**
 * Sends `msg` and resolves with the rig.result of its rid (RIG_CALL_MS at most, then `{ ok: false, code: 'failed', reason: 'timeout' }`).
 * The fleet routes it to `msg.machine`; that machine's answer comes through `fleet.onMachineMessage` (the local one's too), the
 * fleet's own refusals through `onMessage`. Without a fleet, everything comes through `onMessage`.
 */
export function rigCall(client: DaemonClient, msg: RigCallMessage): Promise<RigCallResult> {
  return new Promise(resolve => {
    const offs: (() => void)[] = [];
    const entry = { rid: msg.rid, type: msg.type, settle: (r: RigCallResult) => { clearTimeout(timer); offs.forEach(off => off()); const i = waiting.indexOf(entry); if (i < 0) return; waiting.splice(i, 1); resolve(r); } };
    const timer = setTimeout(() => entry.settle({ ok: false, code: 'failed', reason: 'timeout' }), RIG_CALL_MS);
    const result = (m: ServerMessage) => {
      if (m.type === 'rig.result' && m.rid === msg.rid) entry.settle({ ok: m.ok, ...(m.code ? { code: m.code } : {}), ...(m.reason ? { reason: m.reason } : {}) });
    };
    const refusal = (m: ServerMessage) => {
      if (m.type === 'error' && m.request === msg.type && waiting.find(w => w.type === msg.type) === entry) entry.settle({ ok: false, code: 'unreachable', reason: m.message });
    };
    waiting.push(entry);
    if (client.fleet) offs.push(client.fleet.onMachineMessage((_, m) => result(m)), client.onMessage(refusal));
    else offs.push(client.onMessage(m => { result(m); refusal(m); }));
    client.send(msg);
  });
}

/** The projects holding one of the rig's repos (same folder on the rig's machine, or a folder of the same name), by project id. */
export function heldRepos(rig: Rig, projects: Projects | null): Map<string, RigRepo[]> {
  const base = (path: string) => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
  const held = new Map<string, RigRepo[]>();
  for (const p of projects?.projects ?? []) {
    const mine = rig.repos.filter(r => p.repos.some(x => x.machine === rig.machine && (x.path === r.path || base(x.path) === r.name)));
    if (mine.length) held.set(p.id, mine);
  }
  return held;
}

/**
 * The choices of « Ranger dans un projet… »: the projects already holding one of the rig's repos first (« contient déjà web »),
 * then the others in their order, then « Laisser hors projet » (projectId null: nothing is sent).
 */
export function adoptChoices(rig: Rig, projects: Projects | null, words: Messages['rigAct'] = fr.rigAct): { projectId: string | null; label: string; note?: string }[] {
  const held = heldRepos(rig, projects);
  const all = projects?.projects ?? [];
  return [
    ...all.filter(p => held.has(p.id)).map(p => ({ projectId: p.id, label: p.name, note: words.holds(held.get(p.id)!.map(r => r.name).join(', ')) })),
    ...all.filter(p => !held.has(p.id)).map(p => ({ projectId: p.id, label: p.name })),
    { projectId: null, label: words.leaveOut }
  ];
}

/** A rig that « Ranger dans un projet… » may file: this daemon's (projects are the local daemon's), off any project, reachable. */
export const adoptable = (rig: Rig): boolean => rig.machine === 'local' && rig.offProject && !rig.projectId && !rig.kernel && rig.lifecycle !== 'unreachable';

/** What a toast says of a refused rig.act / rig.adopt: rig_managed and a timeout in Ledge's words, else the daemon's reason. */
export function refusalText(r: RigCallResult, words: Messages['rigAct'] = fr.rigAct): string {
  if (r.code === 'rig_managed') return words.refused.rig_managed!;
  if (r.reason === 'timeout') return words.refused.timeout!;
  return r.reason ?? words.refused[r.code ?? 'failed'] ?? r.code ?? words.refused.failed!;
}
