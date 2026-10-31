import { randomBytes } from 'node:crypto';
import { backendOf, givenByLedge, isArchived, LEDGE_GIVER, taskClosed, type ClientMessage, type ServerMessage, type Session, type Task, type TaskLogEntry, type Team } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Mailbox } from './mailbox.js';
import { noTeamReason } from './seat.js';
import { formatLedgeTask } from './crossSession.js';
import { bareName } from './peers.js';
import { jsonJournal, type Journal } from './journal.js';
import { log } from '../log.js';

type TaskCmd = Extract<ClientMessage, { type: 'task.cmd' }>;
type TaskResult = Extract<ServerMessage, { type: 'task.result' }>;
export type TasksJournal = Journal<Task[]>;

export interface TasksDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange'>;
  /** The mailbox's own lines: each pointer is typed at its target's next free moment. */
  mailbox: Pick<Mailbox, 'notify'>;
  journal?: TasksJournal;
  /** The live teams: `@role` names a seat of the giver's team (spec 2026-10-25 roles §3.6). */
  teams?: { get(id: string): Team | undefined; teamOf(session: string): Team | undefined };
  /** Every change of every task, with the log entry it wrote (none for `seen`): the fronts show it (§3.7, issue #92). */
  onTask?: (t: Task, entry?: TaskLogEntry) => void;
  now?: () => string;
  /** How long a session sits idle holding tasks before Ledge reminds it of them; PARKED_MS by default. */
  parkedMs?: number;
}
export interface Tasks {
  run(cmd: TaskCmd): TaskResult; all(): Task[];
  /** A team purged (issue #146): its tasks lose its id and stay their owner's and giver's, as any task out of a team. */
  forgetTeam(team: string): void;
  close(): void;
}

/** Closed tasks kept for `list --all` and `show`: a week, 300 at most. */
const CLOSED_TTL_MS = 7 * 24 * 3600 * 1000;
const CLOSED_MAX = 300;
/** A session idle this long with tasks it holds is « parked » (OpenRig's word): Ledge reminds it once per set of tasks. */
export const PARKED_MS = 15 * 60_000;
/** How much of a result or a reason the giver's pointer (and the sender's card) quotes. */
const QUOTE = 200;
export const quote = (s: string) => { const flat = s.trim().replace(/\s+/g, ' '); return flat.length > QUOTE ? `${flat.slice(0, QUOTE)}…` : flat; };

/** A session Ledge launched and can type into, live. */
const reachable = (s: Session | undefined): boolean =>
  !!s && s.source === 'launcher' && s.state !== 'exited' && !isArchived(s) && (!!s.tmuxSession || backendOf(s) === 'omp-rpc');

/**
 * Tasks between sessions (spec 2026-10-25 session tasks): given to a live session, taken, passed and closed by their
 * owner, each change the other side must know typed to it as a one-line `<ledge-task>` pointer. An owner that ends with
 * an open task drops it, and the giver is told. With a journal, tasks outlive the daemon.
 */
