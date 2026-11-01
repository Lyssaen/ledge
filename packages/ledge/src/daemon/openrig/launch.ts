import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Rig, RigLaunchInfo, RigPlan, RigSeat } from '@ledge/protocol';
import { log } from '../../log.js';
import type { Exec } from '../git.js';
import type { Bridge, BridgeMessage } from './bridge.js';
import type { RigCli } from './cli.js';
import { prepareWorkspace } from './workspace.js';
import { HUMAN_ADDRESS } from './facts.js';
import { ledgeContact } from './seatContext.js';

/** After this long the goal goes to the lead even when some seats are not ready. */
export const GOAL_TIMEOUT_MS = 10 * 60_000;

export interface PendingLaunch { planId: string; machine: string; rigId: string; rigName: string; goal: string; lead: string; startedAt: string; goalSentAt?: string; lateNotice?: boolean; trustNotice?: boolean }

const READY = new Set<RigSeat['state']>(['ready', 'working', 'idle']);

/** The seat whose name or address says `lead`, else the first seat. */
export function leadOf(seats: readonly RigSeat[]): RigSeat | undefined {
  return seats.find(s => /lead/i.test(s.name) || /lead/i.test(s.address)) ?? seats[0];
}

export function goalMessage(goal: string, mandate: string): string { return `But donné par l'utilisateur, via Ledge : ${goal}\n\n${ledgeContact(HUMAN_ADDRESS)}\n\n${mandate}`; }

export interface LaunchDeps {
  cli: Pick<RigCli, 'up'>;
  bridge: Pick<Bridge, 'rigs' | 'onMessage' | 'annotate' | 'ensureRunning'>;
  /** Writes to a seat (lot 4's seat send: signed « [Ledge] », as ledge@external). */
  send(seatRef: string, text: string): Promise<{ ok: boolean; reason?: string; detail?: string }>;
  /** Ledge's thread voice. */
  say(text: string): void;
  /** The mandate summary the goal carries. */
  mandate(): string;
  /** Runs git for the rig's worktree (argv only). */
  git: Exec;
  /** rig-launches.json */
  file: string;
  now(): number;
  setTimer: typeof setTimeout;
  clearTimer: typeof clearTimeout;
}

export interface Launches {
  launch(plan: RigPlan): Promise<{ ok: true; rigId: string } | { ok: false; code: 'openrig_down' | 'failed'; reason: string }>;
  pending(): PendingLaunch[];
  /** Reads rig-launches.json again (daemon start) and re-arms each remaining delay; a goal already sent is never sent again. */
  resume(): void;
  /** Forgets a launch (the rig itself goes down through rig.act). */
  cancel(rigId: string): Promise<void>;
  close(): void;
}

const tail = (s: string): string => s.trim().slice(-300);

/**
 * Launches a prepared rig, then gives its goal to the lead once every seat is ready, or after GOAL_TIMEOUT_MS anyway.
 * A seat waiting for the user's trust in its folder is never written to: the goal waits for it.
 */
