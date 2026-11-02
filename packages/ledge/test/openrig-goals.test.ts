import { describe, it, expect } from 'vitest';
import { OpenRigGoalsChangedSchema, parseClientMessage, type OpenRigState } from '@ledge/protocol';
import { goalOf, parseTeam, withoutTeam } from '../src/daemon/goalTeam.js';
import { createGoals, createOutcome, goalBody, goalQitemId, operatorOf, readGoalBody } from '../src/daemon/openrigGoals.js';
import { toAsk, type RigHttp } from '../src/daemon/openrigHuman.js';
import type { RigRun } from '../src/daemon/openrig.js';

const MAX = 'operator-agent@kernel';
const node = (logicalId: string, session: string) => ({ logicalId, session, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const RUNNING: OpenRigState = { installed: true, daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, at: '',
  rigs: [{ id: 'K', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: null, snapshot: null,
    nodes: [node('operator.agent', MAX), node('advisor.agent', 'advisor-agent@kernel')] }] };
const BASE = 'http://127.0.0.1:7433';
const TEAM = { kind: 'existing', rig: 'ledge-dev', running: true, folder: '/home/u/Workspace/ledge',
  seats: [{ seat: 'design-ux@ledge-dev', name: 'Lu', note: "maquette d'abord" }, { seat: 'dev-front@ledge-dev', name: 'Ida' }], reason: 'ledge-dev connaît l’encoche.' };
const block = (t: unknown) => `Pas de nouveau rig.\n\n\`\`\`ledge-team\n${JSON.stringify(t)}\n\`\`\`\n`;

describe('the team block', () => {
  it('reads an existing team, a launch with its details nested or flat, and refuses what does not read', () => {
    expect(parseTeam(block(TEAM))).toEqual({ kind: 'existing', rig: 'ledge-dev', running: true, folder: '/home/u/Workspace/ledge', reason: 'ledge-dev connaît l’encoche.',
      seats: [{ seat: 'design-ux@ledge-dev', name: 'Lu', role: 'design.ux', note: "maquette d'abord" }, { seat: 'dev-front@ledge-dev', name: 'Ida', role: 'dev.front', note: null }], launch: null });
    const launch = { kind: 'launch', rig: 'notch', folder: '/w/notch', seats: [], agents: 3, runtimes: ['claude-code', 'codex'], plan: '3 seats, 2 pods', writes: ['CLAUDE.md', '.mcp.json'], permissions: 'auto' };
    expect(parseTeam(block(launch))!.launch).toEqual({ agents: 3, runtimes: ['claude-code', 'codex'], plan: '3 seats, 2 pods', writes: ['CLAUDE.md', '.mcp.json'], permissions: 'auto' });
    expect(parseTeam(block({ kind: 'launch', rig: 'x', launch: { agents: 2, runtimes: ['codex'] } }))!.launch).toMatchObject({ agents: 2, runtimes: ['codex'], plan: null, writes: [] });
    expect(parseTeam('no block')).toBeNull();
    expect(parseTeam('```ledge-team\n{not json\n```')).toBeNull();
    expect(parseTeam(block({ rig: 'x' }))).toBeNull(); // kind is required
    expect(withoutTeam(block(TEAM))).toBe('Pas de nouveau rig.');
    expect(goalOf(['test', 'ledge-goal:qitem-ledge-goal-abc'])).toBe('qitem-ledge-goal-abc');
    expect(goalOf(['ledge-goal'])).toBeNull();
  });

  it('marks Max\'s ask in « À toi » with its goal and its team', () => {
    const ask = { qitemId: 'qitem-p', sourceSession: MAX, destinationSession: 'ledge@external', state: 'pending', body: block(TEAM), summary: 'Équipe proposée',
      tags: ['ledge-goal:qitem-ledge-goal-g1'], tsCreated: 't', tsUpdated: 't', humanQuestions: [{ id: 'team', question: 'Confirmer ?', options: [{ id: 'confirm', label: 'Confirmer l’équipe', recommended: true }, { id: 'launch-rig', label: 'Lancer un rig plutôt' }] }] };
    const a = toAsk(ask, 'decision')!;
    expect(a.goalId).toBe('g1');
    expect(a.team?.rig).toBe('ledge-dev');
    expect(toAsk({ ...ask, tags: null }, 'decision')).not.toHaveProperty('goalId');
  });
});

describe('the goal row', () => {
  it('keeps the person\'s words and folder, a line of dashes in them included, and is the same for a retry', () => {
    const text = 'Je veux la pochette dans l’encoche.\n---\nFini quand : tous les lecteurs.';
    const b = goalBody(text, '/home/u/Workspace/ledge', goalQitemId('g1'));
    expect(b).toBe(goalBody(text, '/home/u/Workspace/ledge', goalQitemId('g1')));
    expect(b).toContain('ledge-goal:qitem-ledge-goal-g1');
    expect(readGoalBody(b)).toEqual({ text, folder: '/home/u/Workspace/ledge' });
    expect(readGoalBody(goalBody('x', undefined, 'q'))).toEqual({ text: 'x', folder: null });
  });

  it('finds Max on the kernel', () => {
    expect(operatorOf(RUNNING)).toBe(MAX);
    expect(operatorOf({ ...RUNNING, rigs: [] })).toBeNull();
  });

  it('reads what rig queue create said: created, found again, refused, or uncertain', () => {
    expect(createOutcome({ code: 0, stdout: 'Queue create request ID: q (not proof)\n{"qitemId":"q","state":"pending"}', stderr: '' }, 'q')).toEqual({ ok: true, qitemId: 'q' });
    expect(createOutcome({ code: 1, stdout: '', stderr: 'error: qitem_id_reuse: …' }, 'q')).toMatchObject({ ok: false, error: 'refused' });
    expect(createOutcome({ code: 1, stdout: '', stderr: 'request timed out' }, 'q')).toMatchObject({ ok: false, error: 'uncertain' });
    expect(createOutcome({ code: 1, stdout: '', stderr: 'connect ECONNREFUSED 127.0.0.1:7433' }, 'q')).toMatchObject({ error: 'openrig_stopped' });
    expect(createOutcome({ code: null, stdout: '', stderr: '' }, 'q')).toMatchObject({ error: 'openrig_stopped' });
  });
});

describe('sending a goal', () => {
  const ran: string[][] = [];
  const run: RigRun = async args => { ran.push(args); const id = args[args.indexOf('--id') + 1]; return { code: 0, stdout: JSON.stringify({ qitemId: id }), stderr: '' }; };

  it('goes to Max from ledge@external, with a stable id and the ledge-goal tag, never --alert', async () => {
    ran.length = 0;
    const g = createGoals({ state: async () => RUNNING, run });
    expect(await g.send('g1', 'La pochette dans l’encoche', '/w/ledge')).toEqual({ ok: true, qitemId: 'qitem-ledge-goal-g1' });
    const a = ran[0]!;
    expect(a.slice(0, 2)).toEqual(['queue', 'create']);
    expect(a[a.indexOf('--source') + 1]).toBe('ledge@external');
    expect(a[a.indexOf('--destination') + 1]).toBe(MAX);
    expect(a[a.indexOf('--id') + 1]).toBe('qitem-ledge-goal-g1');
    expect(a[a.indexOf('--tags') + 1]).toBe('ledge-goal');
    expect(a).not.toContain('--alert');
    expect(readGoalBody(a[a.indexOf('--body') + 1]!)).toEqual({ text: 'La pochette dans l’encoche', folder: '/w/ledge' });
    // A retry is the same command, so OpenRig finds the row again.
    await g.send('g1', 'La pochette dans l’encoche', '/w/ledge');
    expect(ran[1]).toEqual(a);
  });

  it('a word to Max about a goal is a new row to him (it wakes him), tagged with the goal', async () => {
    ran.length = 0;
    expect(await createGoals({ state: async () => RUNNING, run }).reply('g1', 'r1', 'Prends plutôt Ida')).toEqual({ ok: true, qitemId: 'qitem-ledge-goal-reply-r1' });
    const a = ran[0]!;
    expect(a[a.indexOf('--tags') + 1]).toBe('ledge-goal-reply:qitem-ledge-goal-g1');
    expect(a[a.indexOf('--body') + 1]).toContain('Prends plutôt Ida');
  });

  it('says why it cannot go: no Max, OpenRig stopped, its state unknown', async () => {
    ran.length = 0;
    expect(await createGoals({ state: async () => ({ ...RUNNING, rigs: [] }), run }).send('g1', 'x')).toMatchObject({ ok: false, error: 'no_operator' });
    expect(await createGoals({ state: async () => ({ ...RUNNING, daemon: { state: 'stopped' } }), run }).send('g1', 'x')).toMatchObject({ ok: false, error: 'openrig_stopped' });
    expect(await createGoals({ state: async () => ({ ...RUNNING, daemon: { state: 'unknown' } }), run }).send('g1', 'x')).toMatchObject({ ok: false, error: 'unreachable' });
    expect(ran).toEqual([]);
  });

  it('the protocol takes a goal and refuses an empty one or a bad id', () => {
    expect(parseClientMessage({ type: 'openrig.goal.send', requestId: 'r', goalId: '0f8a6b1e-4c1d-4f9a-9a77-1b2c3d4e5f60', text: 'x' })).toBeTruthy();
    expect(() => parseClientMessage({ type: 'openrig.goal.send', requestId: 'r', goalId: '0f8a6b1e-4c1d', text: '  ' })).toThrow();
    expect(() => parseClientMessage({ type: 'openrig.goal.send', requestId: 'r', goalId: '../../x', text: 'x' })).toThrow();
  });
});

describe('reading the goals', () => {
  const goalRow = (id: string, state: string, at: string, extra: Record<string, unknown> = {}) => ({
    qitemId: goalQitemId(id), sourceSession: 'ledge@external', destinationSession: MAX, state, tags: ['ledge-goal'],
    body: goalBody(`Objectif ${id}`, '/w/ledge', goalQitemId(id)), summary: `Objectif via Ledge : Objectif ${id}`, tsCreated: at, tsUpdated: at, resolution: null, ...extra });
  const proposal = (id: string, goal: string, state: string, at: string, answers: Record<string, unknown> = {}) => ({
    qitemId: id, sourceSession: MAX, destinationSession: 'ledge@external', state, tags: [`ledge-goal:${goalQitemId(goal)}`], body: block(TEAM), summary: 'Équipe proposée',
    humanQuestions: [{ id: 'team', question: 'Confirmer ?', options: [{ id: 'confirm', label: 'Confirmer l’équipe' }, { id: 'launch-rig', label: 'Lancer un rig plutôt' }] }],
    humanAnswers: answers, tsCreated: at, tsUpdated: at });

  function serve(routes: Record<string, unknown>): { http: RigHttp; calls: string[] } {
    const calls: string[] = [];
    return { calls, http: async (_m, url) => {
      // Routes are named without their limit (`limit=…` is the reader's own bound).
      const path = url.slice(BASE.length).replace(/[?&]limit=\d+$/, '');
      calls.push(path);
      const hit = routes[path];
      return hit === undefined ? { status: 200, json: [] } : hit === 503 ? { status: 503, json: {} } : { status: 200, json: hit };
    } };
  }
  const run: RigRun = async () => ({ code: 0, stdout: '{}', stderr: '' });
  const L = (q: string) => `/api/queue/list?${q}`;
  const ASKS = (since: string) => L(`destinationSession=ledge%40external&updatedSince=${encodeURIComponent(since)}`);

  it('a goal handed on: its trail from sent to the last seat, the answered proposal, the chain\'s current row', async () => {
    const g1 = goalRow('g1', 'handed-off', '2026-11-02T19:41:00.000Z', { handedOffTo: 'pilot-lead@ledge-dev' });
    const lead = { qitemId: 'q-lead', sourceSession: MAX, destinationSession: 'pilot-lead@ledge-dev', state: 'handed-off', tags: ['ledge-goal:qitem-ledge-goal-g1'], tsCreated: '2026-11-02T19:44:00.000Z', tsUpdated: '2026-11-02T19:46:00.000Z', claimedAt: '2026-11-02T19:45:00.000Z' };
    const lu = { qitemId: 'q-lu', sourceSession: 'pilot-lead@ledge-dev', destinationSession: 'design-ux@ledge-dev', state: 'in-progress', tags: ['ledge-goal:qitem-ledge-goal-g1'], tsCreated: '2026-11-02T19:46:00.000Z', tsUpdated: '2026-11-02T19:47:00.000Z', claimedAt: '2026-11-02T19:47:00.000Z' };
    const s = serve({
      [L('sourceSession=ledge%40external')]: [g1, { ...goalRow('x', 'done', '2026-11-02T10:00:00.000Z'), tags: ['human-answer'] }],
      [ASKS('2026-11-02T19:41:00.000Z')]: [proposal('p1', 'g1', 'done', '2026-11-02T19:42:00.000Z', { team: 'confirm' })],
      [`/api/queue/${goalQitemId('g1')}/transitions`]: [
        { state: 'pending', ts: '2026-11-02T19:41:00.000Z', actorSession: 'ledge@external', transitionNote: 'created' },
        { state: 'in-progress', ts: '2026-11-02T19:41:30.000Z', actorSession: MAX, transitionNote: 'claimed' },
        { state: 'in-progress', ts: '2026-11-02T19:41:40.000Z', actorSession: MAX, transitionNote: 'Je regarde les rigs' },
        { state: 'handed-off', ts: '2026-11-02T19:44:00.000Z', actorSession: MAX, transitionNote: 'handoff' }],
      [L(`handedOffFrom=${goalQitemId('g1')}`)]: [lead],
      [L('handedOffFrom=q-lead')]: [lu]
    });
    const { goals } = await createGoals({ state: async () => RUNNING, run, http: s.http }).list();
    expect(OpenRigGoalsChangedSchema.parse({ type: 'openrig.goalsChanged', goals })).toBeTruthy();
    expect(goals).toHaveLength(1);
    const g = goals[0]!;
    expect(g).toMatchObject({ goalId: 'g1', text: 'Objectif g1', folder: '/w/ledge', state: 'running', question: null,
      current: { qitemId: 'q-lu', seat: 'design-ux@ledge-dev', state: 'in-progress' } });
    expect(g.proposal).toMatchObject({ askId: 'p1', answer: { kind: 'option', id: 'confirm' }, answeredAt: '2026-11-02T19:42:00.000Z', text: 'Pas de nouveau rig.' });
    expect(g.proposal!.team!.seats.map(x => x.name)).toEqual(['Lu', 'Ida']);
    expect(g.trail.map(t => [t.kind, t.seat, t.to ?? t.text ?? ''])).toEqual([
      ['sent', 'ledge@external', MAX], ['taken', MAX, ''], ['note', MAX, 'Je regarde les rigs'],
      ['handed', MAX, 'pilot-lead@ledge-dev'], ['taken', 'pilot-lead@ledge-dev', ''], ['handed', 'pilot-lead@ledge-dev', 'design-ux@ledge-dev'], ['taken', 'design-ux@ledge-dev', '']]);
  });

  it('a proposal waiting, Max\'s question waiting, a new goal, one closed without handoff, and the latest proposal after a change of team', async () => {
    const s = serve({
      [L('sourceSession=ledge%40external')]: [
        goalRow('a', 'in-progress', '2026-11-02T19:50:00.000Z'), goalRow('b', 'in-progress', '2026-11-02T19:51:00.000Z'),
        goalRow('c', 'pending', '2026-11-02T19:52:00.000Z'), goalRow('d', 'done', '2026-11-02T19:53:00.000Z', { resolution: 'Réglé autrement' })],
      [ASKS('2026-11-02T19:50:00.000Z')]: [
        proposal('pa-old', 'a', 'done', '2026-11-02T19:50:10.000Z', { team: { kind: 'typed-reply', text: 'Prends plutôt Ida' } }),
        proposal('pa-new', 'a', 'pending', '2026-11-02T19:50:20.000Z'),
        { qitemId: 'qb', sourceSession: MAX, destinationSession: 'ledge@external', state: 'pending', tags: ['ledge-goal:qitem-ledge-goal-b'], body: 'Dans quel dossier ?', summary: 'Quel dossier ?', tsCreated: '2026-11-02T19:51:10.000Z', tsUpdated: '2026-11-02T19:51:10.000Z' }]
    });
    const { goals } = await createGoals({ state: async () => RUNNING, run, http: s.http }).list();
    const by = Object.fromEntries(goals.map(g => [g.goalId, g]));
    expect(goals.map(g => g.goalId)).toEqual(['d', 'c', 'b', 'a']);
    expect(by.a).toMatchObject({ state: 'proposed', proposal: { askId: 'pa-new', answer: null } });
    expect(by.b).toMatchObject({ state: 'asking', question: { askId: 'qb', text: 'Quel dossier ?' } });
    expect(by.c).toMatchObject({ state: 'sent', current: { seat: MAX, state: 'pending' } });
    expect(by.d).toMatchObject({ state: 'closed', current: null });
  });

  it('a goal Max closed and continued with a tagged row is followed by its tag', async () => {
    const s = serve({
      [L('sourceSession=ledge%40external')]: [goalRow('t', 'done', '2026-11-02T19:41:00.000Z')],
      [L(`updatedSince=${encodeURIComponent('2026-11-02T19:41:00.000Z')}`)]: [
        { qitemId: 'q-new', sourceSession: MAX, destinationSession: 'pilot-lead@ledge-dev', state: 'done', tags: ['ledge-goal:qitem-ledge-goal-t'], tsCreated: '2026-11-02T19:44:00.000Z', tsUpdated: '2026-11-02T19:50:00.000Z', resolution: 'Livré' }]
    });
    const [g] = (await createGoals({ state: async () => RUNNING, run, http: s.http }).list()).goals;
    expect(g).toMatchObject({ state: 'done', current: { qitemId: 'q-new', seat: 'pilot-lead@ledge-dev' } });
    expect(g!.trail.at(-1)).toMatchObject({ kind: 'closed', text: 'Livré' });
  });

  it('a chain handed on with handoff-and-complete (done, with a successor) goes on to the seat that works now', async () => {
    const g1 = goalRow('h', 'done', '2026-11-02T19:41:00.000Z', { handedOffTo: 'pilot-lead@ledge-dev', closureReason: 'handed_off_to' });
    const lead = { qitemId: 'q-lead', sourceSession: MAX, destinationSession: 'pilot-lead@ledge-dev', state: 'done', handedOffTo: 'dev-front@ledge-dev', closureReason: 'handed_off_to', tags: [], tsCreated: '2026-11-02T19:44:00.000Z', tsUpdated: '2026-11-02T19:46:00.000Z', claimedAt: '2026-11-02T19:45:00.000Z' };
    const dev = { qitemId: 'q-dev', sourceSession: 'pilot-lead@ledge-dev', destinationSession: 'dev-front@ledge-dev', state: 'in-progress', tags: [], tsCreated: '2026-11-02T19:46:00.000Z', tsUpdated: '2026-11-02T19:47:00.000Z', claimedAt: '2026-11-02T19:47:00.000Z' };
    const s = serve({
      [L('sourceSession=ledge%40external')]: [g1],
      [`/api/queue/${goalQitemId('h')}/transitions`]: [
        { state: 'pending', ts: '2026-11-02T19:41:00.000Z', actorSession: 'ledge@external', transitionNote: 'created' },
        { state: 'done', ts: '2026-11-02T19:44:00.000Z', actorSession: MAX, transitionNote: 'handoff', closureReason: 'handed_off_to' }],
      [L(`handedOffFrom=${goalQitemId('h')}`)]: [lead],
      [L('handedOffFrom=q-lead')]: [dev]
    });
    const [g] = (await createGoals({ state: async () => RUNNING, run, http: s.http }).list()).goals;
    expect(g).toMatchObject({ state: 'running', current: { qitemId: 'q-dev', seat: 'dev-front@ledge-dev', state: 'in-progress' } });
    expect(g!.trail.some(t => t.kind === 'closed')).toBe(false);
  });

  it('a chain longer than what is followed is never shown complete: running, partial', async () => {
    const hop = (i: number, state: string) => ({ qitemId: `q${i}`, sourceSession: `s${i}@r`, destinationSession: `s${i + 1}@r`, state, handedOffTo: state === 'done' ? `s${i + 2}@r` : undefined, tags: [], tsCreated: `2026-11-02T20:0${i}:00.000Z`, tsUpdated: `2026-11-02T20:0${i}:00.000Z` });
    const routes: Record<string, unknown> = { [L('sourceSession=ledge%40external')]: [goalRow('long', 'handed-off', '2026-11-02T19:41:00.000Z')], [L(`handedOffFrom=${goalQitemId('long')}`)]: [hop(0, 'handed-off')] };
    for (let i = 0; i < 9; i++) routes[L(`handedOffFrom=q${i}`)] = [hop(i + 1, i === 8 ? 'done' : 'handed-off')];
    const l = await createGoals({ state: async () => RUNNING, run, http: serve(routes).http }).list();
    expect(l.partial).toBe(true);
    expect(l.goals[0]!.state).toBe('running');
  });

  it('a read of Max\'s asks that fails keeps each goal as it was known; a full list is partial; Max gone does not hide the goals', async () => {
    let asksDown = false;
    const routes: Record<string, unknown> = {
      [L('sourceSession=ledge%40external')]: [goalRow('a', 'in-progress', '2026-11-02T19:50:00.000Z')],
      [ASKS('2026-11-02T19:50:00.000Z')]: [proposal('pa', 'a', 'pending', '2026-11-02T19:50:20.000Z')]
    };
    const base = serve(routes);
    let st: OpenRigState = RUNNING;
    const g = createGoals({ state: async () => st, run, http: async (m, u, b) => (asksDown && u.includes('destinationSession') ? { status: 503, json: {} } : base.http(m, u, b)) });
    expect((await g.list()).goals[0]).toMatchObject({ state: 'proposed', proposal: { askId: 'pa' } });
    asksDown = true;
    const l = await g.list();
    expect(l.partial).toBe(true);
    expect(l.goals[0]).toMatchObject({ state: 'proposed', proposal: { askId: 'pa' } });
    asksDown = false; st = { ...RUNNING, rigs: [] }; // no operator.agent: reading does not need Max
    expect((await g.list()).goals[0]).toMatchObject({ goalId: 'a', state: 'proposed' });
    // A list read that fills its limit may leave rows out: partial.
    const full = serve({ [L('sourceSession=ledge%40external')]: Array.from({ length: 2000 }, (_, i) => ({ qitemId: `other-${i}`, tags: [] })) });
    expect(await createGoals({ state: async () => RUNNING, run, http: full.http }).list()).toEqual({ goals: [], partial: true });
  });

  it('a goal row handed on whose successor is not found is running and partial, never closed', async () => {
    const s = serve({ [L('sourceSession=ledge%40external')]: [goalRow('lost', 'done', '2026-11-02T19:41:00.000Z', { handedOffTo: 'pilot-lead@ledge-dev', closureReason: 'handed_off_to' })] });
    const l = await createGoals({ state: async () => RUNNING, run, http: s.http }).list();
    expect(l.partial).toBe(true);
    expect(l.goals[0]).toMatchObject({ state: 'running' });
  });

  it('a first read that fails, with nothing known yet, is an empty list said partial, not an empty list', async () => {
    expect(await createGoals({ state: async () => RUNNING, run, http: async () => ({ status: 503, json: {} }) }).list()).toEqual({ goals: [], partial: true });
    expect(await createGoals({ state: async () => ({ ...RUNNING, daemon: { state: 'unknown' } }), run }).list()).toEqual({ goals: [], partial: true });
  });

  it('a list that cannot be read keeps the goals known, partial; a stop empties them', async () => {
    let fail = false, st: OpenRigState = RUNNING;
    const ok = serve({ [L('sourceSession=ledge%40external')]: [goalRow('k', 'pending', '2026-11-02T19:41:00.000Z')] });
    const g = createGoals({ state: async () => st, run, http: async (m, u, b) => (fail ? { status: 503, json: {} } : ok.http(m, u, b)) });
    expect((await g.list()).goals).toHaveLength(1);
    fail = true;
    expect(await g.list()).toMatchObject({ partial: true, goals: [{ goalId: 'k' }] });
    fail = false; st = { ...RUNNING, daemon: { state: 'unknown' } };
    expect(await g.list()).toMatchObject({ partial: true, goals: [{ goalId: 'k' }] });
    st = { ...RUNNING, daemon: { state: 'stopped' } };
    expect(await g.list()).toEqual({ goals: [] });
  });
});