export function createTasks(d: TasksDeps): Tasks {
  const now = d.now ?? (() => new Date().toISOString());
  const tasks = new Map<string, Task>();
  for (const t of d.journal?.load() ?? []) tasks.set(t.id, t);

  const save = () => {
    const oldest = Date.parse(now()) - CLOSED_TTL_MS;
    const closed = [...tasks.values()].filter(taskClosed);
    for (const t of closed) if (Date.parse(t.updatedAt) < oldest) tasks.delete(t.id);
    const left = closed.filter(t => tasks.has(t.id));
    for (const t of left.slice(0, Math.max(0, left.length - CLOSED_MAX))) tasks.delete(t.id);
    d.journal?.save([...tasks.values()]);
  };
  const newId = (): string => { for (;;) { const id = `t${randomBytes(3).toString('hex')}`; if (!tasks.has(id)) return id; } };
  const live = (s: Session) => s.state !== 'exited' && !isArchived(s);
  /** The session `to` names: a Ledge name, a session id (the chat's cards), or `@role` in `team` (the giver's own team for a session). */
  const target = (to: string, team: Team | undefined, me?: Pick<Session, 'teamLeft'>): Session | string => {
    if (to.startsWith('@')) {
      const role = to.slice(1);
      if (!team) return noTeamReason(to, me);
      const held = team.seats.filter(x => x.role === role).map(x => (x.sessionId ? d.store.get(x.sessionId) : undefined)).filter((s): s is Session => !!s && live(s));
      if (held.length === 1) return held[0]!;
      const roles = [...new Set(team.seats.filter(x => x.sessionId && live(d.store.get(x.sessionId)!)).map(x => `@${x.role}`))];
      return held.length ? `plusieurs sessions tiennent ${to} dans ${team.name} : ${held.map(s => s.name).join(', ')}`
        : `personne ne tient ${to} dans l'équipe ${team.name}${roles.length ? ` (rôles tenus : ${roles.join(', ')})` : ''}`;
    }
    const name = bareName(to);
    return d.store.all().find(s => (s.name === name || s.id === to) && live(s)) ?? `aucune session Ledge nommée ${to}`;
  };
  const teamOf = (id: string) => d.teams?.teamOf(id);
  /** Who handed the task to whom: two sessions (or Ledge), as ids and as their names then. */
  const sides = (op: 'give' | 'pass' | 'done' | 'refuse' | 'cancel', from: Pick<Session, 'id' | 'name'>, to: Pick<Session, 'id' | 'name'>) =>
    ({ op, from: from.id, to: to.id, fromName: from.name, toName: to.name });
  const giverOf = (t: Task) => ({ id: t.giver, name: t.giverName });
  const ownerOf = (t: Task) => ({ id: t.owner, name: t.ownerName });
  type Transmission = Pick<TaskLogEntry, 'op' | 'from' | 'to' | 'fromName' | 'toName' | 'note'>;
  const put = (t: Task, by: string, what: string, tr: Transmission = {}): Task => {
    const entry: TaskLogEntry = { at: now(), by, what, ...tr };
    const next = { ...t, updatedAt: entry.at, log: [...t.log, entry] };
    tasks.set(t.id, next); save();
    d.onTask?.(next, entry);
    return next;
  };
  /** The owner's pointer: what the task is, and the commands that read and close it. */
  const tellOwner = (t: Task, from: string, lead: string) => d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from,
    text: `${lead} « ${t.title} ». Lis-la : ledge task show ${t.id} ; prends-la : ledge task take ${t.id} ; à la fin : ledge task done ${t.id} "résultat" (ou ledge task refuse ${t.id} "raison").` }), `${t.id}:${t.log.length}`);
  /** The giver's pointer: how its task ended. Ledge's own tasks are told to the fronts by `put`, never typed. */
  const tellGiver = (t: Task, from: string, what: string) => { if (!givenByLedge(t)) d.mailbox.notify(t.giver, formatLedgeTask({ id: t.id, from,
    text: `Tâche « ${t.title} » ${what} (ledge task show ${t.id})` }), `${t.id}:${t.log.length}`); };

  /** An owner that ends, or is removed, drops its open tasks: its giver can give them again. A decision it asked the user drops too. */
  const dropFor = (id: string) => {
    for (const t of [...tasks.values()]) {
      if (taskClosed(t)) continue;
      if (t.owner === LEDGE_GIVER && t.giver === id) { put({ ...t, state: 'dropped' }, 'Ledge', `${t.giverName} s'est terminée avant la réponse`, { op: 'drop' }); continue; }
      if (t.owner !== id) continue;
      const dropped = put({ ...t, state: 'dropped' }, 'Ledge', `${t.ownerName} s'est terminée sans la finir`, { op: 'drop' });
      log(`task ${t.id} dropped: ${t.ownerName} ended`);
      tellGiver(dropped, 'Ledge', `abandonnée : ${t.ownerName} s'est terminée sans la finir`);
    }
  };
  // What the last daemon left: an owner that ended meanwhile drops its tasks now.
  // A decision's owner is the user (Ledge): it waits for its asker instead.
  for (const id of new Set([...tasks.values()].filter(t => !taskClosed(t)).map(t => (t.owner === LEDGE_GIVER ? t.giver : t.owner)))) {
    const s = d.store.get(id);
    if (!s || s.state === 'exited') dropFor(id);
  }

  // Parked: a session idle with tasks it holds. Reminded once per set of tasks, so a lead waiting on its team is not woken each time it rests.
  const parkedMs = d.parkedMs ?? PARKED_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const remindedFor = new Map<string, string>();
  const heldBy = (id: string) => [...tasks.values()].filter(t => t.owner === id && !taskClosed(t));
  const setOf = (held: Task[]) => held.map(t => t.id).sort().join(',');
  const unpark = (id: string) => { const timer = timers.get(id); if (timer) { clearTimeout(timer); timers.delete(id); } };
  const park = (id: string) => {
    const s = d.store.get(id);
    if (!s || s.state !== 'idle' || timers.has(id) || !reachable(s)) return;
    const held = heldBy(id);
    if (!held.length || remindedFor.get(id) === setOf(held)) return;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const now_ = heldBy(id);
      if (d.store.get(id)?.state !== 'idle' || !now_.length || remindedFor.get(id) === setOf(now_)) return;
      remindedFor.set(id, setOf(now_));
      const list = now_.map(t => `${t.id} « ${t.title} » (${t.state === 'open' ? 'à prendre' : 'prise'})`).join(', ');
      d.mailbox.notify(id, formatLedgeTask({ id: now_[0]!.id, from: 'Ledge', text: `Tu es au repos et tu tiens encore ${list}. Prends ce qui est à prendre, termine (ledge task done <id> "<résultat>"), passe (ledge task pass) ou refuse ce que tu ne feras pas ; si tu attends quelqu'un, ne fais rien.` }), `park:${id}:${setOf(now_)}`);
    }, parkedMs));
  };
  for (const s of d.store.all()) park(s.id);
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    if (c.type === 'removed') { unpark(c.id); return dropFor(c.id); }
    if (c.session.state === 'exited') { unpark(c.session.id); return dropFor(c.session.id); }
    if (c.session.state === 'idle') park(c.session.id); else unpark(c.session.id);
  });

  function run(cmd: TaskCmd): TaskResult {
    const refuse = (reason: string): TaskResult => ({ type: 'task.result', rid: cmd.rid, reason });
    const ok = (task: Task): TaskResult => ({ type: 'task.result', rid: cmd.rid, task });
    // Ledge (the user, through a front) gives as `ledge`; a session gives as itself.
    const ledge = cmd.by === LEDGE_GIVER;
    const me: Pick<Session, 'id' | 'name'> | undefined = ledge ? { id: LEDGE_GIVER, name: 'Ledge' } : d.store.get(cmd.by);
    if (!me) return refuse('session inconnue');
    const team = cmd.team ? d.teams?.get(cmd.team) : undefined;
    if (cmd.team && !team) return refuse(`aucune équipe ${cmd.team}`);
    if (cmd.op === 'list') {
      // Ledge sees every task (the fronts show the seats' too, issue #92), or a team's; a session its own, or its team's when it names it.
      const mine = [...tasks.values()].filter(t => (team ? t.team === team.id : ledge || t.owner === me.id || t.giver === me.id) && (cmd.all || !taskClosed(t)));
      return { type: 'task.result', rid: cmd.rid, tasks: mine.sort((a, b) => a.at.localeCompare(b.at)) };
    }
    if (cmd.op === 'give') {
      if (!cmd.to || !cmd.title) return refuse('il faut un destinataire et un titre');
      // A decision for the user: Ledge holds it, nobody is typed to, the fronts show it; its answer (done) wakes the asker.
      if (cmd.to.trim().toLowerCase() === LEDGE_GIVER) {
        if (ledge) return refuse('tu ne peux pas te confier une tâche');
        const at = now(); const askerTeam = teamOf(me.id)?.id;
        const task: Task = { id: newId(), title: cmd.title.trim(), ...(cmd.text?.trim() ? { text: cmd.text.trim() } : {}), giver: me.id, giverName: me.name,
          owner: LEDGE_GIVER, ownerName: 'Ledge', ...(askerTeam ? { team: askerTeam } : {}), state: 'open', at, updatedAt: at,
          log: [{ at, by: me.name, what: 'confiée à Ledge (décision)', ...sides('give', me, { id: LEDGE_GIVER, name: 'Ledge' }) }] };
        tasks.set(task.id, task); save();
        d.onTask?.(task, task.log[0]);
        return ok(task);
      }
      const t = target(cmd.to, ledge ? team : teamOf(me.id), ledge ? undefined : d.store.get(me.id));
      if (typeof t === 'string') return refuse(t);
      if (t.id === me.id) return refuse('tu ne peux pas te confier une tâche');
      if (!reachable(t)) return refuse(`${t.name} n'a pas été lancée par Ledge : impossible de lui confier une tâche`);
      const at = now(); const ownerTeam = teamOf(t.id)?.id;
      const task: Task = { id: newId(), title: cmd.title.trim(), ...(cmd.text?.trim() ? { text: cmd.text.trim() } : {}), giver: me.id, giverName: me.name,
        owner: t.id, ownerName: t.name, ...(ownerTeam ? { team: ownerTeam } : {}), state: 'open', at, updatedAt: at,
        log: [{ at, by: me.name, what: `confiée à ${t.name}`, ...sides('give', me, t) }] };
      tasks.set(task.id, task); save();
      d.onTask?.(task, task.log[0]);
      tellOwner(task, me.name, `Tâche de ${me.name} :`);
      park(t.id);
      return ok(task);
    }
    if (!cmd.task) return refuse("il faut l'id de la tâche");
    const t = tasks.get(cmd.task);
    if (!t) return refuse(`aucune tâche ${cmd.task}`);
    const owner = t.owner === me.id; const giver = t.giver === me.id;
    // Ledge reads any task: « Où en est l'équipe » follows the tasks the seats gave each other too.
    if (cmd.op === 'show') return owner || giver || ledge ? ok(t) : refuse(`la tâche ${t.id} n'est ni à toi ni de toi`);
    if (cmd.op === 'seen') {
      if (!ledge || !giver) return refuse('seul Ledge range ses propres tâches');
      if (!taskClosed(t)) return refuse(`la tâche ${t.id} est encore ouverte`);
      if (t.seen) return ok(t);
      const seen = { ...t, seen: true }; tasks.set(t.id, seen); save(); d.onTask?.(seen);
      return ok(seen);
    }
    if (taskClosed(t)) return refuse(`la tâche ${t.id} est déjà close (${t.state})`);
    switch (cmd.op) {
      case 'take':
        if (!owner) return refuse(`la tâche ${t.id} est à ${t.ownerName}, pas à toi`);
        return ok(t.state === 'taken' ? t : put({ ...t, state: 'taken' }, me.name, 'prise', { op: 'take' }));
      case 'done': {
        if (!owner) return refuse(`seule la session qui la tient (${t.ownerName}) peut la terminer`);
        const result = cmd.text?.trim();
        // OpenRig's closure reason: a giver must learn what came of its task.
        if (!result) return refuse('il faut un résultat : ledge task done <id> "<ce qui est fait, où, tests>"');
        const done = put({ ...t, state: 'done', result }, me.name, `terminée : ${result}`, sides('done', ownerOf(t), giverOf(t)));
        tellGiver(done, me.name, `terminée par ${me.name} : ${quote(result)}`);
        return ok(done);
      }
      case 'refuse': {
        if (!owner && !giver) return refuse(`la tâche ${t.id} n'est ni à toi ni de toi`);
        const reason = cmd.text?.trim();
        if (!reason) return refuse('il faut une raison');
        const refused = put({ ...t, state: 'refused', result: reason }, me.name, `${owner ? 'refusée' : 'annulée'} : ${reason}`,
          owner ? sides('refuse', ownerOf(t), giverOf(t)) : sides('cancel', giverOf(t), ownerOf(t)));
        // The other side is told: the giver when its owner refuses, the owner when its giver cancels.
        if (owner) tellGiver(refused, me.name, `refusée par ${me.name} : ${quote(reason)}`);
        if (giver && !owner && t.owner !== LEDGE_GIVER) d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » annulée par ${me.name} : ${quote(reason)}. Arrête d'y travailler.` }), `${t.id}:${refused.log.length}`);
        return ok(refused);
      }
      case 'cancel': {
        // Its giver, or Ledge for any task (the user is the operator, action registry spec §6.3): closed as a giver's refusal is.
        if (!giver && !ledge) return refuse(`seul celui qui l'a confiée (${t.giverName}) peut l'annuler`);
        const reason = cmd.text?.trim();
        // Handed back from its giver to its owner, whoever cancels it: `by` keeps who did (as for a pass by Ledge).
        const cancelled = put({ ...t, state: 'refused', ...(reason ? { result: reason } : {}) }, me.name, `annulée${reason ? ` : ${reason}` : ''}`,
          sides('cancel', giverOf(t), ownerOf(t)));
        // A decision put to the user has nobody typing it: Ledge is not a session.
        if (t.owner !== LEDGE_GIVER) d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » annulée par ${me.name}${reason ? ` : ${quote(reason)}` : ''}. Arrête d'y travailler.` }), `${t.id}:${cancelled.log.length}`);
        // A task a seat gave another, cancelled by Ledge: its giver learns it too.
        if (!giver) tellGiver(cancelled, me.name, `annulée par ${me.name}${reason ? ` : ${quote(reason)}` : ''}`);
        return ok(cancelled);
      }
      case 'pass': {
        // Its giver too (a lead moving work between seats), without the cancel-and-give-again that loses its history; and Ledge.
        if (!owner && !giver && !ledge) return refuse(`seule la session qui la tient (${t.ownerName}) ou celle qui l'a confiée (${t.giverName}) peut la passer`);
        if (!cmd.to) return refuse('il faut le nom de la session à qui la passer');
        const next = target(cmd.to, teamOf(me.id), d.store.get(me.id));
        if (typeof next === 'string') return refuse(next);
        if (next.id === t.owner) return refuse(owner ? 'elle est déjà à toi' : `elle est déjà à ${t.ownerName}`);
        if (!reachable(next)) return refuse(`${next.name} n'a pas été lancée par Ledge : impossible de lui passer une tâche`);
        const note = cmd.text?.trim();
        // The giver stays: a task Ledge gave still comes back to Ledge, however the team passed it inside (§3.7).
        const nextTeam = teamOf(next.id)?.id;
        const { team: _team, ...rest } = t;
        const passed = put({ ...rest, ...(nextTeam ? { team: nextTeam } : {}), owner: next.id, ownerName: next.name, state: 'open' }, me.name, `passée à ${next.name}${note ? ` : ${note}` : ''}`,
          { ...sides('pass', ownerOf(t), next), ...(note ? { note } : {}) });
        tellOwner(passed, me.name, `Tâche passée par ${me.name}${note ? ` (${quote(note)})` : ''}, confiée par ${t.giverName} :`);
        park(next.id);
        // Passed over its owner's head (by its giver or by Ledge): the one who held it stops.
        if (!owner) d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » passée à ${next.name} par ${me.name}. Arrête d'y travailler.` }), `${t.id}:${passed.log.length}:from`);
        return ok(passed);
      }
    }
    return refuse('opération inconnue');
  }

  const forgetTeam = (team: string) => {
    const held = [...tasks.values()].filter(t => t.team === team);
    if (!held.length) return;
    // No log entry: the task did not change hands, only lost a team no one can name any more (like `seen`, fronts told without one).
    const out = held.map(({ team: _team, ...rest }) => rest);
    for (const t of out) tasks.set(t.id, t);
    save();
    for (const t of out) d.onTask?.(t);
  };
  return { run, all: () => [...tasks.values()].sort((a, b) => a.at.localeCompare(b.at)), forgetTeam, close: () => { unsubscribe(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); } };
}

export function tasksJournal(path: string): TasksJournal & { flush(): Promise<void> } {
  return jsonJournal<Task[]>(path, 'tasks', raw => (Array.isArray(raw) ? raw as Task[] : undefined));
}
