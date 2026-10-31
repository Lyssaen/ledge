import { randomUUID } from 'node:crypto';
import { ActionIdSchema, MandateCategorySchema, type ActionId, type BrainOp, type BrainResultCode, type ChatAction, type ChatRigLaunch, type ClientMessage,
  type Escalation, type Projects, type RigLaunchWhere, type RigPlan, type RigResultCode, type Rig, type RigSeat, type Session } from '@ledge/protocol';
import { slugOfGoal } from '@ledge/ui/launch/rigModel';
import type { ChatMessage } from '../../chat/service.js';
import { formatWho } from '../../cli/who.js';
import { resolveRun } from '../actions.js';
import type { LedgeThread } from '../ledgeThread.js';
import type { SeatSendResult } from '../ledgeSay.js';
import { resolveSeatAddress } from '../openrig/seatSend.js';
import type { Deciding } from './decide.js';
import type { Memory } from './memory.js';

export { NOT_BRAIN_LINE } from '../../cli/brain.js';
/** The refusal of a `rig up` / `rig down` the user did not ask for in the thread. */
export const BECAUSE_REFUSED = "un up ou un down de rig n'est accepté que si l'utilisateur l'a demandé dans le fil";
/** How long a user item of the thread authorises a `rig up` / `rig down`. */
export const BECAUSE_MS = 24 * 3_600_000;

export type BrainCall =
  | { op: 'say'; text: string }
  | { op: 'decide'; id: string; answers: Record<string, string>; category: string; rule?: string; why?: string }
  | { op: 'ask'; id: string; category?: string; advice: string }
  | { op: 'rig'; verb: 'up'; spec: string; goal: string; because: string; project?: string; off?: string; machine?: string }
  | { op: 'rig'; verb: 'down'; rig: string; because: string }
  | { op: 'rig'; verb: 'restart'; seat: string }
  | { op: 'rig'; verb: 'handover'; seat: string }
  | { op: 'send'; to: string; text: string }
  | { op: 'propose'; rigLaunch: ChatRigLaunch }
  | { op: 'propose'; action: ActionId; args: Record<string, unknown> }
  | { op: 'remember'; text: string; from: string[]; category?: string }
  | { op: 'who' | 'rigs' | 'escalations' | 'rules' };

export type BrainOutcome = { ok: boolean; line: string; code?: BrainResultCode };
export type RigResult = { ok: true } | { ok: false; code: RigResultCode; reason?: string };
export type RigActMsg = Extract<ClientMessage, { type: 'rig.act' }>;
export type RigPrepareMsg = Extract<ClientMessage, { type: 'rig.prepare' }>;

const USAGE: Record<BrainOp, string> = {
  say: 'ledge brain say "<texte>"',
  decide: 'ledge brain decide <id> --answer q=opt … --category <c> [--rule <id>] [--why "…"]',
  ask: 'ledge brain ask <id> [--category <c>] --advice "…"',
  rig: 'ledge brain rig up <spec> --goal "…" --because <userItemId> [--project <id> | --off <nom>] [--machine <m>] | rig down <rig> --because <userItemId> | rig restart|handover <siège>',
  send: 'ledge brain send <@siège> "<texte>"',
  propose: "ledge brain propose <action> --args '<json>' | propose rig-launch --goal \"…\" [--spec <spec>] [--project <id> | --off-project <nom>] [--machine <m>]",
  remember: 'ledge brain remember "<règle>" --from <decisionIds> [--category <c>]',
  who: 'ledge brain who', rigs: 'ledge brain rigs', escalations: 'ledge brain escalations', rules: 'ledge brain rules',
};

