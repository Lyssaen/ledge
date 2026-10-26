import { describe, it, expect } from 'vitest';
import { actionById, ChatActionSchema, NOTE_MAX, pendingKey, TASK_TEXT_MAX, TASK_TITLE_MAX, type ActionId, type ChatAction, type Pending, type Role, type Session, type Task, type Team } from '@ledge/protocol';
import { actionMessage, GENERIC_ACTIONS, resolveAction, type ResolveCtx } from '../src/daemon/actions.js';

const T0 = '2026-10-26T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/api', project: 'api', title: `${name} · api`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
const team = (extra: Partial<Team> = {}): Team => ({ id: 'team-3fa2', name: 'api', project: 'api', machine: 'local', cwd: '/w/api', state: 'active',
  seats: [{ role: 'dev-back', sessionId: 'nova' }, { role: 'rev-back', sessionId: 'lu' }], createdAt: T0, updatedAt: T0, ...extra });
const task = (extra: Partial<Task> = {}): Task => ({ id: 't91b0d4', title: 'Pagination', giver: 'ledge', giverName: 'Ledge', owner: 'nova', ownerName: 'Nova',
  state: 'taken', at: T0, updatedAt: T0, log: [], ...extra });
const role = (id: string): Role => ({ id, label: id, prompt: '', source: 'home', path: `/h/${id}.md` });
const permission: Pending = { kind: 'permission', text: 'Bash: rm -rf dist', tool: 'Bash', source: 'hook' };

const ctx = (over: Partial<ResolveCtx> = {}): ResolveCtx => ({
  sessions: [mk('nova', 'Nova', { model: 'claude-sonnet-5-5', pending: permission, state: 'waiting_permission' }), mk('lu', 'Lu', { tool: 'codex' }), mk('bix', 'Bix'),
    mk('old', 'Old', { state: 'exited' }), mk('ro', 'Ro', { source: 'hook_only' }), mk('arch', 'Arch', { state: 'exited', archivedAt: T0 })],
  teams: [team(), team({ id: 'team-77aa', name: 'nap', state: 'resting', seats: [] }), team({ id: 'team-dead', name: 'old', state: 'dissolved' })],
  tasks: [task(), task({ id: 'tdone00', state: 'done' })],
  findRole: id => (['dev-back', 'rev-back'].includes(id) ? role(id) : undefined),
  ...over
});
const ok = (id: ActionId, args: unknown, c = ctx()): ChatAction => {
  const r = resolveAction(id, actionById(id)!.args.parse(args), c);
  if ('refused' in r) throw new Error(`refused: ${r.refused}`);
  return r;
};
const code = (id: ActionId, args: unknown, c = ctx()): string => {
  const r = resolveAction(id, actionById(id)!.args.parse(args), c);
  return 'refused' in r ? r.code : 'resolved';
};
const refused = (id: ActionId, args: unknown, c = ctx()): string => {
  const r = resolveAction(id, actionById(id)!.args.parse(args), c);
  return 'refused' in r ? r.refused : `resolved: ${r.summary}`;
};

