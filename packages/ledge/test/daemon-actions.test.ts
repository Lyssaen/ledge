import { describe, it, expect } from 'vitest';
import { ACTION_ERROR_CODES, actionById, ChatActionSchema, type OpenRigState, type Goal, type HumanAsk, type PullRequest, NOTE_MAX, pendingKey, TASK_TEXT_MAX, TASK_TITLE_MAX, type ActionId, type ChatAction, type Pending, type Session, type Task } from '@ledge/protocol';
import { actFromChat, denied } from '../src/chat/act.js';
import { actionMessage, cardRefusal, cutVars, GENERIC_ACTIONS, resolveAction, type ResolveCtx } from '../src/daemon/actions.js';

const T0 = '2026-10-26T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/api', project: 'api', title: `${name} · api`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
const task = (extra: Partial<Task> = {}): Task => ({ id: 't91b0d4', title: 'Pagination', giver: 'ledge', giverName: 'Ledge', owner: 'nova', ownerName: 'Nova',
  state: 'taken', at: T0, updatedAt: T0, log: [], ...extra });
const permission: Pending = { kind: 'permission', text: 'Bash: rm -rf dist', tool: 'Bash', source: 'hook' };

const ctx = (over: Partial<ResolveCtx> = {}): ResolveCtx => ({
  sessions: [mk('nova', 'Nova', { model: 'claude-sonnet-5-5', pending: permission, state: 'waiting_permission' }), mk('lu', 'Lu', { tool: 'codex' }), mk('bix', 'Bix'),
    mk('old', 'Old', { state: 'exited' }), mk('ro', 'Ro', { source: 'hook_only' }), mk('arch', 'Arch', { state: 'exited', archivedAt: T0 })],
  tasks: [task(), task({ id: 'tdone00', state: 'done' }), task({ id: 'tdeci01', title: 'Fusionner feat/roles ?', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open' }),
    task({ id: 'tdeci02', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'done' })],
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
    expect([...GENERIC_ACTIONS].sort()).toEqual(['brain.answer', 'note.add', 'pr.fix', 'rig.act', 'rig.answer', 'rig.goal', 'rig.goal.reply', 'rig.seats', 'rig.send', 'session.archive', 'session.decide',
      'session.handover', 'session.interrupt', 'session.model', 'session.restore', 'session.resume', 'task.answer', 'task.cancel', 'task.pass']);
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
    expect(code('session.restore', { session: 'Bix' })).toBe('not_archived');
    expect(code('task.cancel', { task: 'tdone00' })).toBe('closed');
    expect(code('task.pass', { task: 't91b0d4', to: 'Nova' })).toBe('holder');
  });
  it('each row carries its words (vars), for a front in its own language', () => {
    expect(ok('session.model', { session: 'Nova', model: 'claude-opus-5-5', effort: null }).vars).toEqual({ session: 'Nova', model: 'claude-opus-5-5' });
    expect(ok('session.decide', { session: 'Nova', decision: 'deny', note: 'Pas sur main' }).vars).toEqual({ session: 'Nova', decision: 'deny', kind: 'permission', note: 'Pas sur main' });
    expect(ok('session.archive', { session: 'Old' }).vars).toEqual({ session: 'Old' });
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
  it('task.cancel and task.pass', () => {
    expect(ok('task.cancel', { task: 't91b0d4', reason: 'Plus utile' })).toMatchObject({ risk: 'destructive', args: { task: 't91b0d4', reason: 'Plus utile' }, summary: 'Annuler la tâche « Pagination » de **Nova**' });
    expect(refused('task.cancel', { task: 'tdone00' })).toBe('task tdone00 is closed');
    expect(refused('task.cancel', { task: 'tnope00' })).toBe('unknown task tnope00');
    expect(ok('task.pass', { task: 't91b0d4', to: 'Bix' })).toMatchObject({ args: { task: 't91b0d4', to: 'bix' }, summary: 'Passer la tâche « Pagination » de **Nova** à **Bix**' });
    expect(refused('task.pass', { task: 't91b0d4', to: 'Nova' })).toBe('Nova already holds it');
    expect(refused('task.pass', { task: 't91b0d4', to: 'Ro' })).toBe('Ro is read-only');
  });
  it('task.answer: the user\'s answer to an open decision, shown whole, destructive; never a task that is not one', () => {
    expect(ok('task.answer', { task: 'tdeci01', answer: 'Oui, fusionne' })).toMatchObject({ action: 'task.answer', risk: 'destructive', args: { task: 'tdeci01', answer: 'Oui, fusionne' },
      summary: 'Répondre à la décision « Fusionner feat/roles ? » de **Nova**', vars: { task: 'Fusionner feat/roles ?', session: 'Nova', answer: 'Oui, fusionne' },
      session: 'nova', detail: 'Oui, fusionne' });
    expect(ok('task.answer', { task: 'tdeci01', answer: 'x'.repeat(TASK_TEXT_MAX) })).toMatchObject({ detailCut: true });
    expect(code('task.answer', { task: 't91b0d4', answer: 'oui' })).toBe('not_decision');
    expect(code('task.answer', { task: 'tdeci02', answer: 'oui' })).toBe('closed');
    expect(code('task.answer', { task: 'tnope00', answer: 'oui' })).toBe('unknown');
    expect(actionById('task.answer')!.args.safeParse({ task: 'tdeci01', answer: '  ' }).success).toBe(false);
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
    expect(msg('task.cancel', { task: 't91b0d4', reason: 'non' })).toEqual({ type: 'task.cmd', rid: 'r1', by: 'ledge', op: 'cancel', task: 't91b0d4', text: 'non' });
    expect(msg('task.pass', { task: 't91b0d4', to: 'Bix' })).toEqual({ type: 'task.cmd', rid: 'r1', by: 'ledge', op: 'pass', task: 't91b0d4', to: 'bix' });
    expect(msg('task.answer', { task: 'tdeci01', answer: 'Oui' })).toEqual({ type: 'task.cmd', rid: 'r1', by: 'ledge', op: 'done', task: 'tdeci01', text: 'Oui' });
  });
  it('every message it builds is a valid client message', async () => {
    const { parseClientMessage } = await import('@ledge/protocol');
    const c = ctx();
    for (const [id, args] of [['session.decide', { session: 'Nova', decision: 'deny', note: 'non' }], ['task.cancel', { task: 't91b0d4', reason: 'non' }], ['task.pass', { task: 't91b0d4', to: 'Bix', note: 'à toi' }], ['task.answer', { task: 'tdeci01', answer: 'non' }]] as const)
      expect(() => parseClientMessage(actionMessage(ok(id, args, c), 'r1'))).not.toThrow();
  });
});

// Rigs from the chat (refonte mobile B4): « Lancer » a rig command Ledge proposes.
const seat = (logicalId: string) => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-dev`, runtime: 'claude-code', model: null, sessionStatus: 'running',
  lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const RIGS: OpenRigState = {
  installed: true, version: '0.7.10', daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, at: T0,
  rigs: [
    { id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 3, running: 3, attention: 0, uptime: '1h', snapshot: null, nodes: [seat('dev.back'), seat('dev.back-2'), seat('dev.front')] },
    { id: 'r2', name: 'idle', status: 'stopped', lifecycleState: 'stopped', seats: 1, running: 0, attention: 0, uptime: null, snapshot: null, nodes: [seat('dev.back')] }
  ]
};
const withRigs = (over: Partial<OpenRigState> = {}) => ctx({ rigs: { ...RIGS, ...over } });

describe('rig.act and rig.seats', () => {
  it('rig.act checks the rig and the kernel against OpenRig as last read; stop and restart are destructive', () => {
    const c = withRigs();
    expect(ok('rig.act', { kind: 'rig.restart', rig: 'ledge-dev' }, c)).toMatchObject({ args: { kind: 'rig.restart', rig: 'ledge-dev' }, risk: 'destructive', summary: 'Redémarrer le rig **ledge-dev**' });
    expect(ok('rig.act', { kind: 'rig.start', rig: 'idle' }, c)).toMatchObject({ risk: 'reversible', summary: 'Démarrer le rig **idle**' });
    // « de le » contracts into « du » (mockup M3 §5).
    expect(ok('rig.act', { kind: 'rig.snapshot', rig: 'ledge-dev' }, c)).toMatchObject({ risk: 'reversible', summary: 'Prendre un snapshot du rig **ledge-dev**' });
    expect(ok('rig.act', { kind: 'kernel.stop' }, c)).toMatchObject({ args: { kind: 'kernel.stop' }, risk: 'destructive', summary: 'Arrêter le kernel' });
    expect(code('rig.act', { kind: 'rig.start', rig: 'ledge-dev' }, c)).toBe('running');
    expect(code('rig.act', { kind: 'rig.stop', rig: 'idle' }, c)).toBe('not_running');
    expect(code('rig.act', { kind: 'rig.stop', rig: 'nope' }, c)).toBe('unknown');
    expect(code('rig.act', { kind: 'kernel.start' }, c)).toBe('running');
    expect(code('rig.act', { kind: 'kernel.restart' }, withRigs({ kernel: { state: 'stopped' } }))).toBe('not_running');
    // OpenRig not read yet, or not installed: nothing to check against.
    expect(code('rig.act', { kind: 'kernel.start' }, ctx())).toBe('unknown');
    expect(code('rig.act', { kind: 'kernel.start' }, withRigs({ installed: false }))).toBe('unknown');
  });
  it('rig.act takes only a rig\'s or the kernel\'s power: never the daemon, a rig.* always names its rig, a kernel.* never', () => {
    const args = actionById('rig.act')!.args;
    expect(args.safeParse({ kind: 'daemon.stop' }).success).toBe(false);
    expect(args.safeParse({ kind: 'rig.stop' }).success).toBe(false);
    expect(args.safeParse({ kind: 'kernel.stop', rig: 'kernel' }).success).toBe(false);
  });
  it('rig.seats: a running rig\'s role, a change; removing a seat is destructive', () => {
    const c = withRigs();
    expect(ok('rig.seats', { rig: 'ledge-dev', role: 'dev.front', count: 2 }, c)).toMatchObject({ risk: 'reversible', vars: { rig: 'ledge-dev', role: 'dev.front', count: '2', from: '1' },
      summary: 'Passer **dev.front** de **ledge-dev** de 1 à 2 sièges' });
    expect(ok('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 1 }, c).risk).toBe('destructive');
    expect(code('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 2 }, c)).toBe('unchanged');
    expect(code('rig.seats', { rig: 'ledge-dev', role: 'qa.review', count: 1 }, c)).toBe('unknown');
    expect(code('rig.seats', { rig: 'idle', role: 'dev.back', count: 2 }, c)).toBe('not_running');
  });
  it('an unknown OpenRig row says what is gone (missing), so the card names that cause: OpenRig, the rig, or the role\'s seats', () => {
    const missing = (id: ActionId, args: unknown, c: ReturnType<typeof ctx>) => {
      const r = resolveAction(id, actionById(id)!.args.parse(args), c);
      return 'refused' in r ? [r.code, r.missing] : ['resolved'];
    };
    const c = withRigs();
    expect(missing('rig.act', { kind: 'rig.stop', rig: 'nope' }, c)).toEqual(['unknown', 'rig']);
    expect(missing('rig.act', { kind: 'kernel.start' }, ctx())).toEqual(['unknown', 'openrig']);
    expect(missing('rig.act', { kind: 'rig.start', rig: 'ledge-dev' }, withRigs({ installed: false }))).toEqual(['unknown', 'openrig']);
    // A rig gone under a seat change is the rig, not its role.
    expect(missing('rig.seats', { rig: 'nope', role: 'dev.back', count: 1 }, c)).toEqual(['unknown', 'rig']);
    expect(missing('rig.seats', { rig: 'ledge-dev', role: 'qa.review', count: 1 }, c)).toEqual(['unknown', 'role']);
    expect(missing('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 1 }, ctx())).toEqual(['unknown', 'openrig']);
    // Other refusals name nothing.
    expect(missing('rig.act', { kind: 'rig.stop', rig: 'idle' }, c)).toEqual(['not_running', undefined]);
  });
  it('each row carries what a phone writes its line with (M3 Q34), and an irreversible one the seats it stops (Q35)', () => {
    const c = withRigs({ rigs: [...RIGS.rigs, { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: '1h', snapshot: null,
      nodes: [{ ...seat('ops.operator'), session: 'operator-agent@kernel' }, { ...seat('ops.advisor'), session: 'advisor-agent@kernel' }] }] });
    expect(ok('rig.act', { kind: 'rig.restart', rig: 'ledge-dev' }, c).vars).toEqual({ kind: 'rig.restart', rig: 'ledge-dev', seats: 'dev-back, dev-back-2, dev-front', seatCount: '3' });
    expect(ok('rig.act', { kind: 'rig.stop', rig: 'ledge-dev' }, c).vars).toMatchObject({ seatCount: '3' });
    // A start or a snapshot stops nothing.
    expect(ok('rig.act', { kind: 'rig.snapshot', rig: 'ledge-dev' }, c).vars).toEqual({ kind: 'rig.snapshot', rig: 'ledge-dev' });
    expect(ok('rig.act', { kind: 'rig.start', rig: 'idle' }, c).vars).toEqual({ kind: 'rig.start', rig: 'idle' });
    expect(ok('rig.act', { kind: 'kernel.stop' }, c).vars).toEqual({ kind: 'kernel.stop', rig: 'kernel', seats: 'operator-agent, advisor-agent', seatCount: '2' });
    // A kernel this PC does not read the seats of: the row, without them.
    expect(ok('rig.act', { kind: 'kernel.restart' }, withRigs()).vars).toEqual({ kind: 'kernel.restart', rig: 'kernel' });
    // Removing seats: the role's last ones, as OpenRig removes them.
    expect(ok('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 1 }, c).vars).toEqual({ rig: 'ledge-dev', role: 'dev.back', count: '1', from: '2', seats: 'dev-back-2', seatCount: '1' });
    expect(ok('rig.seats', { rig: 'ledge-dev', role: 'dev.front', count: 2 }, c).vars).toEqual({ rig: 'ledge-dev', role: 'dev.front', count: '2', from: '1' });
  });
  it('a confirmed step whose seats changed before it applies is refused, not applied to other seats', async () => {
    const before = withRigs();
    const apply = async (rows: ChatAction[], after: ResolveCtx) => {
      const applied: string[] = [];
      const card = [...rows];
      const r = await actFromChat({ chat: { action: (_q: string, i: number) => card[i], markAction: (_q: string, i: number, patch: Partial<ChatAction>) => { card[i] = { ...card[i]!, ...patch }; } },
        emit: () => {}, inFlight: new Set(), resolve: (x: ChatAction) => resolveAction(x.action, x.args, after), apply: async (x: ChatAction) => { applied.push(x.action); } }, 'q', undefined, true);
      return { r, applied, card };
    };
    const ledge = RIGS.rigs[0]!;
    const rigsWith = (nodes: typeof ledge.nodes) => withRigs({ rigs: [{ ...ledge, nodes }, RIGS.rigs[1]!] });
    const shrink = ok('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 1 }, before);
    expect(shrink.cuts).toEqual(['dev-back-2@ledge-dev']);
    // The seat the card named was replaced by another: the same count, another seat stopped.
    const replaced = await apply([shrink], rigsWith([seat('dev.back'), seat('dev.back-3'), seat('dev.front')]));
    expect(replaced.applied).toEqual([]);
    expect(replaced.card[0]).toMatchObject({ state: 'refused', code: 'changed', error: 'the seats it stops have changed since the card' });
    // The role grew: going to 1 now stops two seats.
    expect((await apply([shrink], rigsWith([seat('dev.back'), seat('dev.back-2'), seat('dev.back-3'), seat('dev.front')]))).applied).toEqual([]);
    // A rig restarted after a seat was added.
    const restart = ok('rig.act', { kind: 'rig.restart', rig: 'ledge-dev' }, before);
    expect((await apply([restart], rigsWith([...ledge.nodes, seat('qa.review')]))).applied).toEqual([]);
    // Nothing changed: it applies.
    expect((await apply([shrink, restart], before)).applied).toEqual(['rig.seats', 'rig.act']);
  });
  it('a long list of seats keeps what fits in 300 characters, and says how many are left out', () => {
    const many = Array.from({ length: 40 }, (_, i) => `seat-number-${i}@big`);
    const v = cutVars('big', many);
    expect(v.seats!.length).toBeLessThanOrEqual(300);
    expect(v.seats!.startsWith('seat-number-0, seat-number-1')).toBe(true);
    expect(Number(v.seatsMore) + v.seats!.split(', ').length).toBe(40);
    expect(v.seatCount).toBe('40');
    expect(cutVars('big', [])).toEqual({});
  });
  it('turns the rows into the Desktop\'s own OpenRig messages, valid client messages', async () => {
    const { parseClientMessage } = await import('@ledge/protocol');
    const c = withRigs();
    const restart = actionMessage(ok('rig.act', { kind: 'rig.restart', rig: 'ledge-dev' }, c), 'r1');
    expect(restart).toEqual({ type: 'openrig.act', requestId: 'r1', action: { kind: 'rig.restart', rig: 'ledge-dev' } });
    const kernel = actionMessage(ok('rig.act', { kind: 'kernel.start' }, withRigs({ kernel: { state: 'stopped' } })), 'r1');
    expect(kernel).toEqual({ type: 'openrig.act', requestId: 'r1', action: { kind: 'kernel.start' } });
    const seats = actionMessage(ok('rig.seats', { rig: 'ledge-dev', role: 'dev.back', count: 1 }, c), 'r1');
    expect(seats).toEqual({ type: 'openrig.seats', requestId: 'r1', rig: 'ledge-dev', seats: { 'dev.back': 1 } });
    for (const m of [restart, kernel, seats]) expect(() => parseClientMessage(m)).not.toThrow();
  });
});

describe('the operator actions', () => {
  const ask = (extra: Partial<HumanAsk> = {}): HumanAsk => ({ id: 'q-1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'max@kernel', rig: null, role: null }, summary: 'Quelle équipe ?', body: '', bodyTruncated: false,
    detail: null, evidenceRef: null, questions: [{ id: 'team', question: 'Équipe ?', options: [{ id: 'confirm', label: 'Confirmer', recommended: true }, { id: 'launch-rig', label: 'Lancer', recommended: false }], answer: null }],
    createdAt: T0, updatedAt: T0, ...extra });
  const team = { kind: 'launch' as const, rig: 'ledge-dev', running: false, folder: '/w/api', seats: [], reason: null, launch: null };
  const goal = (extra: Partial<Goal> = {}): Goal => ({ goalId: 'goal-0001', qitemId: 'qitem-ledge-goal-goal-0001', text: 'Ajouter la pagination', folder: null, sentAt: T0, to: 'max@kernel', state: 'proposed',
    trail: [], current: null, question: null, proposal: null, ...extra } as unknown as Goal);
  const node = (logicalId: string, extra = {}) => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-dev`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...extra });
  const rigs = { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node('dev.back'), node('dev.front', { stopped: true })] }] } as unknown as OpenRigState;
  const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({ id: 'github.com/a/api#226', forge: 'github', host: 'github.com', repo: 'a/api', number: 226, ref: '#226', url: 'https://github.com/a/api/pull/226', title: 'Roles', state: 'open',
    branch: 'feat/roles', target: 'main', headSha: 'abc', pipeline: 'fail', approvals: { given: 0 }, mergeable: false, openThreads: 0, updatedAt: T0, sessions: ['bix'], ...extra } as PullRequest);

  it('rig.answer on a closed qitem is refused', () => {
    expect(code('rig.answer', { qitem: 'q-gone', answer: { option: 'confirm' } }, ctx({ asks: [ask()] }))).toBe('closed');
    expect(code('rig.answer', { qitem: 'q-1', answer: { option: 'nope' } }, ctx({ asks: [ask()] }))).toBe('unknown');
  });
  it('rig.answer confirm on a team ask is destructive, and goes to human.answer', () => {
    const r = ok('rig.answer', { qitem: 'q-1', answer: { option: 'confirm' } }, ctx({ asks: [ask({ team })] }));
    expect(r.risk).toBe('destructive');
    expect(actionMessage(r, 'rid')).toMatchObject({ type: 'openrig.answer', qitemId: 'q-1', answer: { kind: 'choice', questionId: 'team', optionId: 'confirm' } });
    expect(ok('rig.answer', { qitem: 'q-1', answer: { option: 'confirm' } }, ctx({ asks: [ask()] })).risk).toBe('reversible');
  });
  it('rig.answer sends words, a parked row\'s resolution, and « Vu » only on news', () => {
    expect(actionMessage(ok('rig.answer', { qitem: 'q-1', answer: { text: 'Oui' } }, ctx({ asks: [ask()] })), 'r')).toMatchObject({ answer: { kind: 'words', text: 'Oui' } });
    expect(actionMessage(ok('rig.answer', { qitem: 'q-1', answer: { text: 'Fait' } }, ctx({ asks: [ask({ kind: 'parked' })] })), 'r')).toMatchObject({ answer: { kind: 'resolve', text: 'Fait' } });
    expect(code('rig.answer', { qitem: 'q-1', answer: { seen: true } }, ctx({ asks: [ask()] }))).toBe('not_decision');
    expect(actionMessage(ok('rig.answer', { qitem: 'q-1', answer: { seen: true } }, ctx({ asks: [ask({ kind: 'update' })] })), 'r')).toMatchObject({ answer: { kind: 'seen' } });
  });
  it('rig.goal sends the goal to Max with a goal id stable for a retry', () => {
    const r = ok('rig.goal', { text: 'Ajouter la pagination', folder: '/w/api' });
    const m1 = actionMessage(r, 'rid-1'), m2 = actionMessage(r, 'rid-1');
    expect(m1).toMatchObject({ type: 'openrig.goal.send', text: 'Ajouter la pagination', folder: '/w/api' });
    expect(m1).toEqual(m2);
    expect((m1 as { goalId: string }).goalId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
  it('rig.goal.reply writes to Max, or confirms the team he proposes', () => {
    expect(code('rig.goal.reply', { goal: 'nope', answer: 'confirm' }, ctx({ goals: [goal()] }))).toBe('unknown');
    const text = ok('rig.goal.reply', { goal: 'goal-0001', answer: { text: 'Plutôt ledge-dev' } }, ctx({ goals: [goal()] }));
    expect(text.risk).toBe('reversible');
    expect(actionMessage(text, 'r')).toMatchObject({ type: 'openrig.goal.reply', goalId: 'goal-0001', text: 'Plutôt ledge-dev' });
    expect(code('rig.goal.reply', { goal: 'goal-0001', answer: 'confirm' }, ctx({ goals: [goal()], asks: [] }))).toBe('no_request');
    const c = ok('rig.goal.reply', { goal: 'goal-0001', answer: 'confirm' }, ctx({ goals: [goal()], asks: [ask({ goalId: 'goal-0001', team })] }));
    expect(c.risk).toBe('destructive');
    expect(actionMessage(c, 'r')).toMatchObject({ type: 'openrig.answer', qitemId: 'q-1', answer: { questionId: 'team', optionId: 'confirm' } });
  });
  it('rig.send to an unknown seat is refused, and a stopped seat too', () => {
    const c = ctx({ rigs, sessions: [mk('bk', 'dev-back@ledge-dev', { tmuxSession: 'dev-back@ledge-dev', source: 'rig' })] });
    expect(code('rig.send', { rig: 'ledge-dev', seat: 'qa.tester', text: 'Salut' }, c)).toBe('unknown');
    expect(code('rig.send', { rig: 'ledge-dev', seat: 'dev.front', text: 'Salut' }, c)).toBe('not_running');
    const r = ok('rig.send', { rig: 'ledge-dev', seat: 'dev.back', text: 'Salut' }, c);
    expect(actionMessage(r, 'r')).toEqual({ type: 'session.reply', id: 'bk', text: 'Salut' });
  });
  it('brain.answer answers a note proposal only', () => {
    const proposal = task({ id: 'tnote001', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', brain: { note: 'machines', fact: 'Legion a 64 Go' } } as Partial<Task>);
    expect(code('brain.answer', { task: 'tdeci01', choice: 'add' }, ctx({ tasks: [proposal, task({ id: 'tdeci01', giver: 'nova', owner: 'ledge', state: 'open' })] }))).toBe('not_decision');
    expect(actionMessage(ok('brain.answer', { task: 'tnote001', choice: { edit: 'Legion a 32 Go' } }, ctx({ tasks: [proposal] })), 'r')).toEqual({ type: 'brain.answer', rid: 'r', task: 'tnote001', choice: { yes: true, text: 'Legion a 32 Go' } });
    expect(actionMessage(ok('brain.answer', { task: 'tnote001', choice: 'refuse' }, ctx({ tasks: [proposal] })), 'r')).toMatchObject({ choice: { yes: false } });
  });
  it('session.handover on an exited session is refused', () => {
    expect(code('session.handover', { session: 'Old' })).toBe('exited');
    expect(code('session.handover', { session: 'Ro' })).toBe('read_only');
    expect(actionMessage(ok('session.handover', { session: 'Bix' }), 'r')).toEqual({ type: 'session.handover', rid: 'r', id: 'bix' });
  });
  it('pr.fix on a PR not followed is refused, and goes to the branch\'s session as a reply', () => {
    expect(code('pr.fix', { pr: 'github.com/a/api#226' }, ctx({ prs: [] }))).toBe('unknown');
    expect(code('pr.fix', { pr: 'github.com/a/api#226' }, ctx({ prs: [pr({ pipeline: 'ok' })] }))).toBe('no_request');
    expect(code('pr.fix', { pr: 'github.com/a/api#226' }, ctx({ prs: [pr({ state: 'merged' })] }))).toBe('closed');
    const r = ok('pr.fix', { pr: 'github.com/a/api#226' }, ctx({ prs: [pr()] }));
    expect(actionMessage(r, 'r')).toMatchObject({ type: 'session.reply', id: 'bix', text: expect.stringContaining('#226') });
    expect(ok('pr.fix', { pr: 'github.com/a/api#226', session: 'Lu' }, ctx({ prs: [pr()] })).session).toBe('lu');
  });
});
