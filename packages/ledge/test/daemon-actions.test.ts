import { describe, it, expect } from 'vitest';
import { ACTION_ERROR_CODES, actionById, ChatActionSchema, NOTE_MAX, pendingKey, type ActionId, type ChatAction, type Pending, type Session } from '@ledge/protocol';
import { denied } from '../src/chat/act.js';
import { actionMessage, cardRefusal, GENERIC_ACTIONS, resolveAction, type ResolveCtx } from '../src/daemon/actions.js';

const T0 = '2026-10-26T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/api', project: 'api', title: `${name} · api`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
const permission: Pending = { kind: 'permission', text: 'Bash: rm -rf dist', tool: 'Bash', source: 'hook' };

const ctx = (over: Partial<ResolveCtx> = {}): ResolveCtx => ({
  sessions: [mk('nova', 'Nova', { model: 'claude-sonnet-5-5', pending: permission, state: 'waiting_permission' }), mk('lu', 'Lu', { tool: 'codex' }), mk('bix', 'Bix'),
    mk('old', 'Old', { state: 'exited' }), mk('ro', 'Ro', { source: 'hook_only' }), mk('arch', 'Arch', { state: 'exited', archivedAt: T0 })],
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
    expect([...GENERIC_ACTIONS].sort()).toEqual(['session.archive', 'session.decide', 'session.interrupt', 'session.model', 'session.restore', 'session.resume']);
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
  });
  it('each row carries its words (vars), for a front in its own language', () => {
    expect(ok('session.model', { session: 'Nova', model: 'claude-opus-5-5', effort: null }).vars).toEqual({ session: 'Nova', model: 'claude-opus-5-5' });
    expect(ok('session.decide', { session: 'Nova', decision: 'deny', note: 'Pas sur main' }).vars).toEqual({ session: 'Nova', decision: 'deny', kind: 'permission', note: 'Pas sur main' });
  });
  it('a summary and its words stay within the row\'s bounds, whatever the note or the name', () => {
    const note = 'n'.repeat(NOTE_MAX);
    const deny = ok('session.decide', { session: 'Nova', decision: 'deny', note });
    expect(deny.summary).toBe('Refuser la demande de permission de **Nova**, avec une note');
    expect(deny.args.note).toBe(note);
    expect(deny.vars!.note).toHaveLength(300);
    const long = ctx({ sessions: [...ctx().sessions, mk('far', 'f'.repeat(80), { model: 'claude-sonnet-5-5' })] });
    const r = ok('session.model', { session: 'far', model: 'claude-opus-5-5', effort: null }, long);
    expect(r.summary.length).toBeLessThanOrEqual(300);
    expect(() => ChatActionSchema.parse(r)).not.toThrow();
  });
  it('a cut request is never accepted from a card, on any device: refused before anything is sent; denied, it goes', () => {
    const big = ctx({ sessions: [mk('p', 'P', { pending: { kind: 'plan', text: 'Le plan', body: 'x'.repeat(5000), source: 'hook' } })] });
    expect(cardRefusal(ok('session.decide', { session: 'P', decision: 'accept' }, big))).toEqual({ refused: 'P\'s request is cut on the card: accept it in the session', code: 'cut' });
    expect(cardRefusal(ok('session.decide', { session: 'P', decision: 'deny' }, big))).toBeNull();
    expect(cardRefusal(ok('session.decide', { session: 'P', decision: 'deny', note: 'Trop long' }, big))).toBeNull();
    // A request shown whole is accepted as before.
    expect(cardRefusal(ok('session.decide', { session: 'Nova', decision: 'accept' }))).toBeNull();
    expect(ACTION_ERROR_CODES).toContain('cut');
  });
  it('« Refuser » a row gives the row the resolver gives for deny: same args, same risk', () => {
    const c = ctx({ sessions: [mk('nova', 'Nova', { pending: permission, state: 'waiting_permission' })] });
    for (const args of [{ session: 'Nova', decision: 'accept' }, { session: 'Nova', decision: 'deny', note: 'Pas sur main' }]) {
      const d = denied(ok('session.decide', args, c));
      const again = ok('session.decide', { session: 'Nova', decision: 'deny', ...('note' in args ? { note: args.note } : {}) }, c);
      expect(JSON.stringify(d.args)).toBe(JSON.stringify(again.args));
      expect(d.risk).toBe(again.risk);
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
  });
  it('every message it builds is a valid client message', async () => {
    const { parseClientMessage } = await import('@ledge/protocol');
    const c = ctx();
    for (const [id, args] of [['session.decide', { session: 'Nova', decision: 'deny', note: 'non' }]] as const)
      expect(() => parseClientMessage(actionMessage(ok(id, args, c), 'r1'))).not.toThrow();
  });
});
