import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, Rig, RigPlan, RigSeat, ServerMessage } from '@ledge/protocol';
import { fr } from '../i18n/fr.js';
import type { Messages } from '../i18n/lang.js';

/** « Nouveau rig » in three steps: the form, Ledge's plan (optional, imposed on a real repository), then the start of the rig. */
export type RigLaunchStep = { kind: 'form' } | { kind: 'plan'; plan: RigPlan } | { kind: 'starting'; rigId?: string; planId: string };

/** How long a `rig.prepare` waits for its plan: the daemon may start OpenRig first (its bridge gives that 60 s), then reads the spec. */
export const RIG_PREPARE_MS = 90_000;
/** How long a `rig.launch` waits for its `rig.result`: OpenRig started, the copy (git worktree) made, then `rig up` brings every seat. */
export const RIG_LAUNCH_MS = 180_000;

export type RigLaunchMessage = Extract<ClientMessage, { type: 'rig.prepare' | 'rig.launch' }>;
export type RigLaunchAnswer = { ok: true; plan?: RigPlan } | { ok: false; code?: string; reason: string };

/**
 * Sends a `rig.prepare` or a `rig.launch` and resolves with its answer: the plan (`rig.plan`), the launch's `rig.result`, or a refusal.
 * `rig.prepare` goes to its machine by the fleet's routing; `rig.launch` names no machine, so it goes with `sendTo(machine)` to the one
 * that made the plan (the fleet's id: a remote daemon calls itself 'local' in `plan.machine`). As `rigCall`, the machine's answer comes
 * through `fleet.onMachineMessage`, the fleet's own refusal (machine offline) through `onMessage`; without a fleet, both through `onMessage`.
 * Not answered within `ms`: `{ ok: false, code: 'failed', reason: 'timeout' }`.
 */
export function rigLaunchCall(client: DaemonClient, machine: string, msg: RigLaunchMessage, ms = msg.type === 'rig.prepare' ? RIG_PREPARE_MS : RIG_LAUNCH_MS): Promise<RigLaunchAnswer> {
  return new Promise(resolve => {
    const offs: (() => void)[] = [];
    let done = false;
    const settle = (a: RigLaunchAnswer) => { if (done) return; done = true; clearTimeout(timer); offs.forEach(off => off()); resolve(a); };
    const timer = setTimeout(() => settle({ ok: false, code: 'failed', reason: 'timeout' }), ms);
    const answer = (m: ServerMessage) => {
      if (m.type === 'rig.plan' && m.rid === msg.rid && msg.type === 'rig.prepare') settle({ ok: true, plan: m.plan });
      else if (m.type === 'rig.result' && m.rid === msg.rid) settle(m.ok ? { ok: true } : { ok: false, ...(m.code ? { code: m.code } : {}), reason: m.reason ?? m.code ?? 'failed' });
    };
    const refusal = (m: ServerMessage) => { if (m.type === 'error' && m.request === msg.type) settle({ ok: false, code: 'unreachable', reason: m.message }); };
    if (client.fleet) offs.push(client.fleet.onMachineMessage((_, m) => answer(m)), client.onMessage(refusal));
    else offs.push(client.onMessage(m => { answer(m); refusal(m); }));
    if (msg.type === 'rig.prepare') client.send(msg);
    else if (client.fleet ? !client.fleet.sendTo(machine, msg) : (client.send(msg), false)) settle({ ok: false, code: 'unreachable', reason: `${machine} offline` });
  });
}

/** The rig a launch made: the one the daemon annotated with the plan's id, on the machine that made the plan. */
export const launchedRig = (rigs: readonly Rig[], machine: string, planId: string): Rig | undefined =>
  rigs.find(r => r.machine === machine && r.launch?.planId === planId);

const READY: ReadonlySet<RigSeat['state']> = new Set(['ready', 'idle', 'working']);
export type StartingLine = { glyph: 'ok' | 'running' | 'held'; label: string; detail: string };

/**
 * The start of a rig, step by step (mockup « le démarrage »): OpenRig, the copy (or the folder, or the space), Ledge as the rig's
 * human, `rig up`, the seats ready, the first tasks. Before the daemon names the rig, OpenRig works and the rest waits; then each
 * step is done but the seats, which follow the rig as they come up, and the first tasks, given to the lead once all are ready.
 */
export function startingLines(rig: Rig | undefined, plan: RigPlan, words: Messages['rigLaunch'] = fr.rigLaunch): StartingLine[] {
  const w = words.starting;
  const where = plan.where;
  const folder: StartingLine = where.kind === 'off-project'
    ? { glyph: 'held', label: w.space, detail: plan.cwd }
    : { glyph: 'held', label: where.copy ? w.copy : w.folder, detail: `${plan.cwd} · ⎇ ${where.branch}` };
  const total = rig?.seats.length || plan.seats.length;
  if (!rig) {
    return [
      { glyph: 'running', label: w.openrig, detail: w.preparing },
      folder,
      { glyph: 'held', label: w.human, detail: w.humanCommand },
      { glyph: 'held', label: w.up(plan.spec), detail: w.upDetail(plan.spec, total) },
      { glyph: 'held', label: w.seats, detail: w.ready(0, total) },
      { glyph: 'held', label: w.tasks, detail: w.tasksWait }
    ];
  }
  const ready = rig.seats.filter(s => READY.has(s.state));
  const coming = rig.seats.filter(s => !READY.has(s.state)).map(s => s.name);
  const all = total > 0 && ready.length === total;
  const sent = !!rig.launch?.goalSentAt;
  return [
    { glyph: 'ok', label: w.openrig, detail: w.running },
    { ...folder, glyph: 'ok' },
    { glyph: 'ok', label: w.human, detail: w.humanCommand },
    { glyph: 'ok', label: w.up(rig.name), detail: w.upDetail(plan.spec, total) },
    { glyph: all ? 'ok' : 'running', label: w.seats, detail: all ? w.ready(ready.length, total) : `${w.ready(ready.length, total)}${coming.length ? ` · ${w.coming(coming)}` : ''}` },
    sent ? { glyph: 'ok', label: w.tasks, detail: w.tasksSent(rig.launch!.lead) } : { glyph: 'held', label: w.tasks, detail: w.tasksWait }
  ];
}

/** The seat whose agent waits for the user's trust in the folder, if any: its prompt is answered by attaching it. */
export const trustSeat = (rig: Rig | undefined): RigSeat | undefined => rig?.seats.find(s => s.state === 'trust');