describe('resolveAction', () => {
  it('covers every generic action of the registry', () => {
    expect([...GENERIC_ACTIONS].sort()).toEqual(['session.archive', 'session.decide', 'session.interrupt', 'session.model', 'session.restore', 'session.resume',
      'task.cancel', 'task.pass', 'team.dissolve', 'team.join', 'team.leave', 'team.resume', 'team.save']);
  });
  it('names a session by id or by bot name, and refuses an unknown or ambiguous one', () => {
    expect(ok('session.interrupt', { session: 'Bix' }).args).toEqual({ session: 'bix' });
    expect(ok('session.interrupt', { session: 'bix' }).args).toEqual({ session: 'bix' });
    expect(refused('session.interrupt', { session: 'Zed' })).toBe('unknown session Zed');
    const twins = ctx({ sessions: [mk('a', 'Twin'), mk('b', 'Twin')] });
    expect(refused('session.interrupt', { session: 'Twin' }, twins)).toBe('several sessions named Twin');
    // A live session wins over an ended one of the same name.
    expect(ok('session.interrupt', { session: 'Twin' }, ctx({ sessions: [mk('a', 'Twin', { state: 'exited' }), mk('b', 'Twin')] })).args).toEqual({ session: 'b' });
  });
  it('session.model: a writable running session, a change, the summary', () => {
    const r = ok('session.model', { session: 'Nova', model: 'claude-opus-5-5', effort: 'high' });
    expect(r).toMatchObject({ action: 'session.model', args: { session: 'nova', model: 'claude-opus-5-5', effort: 'high' }, risk: 'reversible', session: 'nova', summary: 'Passer **Nova** sur claude-opus-5-5, effort high' });
    expect(ok('session.model', { session: 'Nova', model: null, effort: null }).summary).toBe('Passer **Nova** sur son modèle et son effort par défaut');
    expect(refused('session.model', { session: 'Bix', model: null, effort: null })).toBe('Bix already runs that model');
    expect(refused('session.model', { session: 'Nova', model: 'claude-sonnet-5-5', effort: null })).toBe('Nova already runs that model');
    expect(refused('session.model', { session: 'Ro', model: 'opus', effort: null })).toBe('Ro is read-only');
    expect(refused('session.model', { session: 'Old', model: 'opus', effort: null })).toBe('Old has exited');
  });
  it('session.interrupt needs a terminal or OMP', () => {
    expect(refused('session.interrupt', { session: 'x' }, ctx({ sessions: [mk('x', 'X', { tmuxSession: undefined })] }))).toBe('X has no terminal');
    expect(ok('session.interrupt', { session: 'x' }, ctx({ sessions: [mk('x', 'X', { tmuxSession: undefined, backend: 'omp-rpc' })] })).summary).toBe('Interrompre **X**');
  });
  it('archive, restore, resume follow the archive and the state', () => {
    expect(ok('session.archive', { session: 'Old' }).summary).toBe('Archiver **Old**');
    expect(refused('session.archive', { session: 'Arch' })).toBe('Arch is already archived');
    expect(ok('session.restore', { session: 'Arch' }).args).toEqual({ session: 'arch' });
    expect(refused('session.restore', { session: 'Bix' })).toBe('Bix is not archived');
    expect(ok('session.resume', { session: 'Old' }).summary).toBe('Reprendre **Old** sur sa conversation');
    expect(refused('session.resume', { session: 'Bix' })).toBe('Bix is still running');
  });
  it('session.archive refuses a running session: closed first (its clean /exit), never killed by an archive', () => {
    expect(refused('session.archive', { session: 'Bix' })).toBe('Bix is still running: close it first');
    expect(refused('session.archive', { session: 'Nova' })).toBe('Nova is still running: close it first');
    expect(code('session.archive', { session: 'Bix' })).toBe('running');
    // Closed by the same answer: archived after its close card has run (resolved again then).
    expect(ok('session.archive', { session: 'Bix' }, ctx({ closing: new Set(['bix']) })).args).toEqual({ session: 'bix' });
  });
  it('a refusal carries a code for the fronts, beside the daemon\'s words', () => {
    expect(code('session.interrupt', { session: 'Zed' })).toBe('unknown');
    expect(code('session.interrupt', { session: 'Twin' }, ctx({ sessions: [mk('a', 'Twin'), mk('b', 'Twin')] }))).toBe('ambiguous');
    expect(code('session.model', { session: 'Ro', model: 'opus', effort: null })).toBe('read_only');
    expect(code('session.model', { session: 'Old', model: 'opus', effort: null })).toBe('exited');
    expect(code('session.decide', { session: 'Bix', decision: 'accept' })).toBe('no_request');
    expect(code('team.join', { team: 'team-dead', session: 'Bix', role: 'dev-back' })).toBe('dissolved');
    expect(code('task.cancel', { task: 'tdone00' })).toBe('closed');
    expect(code('task.pass', { task: 't91b0d4', to: 'Nova' })).toBe('holder');
  });
  it('each row carries its words (vars), for a front in its own language', () => {
    expect(ok('session.model', { session: 'Nova', model: 'claude-opus-5-5', effort: null }).vars).toEqual({ session: 'Nova', model: 'claude-opus-5-5' });
    expect(ok('session.decide', { session: 'Nova', decision: 'deny', note: 'Pas sur main' }).vars).toEqual({ session: 'Nova', decision: 'deny', kind: 'permission', note: 'Pas sur main' });
    expect(ok('team.join', { team: 'api', session: 'Bix', role: 'rev-back' }).vars).toEqual({ team: 'api', session: 'Bix', role: 'rev-back' });
    expect(ok('task.pass', { task: 't91b0d4', to: 'Bix', note: 'à toi' }).vars).toEqual({ task: 'Pagination', owner: 'Nova', session: 'Bix', note: 'à toi' });
    expect(ok('task.cancel', { task: 't91b0d4' }).vars).toEqual({ task: 'Pagination', owner: 'Nova' });
  });
  it('a summary and its words stay within the row\'s bounds, whatever the note or the title', () => {
    const note = 'n'.repeat(NOTE_MAX);
    const deny = ok('session.decide', { session: 'Nova', decision: 'deny', note });
    expect(deny.summary).toBe('Refuser la demande de permission de **Nova**, avec une note');
    expect(deny.args.note).toBe(note);
    expect(deny.vars!.note).toHaveLength(300);
    const long = ctx({ tasks: [task({ title: 't'.repeat(TASK_TITLE_MAX), ownerName: 'o'.repeat(80) })], sessions: [...ctx().sessions, mk('far', 'f'.repeat(80))] });
    for (const r of [ok('task.cancel', { task: 't91b0d4', reason: 'r'.repeat(500) }, long), ok('task.pass', { task: 't91b0d4', to: 'far', note: 'n'.repeat(TASK_TEXT_MAX) }, long)]) {
      expect(r.summary.length).toBeLessThanOrEqual(300);
      expect(() => ChatActionSchema.parse(r)).not.toThrow();
    }
  });
  it('a request too long for the card is cut and marked, never shown as whole', () => {
    const big = ctx({ sessions: [mk('p', 'P', { pending: { kind: 'plan', text: 'Le plan', body: 'x'.repeat(5000), source: 'hook' } })] });
    const r = ok('session.decide', { session: 'P', decision: 'accept' }, big);
    expect(r.detailCut).toBe(true);
    expect(r.detail).toHaveLength(4000);
    expect(r.detail!.endsWith('…')).toBe(true);
    expect(ok('session.decide', { session: 'Nova', decision: 'accept' }).detailCut).toBeUndefined();
  });
  it('session.decide snapshots the request, shows it verbatim, and makes accept destructive', () => {
    const r = ok('session.decide', { session: 'Nova', decision: 'accept' });
    expect(r).toMatchObject({ risk: 'destructive', detail: 'Bash: rm -rf dist', summary: 'Accepter la demande de permission de **Nova**',
      args: { session: 'nova', decision: 'accept', expect: { kind: 'permission', text: 'Bash: rm -rf dist', key: pendingKey(permission) } } });
    expect(ok('session.decide', { session: 'Nova', decision: 'deny', note: 'Pas sur main' })).toMatchObject({ risk: 'reversible', args: { note: 'Pas sur main' } });
  });
  it('session.decide refuses what the chat may not answer', () => {
    expect(refused('session.decide', { session: 'Bix', decision: 'accept' })).toBe('Bix has no permission, diff or plan pending');
    const question = ctx({ sessions: [mk('q', 'Q', { pending: { kind: 'question', text: '?', source: 'hook' } })] });
    expect(refused('session.decide', { session: 'Q', decision: 'accept' }, question)).toBe('Q has no permission, diff or plan pending');
    const omp = ctx({ sessions: [mk('o', 'O', { tool: 'omp', backend: 'omp-rpc', pending: permission })] });
    expect(refused('session.decide', { session: 'O', decision: 'deny' }, omp)).toBe('O\'s requests are answered in the session');
    expect(refused('session.decide', { session: 'Nova', decision: 'accept', note: 'ok' })).toBe('no note with this answer for claude');
    const cursor = ctx({ sessions: [mk('c', 'C', { tool: 'cursor', pending: { ...permission, kind: 'diff' } })] });
    expect(refused('session.decide', { session: 'C', decision: 'deny', note: 'non' }, cursor)).toBe('no note with this answer for cursor');
  });
  it('a plan shows its body in the detail', () => {
    const plan = ctx({ sessions: [mk('p', 'P', { pending: { kind: 'plan', text: 'Le plan', body: '1. Faire', source: 'hook' } })] });
    expect(ok('session.decide', { session: 'P', decision: 'accept' }, plan).detail).toBe('Le plan\n\n1. Faire');
  });
  it('team.join and team.leave check the team, the seat and the role', () => {
    expect(ok('team.join', { team: 'api', session: 'Bix', role: 'rev-back' })).toMatchObject({ args: { team: 'team-3fa2', session: 'bix', role: 'rev-back' }, team: 'team-3fa2', summary: 'Faire entrer **Bix** dans **api** comme @rev-back' });
    expect(refused('team.join', { team: 'api', session: 'Nova', role: 'dev-back' })).toBe('Nova is already in api');
    expect(refused('team.join', { team: 'api', session: 'Bix', role: 'ops' })).toBe('unknown role ops');
    expect(refused('team.join', { team: 'old', session: 'Bix', role: 'dev-back' })).toBe('unknown team old');
    expect(refused('team.join', { team: 'team-dead', session: 'Bix', role: 'dev-back' })).toBe('team old is dissolved');
    expect(ok('team.leave', { team: 'team-3fa2', session: 'Lu' }).summary).toBe('Retirer **Lu** de **api**');
    expect(refused('team.leave', { team: 'api', session: 'Bix' })).toBe('Bix is not in api');
  });
  it('team.resume, team.dissolve, team.save', () => {
    expect(ok('team.resume', { team: 'nap' }).args).toEqual({ team: 'team-77aa' });
    expect(refused('team.resume', { team: 'api' })).toBe('team api is not resting');
    expect(ok('team.dissolve', { team: 'api' })).toMatchObject({ risk: 'destructive', summary: 'Dissoudre l\'équipe **api**' });
    expect(ok('team.save', { team: 'api', name: 'api-duo' }).args).toEqual({ team: 'team-3fa2', name: 'api-duo',
      seats: [{ role: 'dev-back', tool: 'claude', model: 'claude-sonnet-5-5' }, { role: 'rev-back', tool: 'codex' }] });
    expect(refused('team.save', { team: 'nap', name: 'x' })).toBe('team nap has no seat');
  });
  it('team.save over a template already saved replaces it: destructive, and said so', () => {
    const saved = ctx({ templateExists: name => name === 'api-duo' });
    expect(ok('team.save', { team: 'api', name: 'api-duo' }, saved)).toMatchObject({ risk: 'destructive', summary: 'Remplacer le modèle « api-duo » par **api**', vars: { team: 'api', name: 'api-duo', replaces: '1' } });
    expect(ok('team.save', { team: 'api', name: 'other' }, saved)).toMatchObject({ risk: 'reversible', vars: { team: 'api', name: 'other' } });
  });
  it('task.cancel and task.pass', () => {
    expect(ok('task.cancel', { task: 't91b0d4', reason: 'Plus utile' })).toMatchObject({ risk: 'destructive', args: { task: 't91b0d4', reason: 'Plus utile' }, summary: 'Annuler la tâche « Pagination » de **Nova**' });
    expect(refused('task.cancel', { task: 'tdone00' })).toBe('task tdone00 is closed');
    expect(refused('task.cancel', { task: 'tnope00' })).toBe('unknown task tnope00');
    expect(ok('task.pass', { task: 't91b0d4', to: 'Bix' })).toMatchObject({ args: { task: 't91b0d4', to: 'bix' }, summary: 'Passer la tâche « Pagination » de **Nova** à **Bix**' });
    expect(refused('task.pass', { task: 't91b0d4', to: 'Nova' })).toBe('Nova already holds it');
    expect(refused('task.pass', { task: 't91b0d4', to: 'Ro' })).toBe('Ro is read-only');
  });
});

