import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { RoleIdSchema, SeatsSchema, ToolSchema, type ActionId, type Seat, type Session, type Team } from '@ledge/protocol';
import { connect } from '../client.js';
import { listDefinitions } from '../daemon/teams.js';
import { actionArgs, callerOf, DAEMON_DOWN, resultLine, runOnClient, type ActionResult, type Caller } from './action.js';

export const TEAM_USAGE = `ledge team up <modèle> [--cwd <dossier>] [--name <nom>]   lancer une équipe d'après .ledge/teams/<modèle>.yaml
ledge team up --seat <rôle>[:<outil>]… [--cwd <dossier>] [--name <nom>]   lancer une équipe de sièges ad hoc
ledge team list [--cwd <dossier>]                           les modèles, les rôles et les équipes en cours
ledge team join <équipe> <session> <@rôle>                  faire entrer une session dans une équipe, à un rôle
ledge team leave <équipe> <session>                         faire sortir une session d'une équipe (elle continue)
ledge team resume <équipe>                                  reprendre une équipe au repos
ledge team dissolve <équipe> [--close-sessions] --yes       dissoudre une équipe (irréversible) ; ses sessions restent, ou se ferment
ledge team save <équipe> <nom>                              enregistrer une équipe en cours comme modèle
--json : une ligne JSON, pour un agent ou un script. Une session agent peut se fermer et quitter son équipe ;
l'@leader d'une équipe peut aussi la dissoudre, en retirer un membre ou en fermer une session. Le reste revient à l'utilisateur.`;
/** A team's seats start one after the other: the launch may take a while. */
const UP_MS = 60_000;

export type TeamCmd =
  | { op: 'up'; template?: string; seats?: Seat[]; cwd?: string; name?: string; json?: true }
  | { op: 'list'; cwd?: string; json?: true }
  | { op: 'run'; action: ActionId; args: Record<string, unknown>; closeSessions?: true; yes?: true; json?: true };

/** Each verb that is a registry action: its id and how its positional arguments fill the action's args. */
/** Each verb that is a registry action: its id and how its positional arguments fill the action's args. The chat and the registry
 *  no longer hold a team action (lot 1, task 2), so no verb remains; the whole `ledge team` goes in task 6a. */
const VERBS: Record<string, { action: ActionId; args: (p: string[]) => Record<string, unknown> | undefined; n: number }> = {};

/** A seat as `--seat role[:tool]` writes it. */
function seatOf(v: string): Seat | undefined {
  const [role, tool, ...more] = v.split(':');
  if (more.length || !RoleIdSchema.safeParse(role).success || (tool !== undefined && !ToolSchema.safeParse(tool).success)) return undefined;
  return { role: role!, ...(tool !== undefined ? { tool: tool as Seat['tool'] } : {}) };
}

/** The arguments of `ledge team`, or `undefined` when they do not fit its usage. */
export function teamArgs(args: string[]): TeamCmd | undefined {
  const [op, ...rest] = args;
  const positional: string[] = []; const seats: Seat[] = [];
  let cwd: string | undefined; let name: string | undefined; let json = false; let yes = false; let closeSessions = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--cwd') { cwd = rest[++i]; if (!cwd) return undefined; }
    else if (a === '--name') { name = rest[++i]; if (!name) return undefined; }
    else if (a === '--seat') { const s = seatOf(rest[++i] ?? ''); if (!s) return undefined; seats.push(s); }
    else if (a === '--json') json = true;
    else if (a === '--yes') yes = true;
    else if (a === '--close-sessions') closeSessions = true;
    else if (a.startsWith('--')) return undefined;
    else positional.push(a);
  }
  const j = json ? { json: true as const } : {};
  const where = { ...(cwd ? { cwd } : {}), ...(name ? { name } : {}) };
  if (op === 'up' && !yes && !closeSessions) {
    if (positional.length === 1 && !seats.length) return { op, template: positional[0]!, ...where, ...j };
    if (positional.length === 0 && seats.length && SeatsSchema.safeParse(seats).success) return { op, seats, ...where, ...j };
    return undefined;
  }
  if (op === 'list') return positional.length === 0 && !name && !seats.length && !yes && !closeSessions ? { op, ...(cwd ? { cwd } : {}), ...j } : undefined;
  const verb = op ? VERBS[op] : undefined;
  if (!verb || positional.length !== verb.n || cwd || name || seats.length || (closeSessions && op !== 'dissolve')) return undefined;
  const parsed = actionArgs(verb.action, verb.args(positional)!);
  if (!parsed) return undefined;
  return { op: 'run', action: verb.action, args: parsed, ...(closeSessions ? { closeSessions: true as const } : {}), ...(yes ? { yes: true as const } : {}), ...j };
}

