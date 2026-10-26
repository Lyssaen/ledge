import { randomBytes } from 'node:crypto';
import { backendOf, givenByLedge, isArchived, LEDGE_GIVER, taskClosed, type ClientMessage, type ServerMessage, type Session, type Task, type Team } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Mailbox } from './mailbox.js';
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
  /** Every change of a task Ledge gave: its outcome reaches the fronts, never a terminal (§3.7). */
  onLedgeTask?: (t: Task) => void;
  now?: () => string;
}
export interface Tasks { run(cmd: TaskCmd): TaskResult; all(): Task[]; close(): void }

/** Closed tasks kept for `list --all` and `show`: a week, 300 at most. */
const CLOSED_TTL_MS = 7 * 24 * 3600 * 1000;
const CLOSED_MAX = 300;
/** How much of a result or a reason the giver's pointer quotes. */
const QUOTE = 200;
const quote = (s: string) => { const flat = s.trim().replace(/\s+/g, ' '); return flat.length > QUOTE ? `${flat.slice(0, QUOTE)}…` : flat; };

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
  const target = (to: string, team: Team | undefined): Session | string => {
    if (to.startsWith('@')) {
      const role = to.slice(1);
      if (!team) return `${to} n'existe que dans une équipe`;
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
  const put = (t: Task, by: string, what: string): Task => {
    const at = now(); const next = { ...t, updatedAt: at, log: [...t.log, { at, by, what }] };
    tasks.set(t.id, next); save();
    if (givenByLedge(next)) d.onLedgeTask?.(next);
    return next;
  };
  /** The owner's pointer: what the task is, and the commands that read and close it. */
  const tellOwner = (t: Task, from: string, lead: string) => d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from,
    text: `${lead} « ${t.title} ». Lis-la : ledge task show ${t.id} ; prends-la : ledge task take ${t.id} ; à la fin : ledge task done ${t.id} "résultat" (ou ledge task refuse ${t.id} "raison").` }), `${t.id}:${t.log.length}`);
  /** The giver's pointer: how its task ended. Ledge's own tasks are told to the fronts by `put`, never typed. */
  const tellGiver = (t: Task, from: string, what: string) => { if (!givenByLedge(t)) d.mailbox.notify(t.giver, formatLedgeTask({ id: t.id, from,
    text: `Tâche « ${t.title} » ${what} (ledge task show ${t.id})` }), `${t.id}:${t.log.length}`); };

  /** An owner that ends, or is removed, drops its open tasks: its giver can give them again. */
  const dropFor = (id: string) => {
    for (const t of [...tasks.values()]) {
      if (t.owner !== id || taskClosed(t)) continue;
      const dropped = put({ ...t, state: 'dropped' }, 'Ledge', `${t.ownerName} s'est terminée sans la finir`);
      log(`task ${t.id} dropped: ${t.ownerName} ended`);
      tellGiver(dropped, 'Ledge', `abandonnée : ${t.ownerName} s'est terminée sans la finir`);
    }
  };
  // What the last daemon left: an owner that ended meanwhile drops its tasks now.
  for (const owner of new Set([...tasks.values()].filter(t => !taskClosed(t)).map(t => t.owner))) {
    const s = d.store.get(owner);
    if (!s || s.state === 'exited') dropFor(owner);
  }
  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    if (c.type === 'removed') return dropFor(c.id);
    if (c.session.state === 'exited') dropFor(c.session.id);
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
      // Ledge sees its own tasks, or a team's; a session its own, or its team's when it names it.
      const mine = [...tasks.values()].filter(t => (team ? t.team === team.id : t.owner === me.id || t.giver === me.id) && (cmd.all || !taskClosed(t)));
      return { type: 'task.result', rid: cmd.rid, tasks: mine.sort((a, b) => a.at.localeCompare(b.at)) };
    }
    if (cmd.op === 'give') {
      if (!cmd.to || !cmd.title) return refuse('il faut un destinataire et un titre');
      const t = target(cmd.to, ledge ? team : teamOf(me.id));
      if (typeof t === 'string') return refuse(t);
      if (t.id === me.id) return refuse('tu ne peux pas te confier une tâche');
      if (!reachable(t)) return refuse(`${t.name} n'a pas été lancée par Ledge : impossible de lui confier une tâche`);
      const at = now(); const ownerTeam = teamOf(t.id)?.id;
      const task: Task = { id: newId(), title: cmd.title.trim(), ...(cmd.text?.trim() ? { text: cmd.text.trim() } : {}), giver: me.id, giverName: me.name,
        owner: t.id, ownerName: t.name, ...(ownerTeam ? { team: ownerTeam } : {}), state: 'open', at, updatedAt: at, log: [{ at, by: me.name, what: `confiée à ${t.name}` }] };
      tasks.set(task.id, task); save();
      if (ledge) d.onLedgeTask?.(task);
      tellOwner(task, me.name, `Tâche de ${me.name} :`);
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
      const seen = { ...t, seen: true }; tasks.set(t.id, seen); save(); d.onLedgeTask?.(seen);
      return ok(seen);
    }
    if (taskClosed(t)) return refuse(`la tâche ${t.id} est déjà close (${t.state})`);
    switch (cmd.op) {
      case 'take':
        if (!owner) return refuse(`la tâche ${t.id} est à ${t.ownerName}, pas à toi`);
        return ok(t.state === 'taken' ? t : put({ ...t, state: 'taken' }, me.name, 'prise'));
      case 'done': {
        if (!owner) return refuse(`seule la session qui la tient (${t.ownerName}) peut la terminer`);
        const result = cmd.text?.trim();
        const done = put({ ...t, state: 'done', ...(result ? { result } : {}) }, me.name, result ? `terminée : ${result}` : 'terminée');
        tellGiver(done, me.name, `terminée par ${me.name}${result ? ` : ${quote(result)}` : ''}`);
        return ok(done);
      }
      case 'refuse': {
        if (!owner && !giver) return refuse(`la tâche ${t.id} n'est ni à toi ni de toi`);
        const reason = cmd.text?.trim();
        if (!reason) return refuse('il faut une raison');
        const refused = put({ ...t, state: 'refused', result: reason }, me.name, `${owner ? 'refusée' : 'annulée'} : ${reason}`);
        // The other side is told: the giver when its owner refuses, the owner when its giver cancels.
        if (owner) tellGiver(refused, me.name, `refusée par ${me.name} : ${quote(reason)}`);
        if (giver && !owner) d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » annulée par ${me.name} : ${quote(reason)}. Arrête d'y travailler.` }), `${t.id}:${refused.log.length}`);
        return ok(refused);
      }
      case 'cancel': {
        // Its giver, or Ledge for any task (the user is the operator, action registry spec §6.3): closed as a giver's refusal is.
        if (!giver && !ledge) return refuse(`seul celui qui l'a confiée (${t.giverName}) peut l'annuler`);
        const reason = cmd.text?.trim();
        const cancelled = put({ ...t, state: 'refused', ...(reason ? { result: reason } : {}) }, me.name, `annulée${reason ? ` : ${reason}` : ''}`);
        d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » annulée par ${me.name}${reason ? ` : ${quote(reason)}` : ''}. Arrête d'y travailler.` }), `${t.id}:${cancelled.log.length}`);
        // A task a seat gave another, cancelled by Ledge: its giver learns it too.
        if (!giver) tellGiver(cancelled, me.name, `annulée par ${me.name}${reason ? ` : ${quote(reason)}` : ''}`);
        return ok(cancelled);
      }
      case 'pass': {
        if (!owner && !ledge) return refuse(`seule la session qui la tient (${t.ownerName}) peut la passer`);
        if (!cmd.to) return refuse('il faut le nom de la session à qui la passer');
        const next = target(cmd.to, teamOf(me.id));
        if (typeof next === 'string') return refuse(next);
        if (next.id === t.owner) return refuse(owner ? 'elle est déjà à toi' : `elle est déjà à ${t.ownerName}`);
        if (!reachable(next)) return refuse(`${next.name} n'a pas été lancée par Ledge : impossible de lui passer une tâche`);
        const note = cmd.text?.trim();
        // The giver stays: a task Ledge gave still comes back to Ledge, however the team passed it inside (§3.7).
        const nextTeam = teamOf(next.id)?.id;
        const { team: _team, ...rest } = t;
        const passed = put({ ...rest, ...(nextTeam ? { team: nextTeam } : {}), owner: next.id, ownerName: next.name, state: 'open' }, me.name, `passée à ${next.name}${note ? ` : ${note}` : ''}`);
        tellOwner(passed, me.name, `Tâche passée par ${me.name}${note ? ` (${quote(note)})` : ''}, confiée par ${t.giverName} :`);
        // Passed by Ledge over its owner's head: the one who held it stops.
        if (!owner) d.mailbox.notify(t.owner, formatLedgeTask({ id: t.id, from: me.name, text: `Tâche « ${t.title} » passée à ${next.name} par ${me.name}. Arrête d'y travailler.` }), `${t.id}:${passed.log.length}:from`);
        return ok(passed);
      }
    }
    return refuse('opération inconnue');
  }

  return { run, all: () => [...tasks.values()].sort((a, b) => a.at.localeCompare(b.at)), close: unsubscribe };
}

export function tasksJournal(path: string): TasksJournal & { flush(): Promise<void> } {
  return jsonJournal<Task[]>(path, 'tasks', raw => (Array.isArray(raw) ? raw as Task[] : undefined));
}