type Parsed = { pos: string[]; one: Record<string, string>; many: Record<string, string[]> };
/** Positionals and `--flag value` pairs; `repeat` flags may come several times. null: an unknown flag, a missing value, or a flag twice. */
function flags(args: string[], known: readonly string[], repeat: readonly string[] = []): Parsed | null {
  const out: Parsed = { pos: [], one: {}, many: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) { out.pos.push(a); continue; }
    const name = a.slice(2);
    if (!known.includes(name) && !repeat.includes(name)) return null;
    const v = args[i + 1];
    if (v === undefined || (v.startsWith('--') && [...known, ...repeat].includes(v.slice(2)))) return null;
    i++;
    if (repeat.includes(name)) (out.many[name] ??= []).push(v);
    else if (name in out.one) return null;
    else out.one[name] = v;
  }
  return out;
}
const opt = <K extends string>(k: K, v: string | undefined): Partial<Record<K, string>> => (v === undefined ? {} : { [k]: v } as Record<K, string>);

/** `ledge brain <op> <args…>` as a call, or the op's usage line. */
export function parseBrainArgs(op: BrainOp, args: string[]): { ok: true; value: BrainCall } | { ok: false; usage: string } {
  const value = parse(op, args);
  return value ? { ok: true, value } : { ok: false, usage: USAGE[op] };
}

function parse(op: BrainOp, args: string[]): BrainCall | null {
  switch (op) {
    case 'who': case 'rigs': case 'escalations': case 'rules': return args.length === 0 ? { op } : null;
    case 'say': {
      const p = flags(args, []); if (!p || p.pos.length === 0) return null;
      return { op, text: p.pos.join(' ') };
    }
    case 'decide': {
      const p = flags(args, ['category', 'rule', 'why'], ['answer']);
      if (!p || p.pos.length !== 1 || !p.one.category || !p.many.answer?.length) return null;
      const answers: Record<string, string> = {};
      for (const pair of p.many.answer) {
        const at = pair.indexOf('=');
        if (at <= 0 || at === pair.length - 1) return null;
        answers[pair.slice(0, at)] = pair.slice(at + 1);
      }
      return { op, id: p.pos[0]!, answers, category: p.one.category, ...opt('rule', p.one.rule), ...opt('why', p.one.why) };
    }
    case 'ask': {
      const p = flags(args, ['category', 'advice']);
      if (!p || p.pos.length !== 1 || p.one.advice === undefined) return null;
      return { op, id: p.pos[0]!, advice: p.one.advice, ...opt('category', p.one.category) };
    }
    case 'rig': {
      const [verb, ...rest] = args;
      if (verb === 'up') {
        const p = flags(rest, ['goal', 'because', 'project', 'off', 'machine']);
        if (!p || p.pos.length !== 1 || !p.one.goal || !p.one.because || (p.one.project && p.one.off)) return null;
        return { op, verb, spec: p.pos[0]!, goal: p.one.goal, because: p.one.because, ...opt('project', p.one.project), ...opt('off', p.one.off), ...opt('machine', p.one.machine) };
      }
      if (verb === 'down') {
        const p = flags(rest, ['because']);
        if (!p || p.pos.length !== 1 || !p.one.because) return null;
        return { op, verb, rig: p.pos[0]!, because: p.one.because };
      }
      if (verb === 'restart' || verb === 'handover') return rest.length === 1 && !rest[0]!.startsWith('--') ? { op, verb, seat: rest[0]! } : null;
      return null;
    }
    case 'send': {
      // The text is taken as is (it may start with `-`); the seat is checked by the daemon.
      if (args.length !== 2) return null;
      return { op, to: args[0]!, text: args[1]! };
    }
    case 'propose': {
      const [action, ...rest] = args;
      if (action === 'rig-launch') {
        const p = flags(rest, ['goal', 'spec', 'project', 'off-project', 'machine']);
        if (!p || p.pos.length || !p.one.goal || (p.one.project && p.one['off-project'])) return null;
        return { op, rigLaunch: { goal: p.one.goal, ...opt('spec', p.one.spec), ...opt('project', p.one.project), ...opt('off', p.one['off-project']), ...opt('machine', p.one.machine) } };
      }
      const id = ActionIdSchema.safeParse(action);
      const p = flags(rest, ['args']);
      if (!id.success || !p || p.pos.length || p.one.args === undefined) return null;
      let json: unknown;
      try { json = JSON.parse(p.one.args); } catch { return null; }
      if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
      return { op, action: id.data, args: json as Record<string, unknown> };
    }
    case 'remember': {
      const p = flags(args, ['from', 'category']);
      if (!p || p.pos.length !== 1 || !p.one.from) return null;
      const from = p.one.from.split(',').map(s => s.trim()).filter(Boolean);
      return from.length ? { op, text: p.pos[0]!, from, ...opt('category', p.one.category) } : null;
    }
  }
}