const STATE: Record<Team['state'], string> = { active: 'active', resting: 'au repos', dissolved: 'dissoute' };

/** A live team in one block: its head, then each seat with the session that holds it. */
export function formatTeam(t: Team, sessions: readonly Session[]): string {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return [`${t.id}  ${t.name}  ${STATE[t.state]}  ${t.cwd}`, ...t.seats.map(seat => {
    const s = seat.sessionId ? byId.get(seat.sessionId) : undefined;
    return `  @${seat.role.padEnd(12)} ${s ? `${s.name} (${s.tool}, ${s.state})` : 'libre'}`;
  })].join('\n');
}

/** A live team for an agent: its seats with the session that holds each (name, tool, state). */
function teamJson(t: Team, sessions: readonly Session[]) {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return { ...t, seats: t.seats.map(seat => {
    const s = seat.sessionId ? byId.get(seat.sessionId) : undefined;
    return { ...seat, ...(s ? { session: { name: s.name, tool: s.tool, state: s.state } } : {}) };
  }) };
}

/**
 * `ledge team …`: `up` asks the daemon to launch a template's team or ad hoc seats; `list` reads the definitions and the live
 * teams; every other verb is a registry action (`action.run`), run as the session in the environment, or as the user.
 */
export async function runTeam(args: string[], opts: { port?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const parsed = teamArgs(args);
  if (!parsed) return { line: TEAM_USAGE, code: args.length ? 1 : 0 };
  if (parsed.op === 'run') return runVerb(parsed, opts.port, callerOf(opts.env ?? process.env));
  const cwd = resolve(opts.cwd ?? process.cwd(), parsed.cwd ?? '.');
  if (parsed.op === 'list') {
    const defs = listDefinitions(cwd);
    const lines = ['MODÈLES', ...(defs.templates.length ? defs.templates.map(t => `  ${t.id.padEnd(16)} ${t.name} · ${t.seats.map(s => `@${s.role}`).join(' ')} (${t.source})`) : ['  aucun (~/.ledge/teams/<id>.yaml)']),
      '', 'RÔLES', ...(defs.roles.length ? defs.roles.map(r => `  @${r.id.padEnd(15)} ${r.label}${r.tool ? ` · ${r.tool}` : ''}${r.autonomy && r.autonomy !== 'ask' ? ` · autonomie ${r.autonomy}` : ''} (${r.source})`) : ['  aucun (~/.ledge/roles/<id>.md)']),
      ...(defs.problems.length ? ['', 'IGNORÉS', ...defs.problems.map(p => `  ${p.path} : ${p.reason}`)] : [])];
    const json = (teams: unknown) => ({ line: JSON.stringify({ ...defs, teams }), code: 0 });
    let client;
    try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
    catch { return parsed.json ? json(null) : { line: [...lines, '', 'ÉQUIPES', `  ${DAEMON_DOWN}`].join('\n'), code: 0 }; }
    try {
      const snapshot = await client.next('snapshot');
      const teams = (await client.next('teams').catch(() => ({ teams: [] as Team[] }))).teams.filter(t => t.state !== 'dissolved');
      if (parsed.json) return json(teams.map(t => teamJson(t, snapshot.sessions)));
      return { line: [...lines, '', 'ÉQUIPES', ...(teams.length ? teams.map(t => formatTeam(t, snapshot.sessions)) : ['  aucune'])].join('\n'), code: 0 };
    } finally { await client.close(); }
  }
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  try {
    const rid = randomUUID();
    client.send({ type: 'team.launch', rid, cwd, ...(parsed.template ? { template: parsed.template } : {}), ...(parsed.seats ? { seats: parsed.seats } : {}), ...(parsed.name ? { name: parsed.name } : {}) });
    const r = await Promise.race([client.next('team.launched', UP_MS), client.next('team.failed', UP_MS)]);
    const snapshot = await client.next('snapshot', 500).catch(() => undefined);
    if (r.type === 'team.failed') {
      if (parsed.json) return { line: JSON.stringify({ ok: false, reason: r.reason, ...(r.team ? { team: teamJson(r.team, snapshot?.sessions ?? []) } : {}) }), code: 1 };
      return { line: `refusé : ${r.reason}${r.team ? `\n${formatTeam(r.team, snapshot?.sessions ?? [])}` : ''}`, code: 1 };
    }
    client.send({ type: 'snapshot.request' });
    const fresh = await client.next('snapshot', 1500).catch(() => snapshot);
    if (parsed.json) return { line: JSON.stringify({ ok: true, team: teamJson(r.team, fresh?.sessions ?? []) }), code: 0 };
    return { line: `équipe ${r.team.name} lancée\n${formatTeam(r.team, fresh?.sessions ?? [])}`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}

/**
 * A verb that is a registry action. `dissolve --close-sessions` is several in a row, so that each is still allowed when it runs:
 * the dissolve asked first without applying it (refused, nothing is closed), then the other seats' live sessions closed cleanly,
 * the team dissolved, and the caller's own session last (its `@leader` rights end with the team, not its right to close itself).
 */
async function runVerb(cmd: Extract<TeamCmd, { op: 'run' }>, port: number | undefined, by: Caller | undefined): Promise<{ line: string; code: number }> {
  let client;
  try { client = await connect({ port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  try {
    if (!cmd.closeSessions || !cmd.yes) return resultLine(await runOnClient(client, cmd.action, cmd.args, { by, confirmed: cmd.yes }), cmd.json);
    const snapshot = await client.next('snapshot', 1500);
    const teams = (await client.next('teams', 1500).catch(() => ({ teams: [] as Team[] }))).teams;
    // Unconfirmed, a dissolve the caller may run answers `confirm_required` with its row; anything else is the answer.
    const asked = await runOnClient(client, cmd.action, cmd.args, { by });
    if (asked.code !== 'confirm_required') return resultLine(asked, cmd.json);
    const team = teams.find(t => t.id === (asked.row as { team?: string } | undefined)?.team);
    const live = (team?.seats ?? []).flatMap(seat => {
      const s = snapshot.sessions.find(x => x.id === seat.sessionId);
      return s && s.state !== 'exited' && s.source !== 'hook_only' ? [s] : [];
    });
    const self = live.find(s => s.id === by?.by);
    const lines: string[] = [];
    const step = async (r: ActionResult): Promise<boolean> => { const l = resultLine(r, cmd.json); lines.push(l.line); return l.code === 0; };
    for (const s of live) if (s !== self && !(await step(await runOnClient(client, 'session.close', { session: s.id }, { by })))) return { line: lines.join('\n'), code: 1 };
    if (!(await step(await runOnClient(client, cmd.action, cmd.args, { by, confirmed: true })))) return { line: lines.join('\n'), code: 1 };
    if (self && !(await step(await runOnClient(client, 'session.close', { session: self.id }, { by })))) return { line: lines.join('\n'), code: 1 };
    return { line: lines.join('\n'), code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