describe('actionMessage', () => {
  it('turns each generic row into the message the daemon handles', () => {
    const c = ctx();
    const msg = (id: ActionId, args: unknown) => actionMessage(ok(id, args, c), 'r1');
    expect(msg('session.model', { session: 'Nova', model: 'opus', effort: null })).toEqual({ type: 'session.model', id: 'nova', model: 'opus', effort: null });
    expect(msg('session.interrupt', { session: 'Bix' })).toEqual({ type: 'session.interrupt', id: 'bix' });
    expect(msg('session.archive', { session: 'Old' })).toEqual({ type: 'session.archive', id: 'old' });
    expect(msg('session.restore', { session: 'Arch' })).toEqual({ type: 'session.restore', id: 'arch' });
    expect(msg('session.resume', { session: 'Old' })).toEqual({ type: 'session.resume', id: 'old' });
    expect(msg('session.decide', { session: 'Nova', decision: 'accept' })).toEqual({ type: 'session.decide', id: 'nova', decision: 'accept', expect: { kind: 'permission', text: 'Bash: rm -rf dist', key: pendingKey(permission) } });
    expect(msg('team.join', { team: 'api', session: 'Bix', role: 'dev-back' })).toEqual({ type: 'team.join', team: 'team-3fa2', session: 'bix', role: 'dev-back' });
    expect(msg('team.leave', { team: 'api', session: 'Lu' })).toEqual({ type: 'team.leave', team: 'team-3fa2', session: 'lu' });
    expect(msg('team.resume', { team: 'nap' })).toEqual({ type: 'team.resume', team: 'team-77aa' });
    expect(msg('team.dissolve', { team: 'api' })).toEqual({ type: 'team.dissolve', team: 'team-3fa2' });
    expect(msg('team.save', { team: 'api', name: 'duo' })).toMatchObject({ type: 'team.save', rid: 'r1', name: 'duo', seats: [{ role: 'dev-back' }, { role: 'rev-back' }] });
    expect(msg('task.cancel', { task: 't91b0d4', reason: 'non' })).toEqual({ type: 'task.cmd', rid: 'r1', by: 'ledge', op: 'cancel', task: 't91b0d4', text: 'non' });
    expect(msg('task.pass', { task: 't91b0d4', to: 'Bix' })).toEqual({ type: 'task.cmd', rid: 'r1', by: 'ledge', op: 'pass', task: 't91b0d4', to: 'bix' });
  });
  it('every message it builds is a valid client message', async () => {
    const { parseClientMessage } = await import('@ledge/protocol');
    const c = ctx();
    for (const [id, args] of [['session.decide', { session: 'Nova', decision: 'deny', note: 'non' }], ['team.save', { team: 'api', name: 'duo' }], ['task.pass', { task: 't91b0d4', to: 'Bix', note: 'à toi' }]] as const)
      expect(() => parseClientMessage(actionMessage(ok(id, args, c), 'r1'))).not.toThrow();
  });
});