export interface BrainCommandDeps {
  /** Grace and decisions; null without OpenRig. */
  deciding: Pick<Deciding, 'decide' | 'ask'> | null;
  thread: Pick<LedgeThread, 'append' | 'get'>;
  /** Writing to a seat; null without OpenRig. */
  seatSend: { send(machine: string, seatRef: string, text: string): Promise<SeatSendResult> } | null;
  memory: Pick<Memory, 'propose' | 'rules' | 'decisions'>;
  rigs: () => Rig[];
  escalations: () => Escalation[];
  sessions: () => Session[];
  projects: () => Projects;
  chat: { post(turn: { qid: string; answer: string; actions?: ChatAction[]; rigLaunch?: ChatRigLaunch }, emit: (m: ChatMessage) => void): void };
  /** Where a posted turn's history goes (every local front). */
  emit: (m: ChatMessage) => void;
  /** The daemon's `rig.act` handler. */
  rigAct: (msg: RigActMsg) => Promise<RigResult>;
  /** The daemon's `rig.prepare` handler, without keeping the plan. */
  rigPrepare: (msg: RigPrepareMsg) => Promise<RigPlan | { code: RigResultCode; reason: string }>;
  now?: () => number;
  uuid?: () => string;
}

/** A rig's failure as a brain code (`rig_managed` and `unsupported` are not brain codes: failed). */
const brainCode = (c: RigResultCode): BrainResultCode =>
  c === 'rig_managed' || c === 'unsupported' ? 'failed' : c;
const fail = (code: BrainResultCode, line: string): BrainOutcome => ({ ok: false, code, line });
const OPENRIG_OFF = "OpenRig n'est pas branché : rien n'est parti.";

/**
 * What `ledge brain <op>` does, once the daemon knows the caller is the brain. Nothing here launches a rig: `rig up` and
 * `propose rig-launch` post a card the user clicks. `--because` user items are kept in memory once used (lost on restart).
 */