export function createLaunches(d: LaunchDeps): Launches {
  const live = new Map<string, PendingLaunch>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const due = new Set<string>(); // the delay is over
  const seen = new Set<string>(); // the mirror has shown the rig
  const sending = new Set<string>();
  const failedSaid = new Set<string>();

  const save = (): void => {
    try {
      mkdirSync(dirname(d.file), { recursive: true });
      const tmp = `${d.file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...live.values()], null, 2) + '\n'); renameSync(tmp, d.file);
    } catch (e) { log(`openrig: rig launches not saved: ${(e as Error).message}`); }
  };
  const info = (p: PendingLaunch): RigLaunchInfo => ({ planId: p.planId, goal: p.goal, lead: p.lead, startedAt: p.startedAt,
    ...(p.goalSentAt ? { goalSentAt: p.goalSentAt } : {}), ...(p.lateNotice ? { lateNotice: true } : {}) });
  const forget = (rigId: string): void => {
    const t = timers.get(rigId); if (t) d.clearTimer(t);
    timers.delete(rigId); due.delete(rigId); seen.delete(rigId); failedSaid.delete(rigId);
    if (live.delete(rigId)) save();
  };
  const arm = (p: PendingLaunch): void => {
    const left = Math.max(0, Date.parse(p.startedAt) + GOAL_TIMEOUT_MS - d.now());
    const t = d.setTimer(() => { timers.delete(p.rigId); due.add(p.rigId); void check(p.rigId); }, left);
    (t as { unref?: () => void }).unref?.();
    timers.set(p.rigId, t);
  };
  const rigNow = (rigId: string): Rig | undefined => d.bridge.rigs().find(r => r.id === rigId);

  async function check(rigId: string, rig: Rig | undefined = rigNow(rigId)): Promise<void> {
    const p = live.get(rigId); if (!p || p.goalSentAt || sending.has(rigId) || !rig) return;
    if (rig.lifecycle === 'stopped') { forget(rigId); d.bridge.annotate(rigId, { launch: null }); return; }
    const lead = leadOf(rig.seats); if (!lead) return;
    const ready = rig.seats.every(s => READY.has(s.state));
    const late = due.has(rigId) || d.now() - Date.parse(p.startedAt) >= GOAL_TIMEOUT_MS;
    if (!ready && !late) return;
    // A failed startup may have returned to a shell; never type the goal there, even after the timeout.
    if (lead.state === 'attention') return;
    if (lead.state === 'trust') {
      if (!p.trustNotice) { p.trustNotice = true; save(); d.say(`${lead.ref} attend ta confiance dans le dossier : le but partira après.`); }
      return;
    }
    sending.add(rigId);
    let r: { ok: boolean; reason?: string; detail?: string };
    try { r = await d.send(lead.ref, goalMessage(p.goal, d.mandate())); }
    catch (e) { r = { ok: false, detail: (e as Error).message }; }
    finally { sending.delete(rigId); }
    if (!live.has(rigId)) return; // cancelled while sending
    if (!r.ok) {
      if (!failedSaid.has(rigId)) { failedSaid.add(rigId); d.say(`Je n'ai pas pu donner le but à ${lead.ref} : ${r.reason ?? r.detail ?? 'échec'}. Je réessaie au prochain changement du rig.`); }
      return;
    }
    p.lead = lead.ref; p.goalSentAt = new Date(d.now()).toISOString();
    const waiting = ready ? [] : rig.seats.filter(s => !READY.has(s.state)).map(s => s.ref);
    if (waiting.length) p.lateNotice = true;
    const launch = info(p);
    const t = timers.get(rigId); if (t) d.clearTimer(t);
    timers.delete(rigId); due.delete(rigId); seen.add(rigId);
    save(); // sent: the entry stays in the file with goalSentAt, until the rig stops or goes
    d.bridge.annotate(rigId, { launch });
    d.say(waiting.length
      ? `Les sièges de ${p.rigName} ne sont pas tous prêts après 10 min : j'ai quand même donné le but à ${lead.ref}. ${waiting.join(', ')} attend encore.`
      : `J'ai donné le but à ${lead.ref}.`);
  }

  /** The rig as the mirror shows it: annotated once the mirror has it (after a restart too), stopped or gone ends the launch. */
  const onRig = (rig: Rig): void => {
    const p = live.get(rig.id); if (!p) return;
    seen.add(rig.id);
    if (rig.lifecycle === 'stopped') { forget(rig.id); d.bridge.annotate(rig.id, { launch: null }); return; }
    if (!rig.launch) d.bridge.annotate(rig.id, { launch: info(p) });
    void check(rig.id, rig);
  };
  const unsubscribe = d.bridge.onMessage((m: BridgeMessage) => {
    if (m.type === 'rig.updated') onRig(m.rig);
    else if (m.type === 'rig.removed') forget(m.rigId);
    else if (m.type === 'rig.snapshot') {
      const ids = new Set(m.rigs.map(r => r.id));
      for (const id of [...live.keys()]) {
        if (ids.has(id) || !(seen.has(id) || due.has(id))) continue;
        const p = live.get(id)!;
        if (!p.goalSentAt && !seen.has(id)) d.say(`${p.rigName} n'est jamais apparu : le but n'est pas parti.`);
        forget(id);
      }
      for (const r of m.rigs) onRig(r);
    }
  });

  return {
    async launch(plan) {
      const st = await d.bridge.ensureRunning('launch');
      if (st.state !== 'running') return { ok: false, code: 'openrig_down', reason: st.detail ?? `OpenRig is ${st.state}` };
      const ws = await prepareWorkspace(plan, d.git);
      if (!ws.ok) return { ok: false, code: 'failed', reason: ws.reason };
      const up = await d.cli.up(plan.spec, plan.cwd);
      if (!up.ok) {
        const reason = tail(up.detail);
        d.say(`Le lancement de ${plan.spec} a échoué : ${reason}${ws.created && plan.where.kind === 'project' ? ` La copie ${plan.cwd} reste sur le disque.` : ''}`);
        return { ok: false, code: 'failed', reason };
      }
      const known = rigNow(up.rigId);
      const lead = (known && leadOf(known.seats)?.ref) ?? plan.seats.find(s => /lead/i.test(s.address))?.address ?? plan.seats[0]?.address ?? '';
      const p: PendingLaunch = { planId: plan.id, machine: plan.machine, rigId: up.rigId, rigName: up.rigName, goal: plan.goal, lead, startedAt: new Date(d.now()).toISOString() };
      live.set(p.rigId, p); save(); arm(p);
      d.bridge.annotate(p.rigId, { launch: info(p) });
      if (known) void check(p.rigId, known);
      return { ok: true, rigId: up.rigId };
    },
    pending: () => [...live.values()].filter(p => !p.goalSentAt).map(p => ({ ...p })),
    resume() {
      let list: unknown;
      try { list = JSON.parse(readFileSync(d.file, 'utf8')); } catch { return; }
      if (!Array.isArray(list)) return;
      for (const x of list as PendingLaunch[]) {
        if (!x || typeof x.rigId !== 'string' || typeof x.goal !== 'string' || typeof x.startedAt !== 'string' || Number.isNaN(Date.parse(x.startedAt))) continue;
        if (live.has(x.rigId)) continue;
        live.set(x.rigId, { ...x });
        if (!x.goalSentAt) arm(x); // sent before the restart: annotated again, never sent again
        const rig = rigNow(x.rigId); if (rig) onRig(rig);
      }
      if (live.size !== list.length) save(); // unreadable entries leave the file
    },
    async cancel(rigId) { const had = live.has(rigId); forget(rigId); if (had) d.bridge.annotate(rigId, { launch: null }); },
    close() { unsubscribe(); for (const t of timers.values()) d.clearTimer(t); timers.clear(); },
  };
}
