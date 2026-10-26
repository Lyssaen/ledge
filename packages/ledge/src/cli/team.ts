import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Session, Team } from '@ledge/protocol';
import { connect } from '../client.js';
import { listDefinitions } from '../daemon/teams.js';

export const TEAM_USAGE = `ledge team up <modèle> [--cwd <dossier>] [--name <nom>]   lancer une équipe d'après .ledge/teams/<modèle>.yaml
ledge team list [--cwd <dossier>]                           les modèles, les rôles et les équipes en cours`;
/** A team's seats start one after the other: the launch may take a while. */
const UP_MS = 60_000;

const DAEMON_DOWN = 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)';

/** The arguments of `ledge team`, or `undefined` when they do not fit its usage. */
export function teamArgs(args: string[]): { op: 'up'; template: string; cwd?: string; name?: string } | { op: 'list'; cwd?: string } | undefined {
  const [op, ...rest] = args;
  const positional: string[] = []; let cwd: string | undefined; let name: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cwd') { cwd = rest[++i]; if (!cwd) return undefined; }
    else if (rest[i] === '--name') { name = rest[++i]; if (!name) return undefined; }
    else positional.push(rest[i]!);
  }
  if (op === 'up' && positional.length === 1) return { op, template: positional[0]!, ...(cwd ? { cwd } : {}), ...(name ? { name } : {}) };
  if (op === 'list' && positional.length === 0 && !name) return { op, ...(cwd ? { cwd } : {}) };
  return undefined;
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

/** `ledge team …`: `up` asks the daemon to launch a template's team; `list` reads the definitions and the live teams. */
export async function runTeam(args: string[], opts: { port?: number; cwd?: string } = {}): Promise<{ line: string; code: number }> {
  const parsed = teamArgs(args);
  if (!parsed) return { line: TEAM_USAGE, code: args.length ? 1 : 0 };
  const cwd = resolve(opts.cwd ?? process.cwd(), parsed.cwd ?? '.');
  if (parsed.op === 'list') {
    const defs = listDefinitions(cwd);
    const lines = ['MODÈLES', ...(defs.templates.length ? defs.templates.map(t => `  ${t.id.padEnd(16)} ${t.name} · ${t.seats.map(s => `@${s.role}`).join(' ')} (${t.source})`) : ['  aucun (~/.ledge/teams/<id>.yaml)']),
      '', 'RÔLES', ...(defs.roles.length ? defs.roles.map(r => `  @${r.id.padEnd(15)} ${r.label}${r.tool ? ` · ${r.tool}` : ''}${r.autonomy && r.autonomy !== 'ask' ? ` · autonomie ${r.autonomy}` : ''} (${r.source})`) : ['  aucun (~/.ledge/roles/<id>.md)']),
      ...(defs.problems.length ? ['', 'IGNORÉS', ...defs.problems.map(p => `  ${p.path} : ${p.reason}`)] : [])];
    let client;
    try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
    catch { return { line: [...lines, '', 'ÉQUIPES', `  ${DAEMON_DOWN}`].join('\n'), code: 0 }; }
    try {
      const snapshot = await client.next('snapshot');
      const teams = (await client.next('teams').catch(() => ({ teams: [] as Team[] }))).teams.filter(t => t.state !== 'dissolved');
      return { line: [...lines, '', 'ÉQUIPES', ...(teams.length ? teams.map(t => formatTeam(t, snapshot.sessions)) : ['  aucune'])].join('\n'), code: 0 };
    } finally { await client.close(); }
  }
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  try {
    const rid = randomUUID();
    client.send({ type: 'team.launch', rid, cwd, template: parsed.template, ...(parsed.name ? { name: parsed.name } : {}) });
    const r = await Promise.race([client.next('team.launched', UP_MS), client.next('team.failed', UP_MS)]);
    const snapshot = await client.next('snapshot', 500).catch(() => undefined);
    if (r.type === 'team.failed') return { line: `refusé : ${r.reason}${r.team ? `\n${formatTeam(r.team, snapshot?.sessions ?? [])}` : ''}`, code: 1 };
    client.send({ type: 'snapshot.request' });
    const fresh = await client.next('snapshot', 1500).catch(() => snapshot);
    return { line: `équipe ${r.team.name} lancée\n${formatTeam(r.team, fresh?.sessions ?? [])}`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