export function createBrainCommands(d: BrainCommandDeps): { run(call: BrainCall): Promise<BrainOutcome> } {
  const now = d.now ?? Date.now;
  const uuid = d.uuid ?? randomUUID;
  /** The user items a `rig up` / `rig down` already went through (or is going through). */
  const used = new Set<string>();

  /** Takes the user item for one up/down; null when it cannot authorise one. */
  const takeBecause = (id: string): boolean => {
    const item = d.thread.get(id);
    if (!item || item.kind !== 'user' || used.has(id)) return false;
    const age = now() - Date.parse(item.at);
    if (!(age >= 0 && age < BECAUSE_MS)) return false;
    used.add(id);
    return true;
  };

  /** A seat by `@address`, `@address@rig` or its OpenRig ref. */
  const seatOf = (word: string): { ok: true; rig: Rig; seat: RigSeat } | { ok: false; reason: string } => {
    if (word.startsWith('-')) return { ok: false, reason: `Siège invalide : ${word}` };
    if (word.startsWith('@')) return resolveSeatAddress(word, d.rigs());
    for (const rig of d.rigs()) { const seat = rig.seats.find(s => s.ref === word); if (seat) return { ok: true, rig, seat }; }
    return { ok: false, reason: `Aucun agent ne s'appelle ${word}` };
  };

  /** Posts a turn of cards and the bubble that names it in the thread. */
  const post = (answer: string, cards: { actions?: ChatAction[]; rigLaunch?: ChatRigLaunch }): void => {
    const qid = `brain-${uuid()}`;
    d.chat.post({ qid, answer, ...cards }, d.emit);
    d.thread.append({ kind: 'ledge', text: answer, qid });
  };

  /** Validates a launch card with `rig.prepare` when it names a spec on this machine; the reason it cannot go, or null. */
  const validate = async (card: ChatRigLaunch): Promise<BrainOutcome | null> => {
    let where: RigLaunchWhere;
    const machine = card.machine ?? 'local';
    if (card.project !== undefined) {
      const project = d.projects().projects.find(p => p.id === card.project);
      if (!project) return fail('invalid', `Projet inconnu : ${card.project}.`);
      const repo = project.repos.find(r => r.machine === machine)?.path;
      if (!repo) return fail('invalid', `Le projet ${project.name} n'a pas de dossier sur ${machine}.`);
      if (!card.spec) return null;
      where = { kind: 'project', projectId: project.id, repo, branch: `feat/${card.spec}`, copy: true };
    } else {
      if (!card.spec) return null;
      where = { kind: 'off-project', name: card.off ?? slugOfGoal(card.goal) };
    }
    // Another machine's plan is made by its own daemon, when the user opens the card.
    if (machine !== 'local') return null;
    const plan = await d.rigPrepare({ type: 'rig.prepare', rid: uuid(), machine, spec: card.spec, goal: card.goal, where });
    return 'code' in plan ? fail(brainCode(plan.code), `Plan refusé : ${plan.reason}.`) : null;
  };

  const launchCard = async (card: ChatRigLaunch): Promise<BrainOutcome> => {
    const bad = await validate(card);
    if (bad) return bad;
    const what = card.spec ? `le rig ${card.spec}` : 'un rig';
    const place = card.project ? ` dans ${card.project}` : card.off ? ` hors projet (${card.off})` : '';
    post(`Je propose de lancer ${what}${place} : ${card.goal}`, { rigLaunch: card });
    return { ok: true, line: "Carte « Lancer ce rig » posée : l'utilisateur la lance lui-même." };
  };

  async function run(c: BrainCall): Promise<BrainOutcome> {
    switch (c.op) {
      case 'say': {
        const text = c.text.trim();
        if (!text) return fail('invalid', 'Le message est vide.');
        d.thread.append({ kind: 'ledge', text });
        return { ok: true, line: 'Dit dans le fil.' };
      }
      case 'decide':
        if (!d.deciding) return fail('unreachable', OPENRIG_OFF);
        return d.deciding.decide(c.id, c.answers, c.category, { ...(c.rule ? { rule: c.rule } : {}), ...(c.why ? { why: c.why } : {}) });
      case 'ask':
        if (!d.deciding) return fail('unreachable', OPENRIG_OFF);
        return d.deciding.ask(c.id, c.category, c.advice);
      case 'rig': {
        if (c.verb === 'restart' || c.verb === 'handover') {
          const t = seatOf(c.seat); if (!t.ok) return fail('invalid', t.reason);
          const r = await d.rigAct({ type: 'rig.act', rid: uuid(), machine: t.rig.machine, seatRef: t.seat.ref, verb: c.verb });
          return r.ok ? { ok: true, line: `${c.verb === 'restart' ? 'Relance' : 'Relève'} de ${t.seat.address} demandée.` } : fail(brainCode(r.code), `Pas fait : ${r.reason ?? r.code}.`);
        }
        if (c.verb === 'down') {
          const rig = d.rigs().find(r => r.name === c.rig || r.id === c.rig);
          if (!rig) return fail('invalid', `Aucun rig ${c.rig}.`);
          if (!takeBecause(c.because)) return fail('refused', BECAUSE_REFUSED);
          const r = await d.rigAct({ type: 'rig.act', rid: uuid(), machine: rig.machine, rigId: rig.id, verb: 'down' }).catch(e => ({ ok: false as const, code: 'failed' as const, reason: (e as Error).message }));
          if (!r.ok) { used.delete(c.because); return fail(brainCode(r.code), `Pas fait : ${r.reason ?? r.code}.`); }
          return { ok: true, line: `Rig ${rig.name} arrêté.` };
        }
        if (!takeBecause(c.because)) return fail('refused', BECAUSE_REFUSED);
        const out = await launchCard({ spec: c.spec, goal: c.goal, ...(c.project ? { project: c.project } : {}), ...(c.off ? { off: c.off } : {}), ...(c.machine ? { machine: c.machine } : {}) })
          .catch(e => fail('failed', `Pas fait : ${(e as Error).message}.`));
        if (!out.ok) used.delete(c.because);
        return out;
      }
      case 'send': {
        const text = c.text.trim();
        if (!text) return fail('invalid', 'Le message est vide.');
        if (c.to.startsWith('-')) return fail('invalid', `Siège invalide : ${c.to}`);
        if (!d.seatSend) return fail('openrig_down', OPENRIG_OFF);
        const t = seatOf(c.to); if (!t.ok) return fail('invalid', t.reason);
        const r = await d.seatSend.send(t.rig.machine, t.seat.ref, text);
        return r.ok ? { ok: true, line: `Envoyé à ${r.to}.` } : fail('failed', r.reason);
      }
      case 'propose': {
        if ('rigLaunch' in c) return launchCard(c.rigLaunch).catch(e => fail('failed', `Pas fait : ${(e as Error).message}.`));
        const row = resolveRun(c.action, c.args, { sessions: d.sessions() });
        if ('refused' in row) return fail('invalid', `Proposition refusée : ${row.refused}.`);
        post(`Je propose : ${row.summary.replace(/\*\*/g, '')}`, { actions: [row] });
        return { ok: true, line: "Carte posée : l'utilisateur la valide lui-même." };
      }
      case 'remember': {
        const text = c.text.trim();
        if (!text) return fail('invalid', 'La règle est vide.');
        const known = d.memory.decisions();
        const from = c.from.map(id => known.find(x => x.id === id));
        const missing = c.from.filter((_, i) => !from[i]);
        if (missing.length) return fail('invalid', `Décisions inconnues : ${missing.join(', ')}.`);
        const cat = MandateCategorySchema.safeParse(c.category ?? from[0]!.category);
        if (!cat.success) return fail('invalid', `Catégorie inconnue : ${c.category}.`);
        const rule = d.memory.propose(text, cat.data, c.from.join(','));
        return { ok: true, line: `Règle ${rule.id} proposée : elle ne s'applique qu'une fois validée par l'utilisateur.` };
      }
      case 'who': return { ok: true, line: formatWho(d.sessions()) };
      case 'rigs': {
        const rigs = d.rigs();
        if (!rigs.length) return { ok: true, line: 'Aucun rig.' };
        return { ok: true, line: rigs.map(r => `${r.name} · ${r.lifecycle} · ${r.seats.map(s => `${s.address} (${s.state})`).join(', ') || 'aucun siège'}`).join('\n') };
      }
      case 'escalations': {
        const open = d.escalations().filter(e => e.state === 'pending' || e.state === 'grace');
        if (!open.length) return { ok: true, line: 'Aucune escalade en attente.' };
        /** `from@rig`, without repeating a rig its seat ref already names. */
        const origin = (e: Escalation): string => {
          const rig = e.rigId ? d.rigs().find(r => r.id === e.rigId)?.name ?? e.rigId : undefined;
          return !rig || e.from.endsWith(`@${rig}`) ? e.from : `${e.from}@${rig}`;
        };
        return { ok: true, line: open.map(e => `${e.id} · ${e.state} · ${e.category ?? '?'} · ${origin(e)} · ${oneLine(e.summary)}`).join('\n') };
      }
      case 'rules': {
        const rules = d.memory.rules();
        if (!rules.length) return { ok: true, line: 'Aucune règle.' };
        return { ok: true, line: rules.map(r => `${r.id} · ${r.status} · ${r.category} · ${oneLine(r.text)}`).join('\n') };
      }
    }
  }
  return { run };
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
