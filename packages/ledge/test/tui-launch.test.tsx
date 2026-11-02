import { afterEach, describe, it, expect } from 'vitest';
import { forgetRigSpecs } from '@ledge/fleet';
import type { ClientMessage, Rig, RigPlan, RigSpecInfo } from '@ledge/protocol';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const ESC = '\u001b';
const CTRL_S = '\u0013';
const CTRL_T = '\u0014';
type Tui = Awaited<ReturnType<typeof startTui>>;

const SPECS: RigSpecInfo[] = [
  { id: 'starter', name: 'starter', source: 'builtin', seats: [
    { address: '@build', member: 'build', pod: 'dev', runtime: 'claude-code' }, { address: '@review', member: 'review', pod: 'dev', runtime: 'codex' }] },
  { id: 'factory', name: 'factory', source: 'builtin', seats: ['lead', 'build', 'review-a', 'review-b', 'qa', 'design'].map(m => ({ address: `@${m}`, member: m, pod: 'dev', runtime: 'claude-code' })) }
];

/** The daemon answers the specs request, and each rig.prepare with a plan of its own (plan-1, plan-2…). */
function openRigDaemon(tui: Tui) {
  let plans = 0;
  tui.daemon.onMessage(m => {
    if (m.type === 'rig.specs.request') tui.daemon.reply({ type: 'rig.specs', requestId: m.requestId, machine: 'local', specs: SPECS });
    if (m.type === 'rig.prepare') {
      const plan: RigPlan = { id: `plan-${++plans}`, machine: 'local', spec: m.spec, goal: m.goal, where: m.where,
        cwd: m.where.kind === 'project' && m.where.copy ? `/w/ledge/.worktrees/rig-${m.spec}` : '/w/ledge', seats: [{ address: '@build', runtime: 'claude-code', model: 'opus', autonomy: 'auto' }, { address: '@review', runtime: 'codex', autonomy: 'auto' }],
        writes: ['CLAUDE.md', '.mcp.json', '.openrig/'], command: `rig up ${m.spec}`, required: m.where.kind === 'project' && !m.where.copy };
      tui.daemon.reply({ type: 'rig.plan', rid: m.rid, plan });
    }
  });
}

/** The rig the daemon makes of plan `planId`, its seats in `states`. */
const launched = (planId: string, states: Array<Rig['seats'][number]['state']>, extra: Partial<Rig> = {}): Rig => ({
  id: 'reconnexion', name: 'reconnexion', machine: 'local', cwd: '/w/ledge/.worktrees/rig-starter', projectId: 'ledge', offProject: false, lifecycle: 'launching', kernel: false,
  seats: states.map((state, i) => ({ ref: `${['build', 'review'][i]}@reconnexion`, address: `@${['build', 'review'][i]}`, name: ['build', 'review'][i]!, runtime: 'claude-code', state })),
  repos: [], launch: { planId, goal: 'g', lead: 'build@reconnexion', startedAt: new Date().toISOString() }, ...extra
});

/** The rig form, from `+` then ctrl+t, its goal typed and the spec Ledge recommends chosen. */
async function rigForm(tui: Tui, goal = 'Réparer la reconnexion ssh') {
  await tui.press('+');
  await until(() => tui.frame().includes('NOUVELLE SESSION'));
  await tui.press(CTRL_T);
  await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ'));
  await tui.press(goal);
  await until(() => tui.frame().includes(goal) && /◂ starter ▸/.test(tui.frame()));
}

describe('ledge tui: launch a rig', () => {
  afterEach(() => { forgetRigSpecs(); });

  it('ctrl+s in a copy sends rig.prepare then rig.launch, and ↵ opens the rig\'s room once it runs', async () => {
    const tui = await startTui({ openrig: {} });
    openRigDaemon(tui);
    try {
      await tui.resize(160, 46);
      await rigForm(tui);
      expect(tui.frame()).toContain('Plan facultatif');
      expect(tui.frame()).toMatch(/▣ .* · équipe starter · dans Ledge · 2 sièges · /);
      await tui.press(CTRL_S);
      await until(() => sent(tui.daemon.received, 'rig.launch').length === 1);
      expect(sent(tui.daemon.received, 'rig.prepare')).toEqual([expect.objectContaining({ machine: 'local', spec: 'starter', goal: 'Réparer la reconnexion ssh',
        where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/starter', copy: true } })]);
      expect(sent(tui.daemon.received, 'rig.launch')[0]).toMatchObject({ planId: 'plan-1' });
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE DÉMARRAGE'));
      expect(tui.frame()).toMatch(/◐ OpenRig/);
      // The rig comes up: its seats one by one, then the launch's answer.
      tui.daemon.push({ type: 'rig.updated', rig: launched('plan-1', ['working', 'starting']) });
      await until(() => /◐ Sièges +1\/2 prêt · review démarre…/.test(tui.frame()));
      tui.daemon.push({ type: 'rig.updated', rig: launched('plan-1', ['working', 'idle'], { lifecycle: 'running' }) });
      tui.daemon.reply({ type: 'rig.result', rid: sent(tui.daemon.received, 'rig.launch')[0]!.rid, ok: true });
      await until(() => /✓ Sièges +2\/2 prêts/.test(tui.frame()));
      await tui.press('\r');
      await until(() => tui.frame().includes('▣ RECONNEXION · ÉQUIPE'));
    } finally { await tui.cleanup(); }
  });

  it('without a copy, ctrl+s shows the plan and only then launches', async () => {
    const tui = await startTui({ openrig: {} });
    openRigDaemon(tui);
    try {
      await tui.resize(160, 46);
      await rigForm(tui);
      // tab down to the copy, space unticks it: the plan is imposed.
      for (let i = 0; i < 20 && !/▌Copie/.test(tui.frame()); i++) await tui.press('\t');
      await tui.press(' ');
      await until(() => tui.frame().includes('Le plan est demandé une fois : l’équipe écrirait dans ton dépôt.'));
      expect(tui.frame()).toMatch(/Voir le plan ctrl\+s/);
      expect(tui.frame()).not.toMatch(/Lancer ctrl\+s/);
      await tui.press(CTRL_S);
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE PLAN DE LEDGE'));
      expect(tui.frame()).toContain('CLAUDE.md');
      expect(tui.frame()).toContain('rig up starter');
      expect(sent(tui.daemon.received, 'rig.prepare')[0]!.where).toMatchObject({ copy: false });
      expect(sent(tui.daemon.received, 'rig.launch')).toEqual([]);
      await tui.press(CTRL_S);
      await until(() => sent(tui.daemon.received, 'rig.launch').length === 1);
      expect(sent(tui.daemon.received, 'rig.launch')[0]).toMatchObject({ planId: 'plan-1' });
      await until(() => tui.frame().includes('LE DÉMARRAGE'));
    } finally { await tui.cleanup(); }
  });

  it('a failed launch comes back with its reason and launches again from a new plan', async () => {
    const tui = await startTui({ openrig: {} });
    openRigDaemon(tui);
    tui.daemon.onMessage(m => { if (m.type === 'rig.launch') tui.daemon.reply({ type: 'rig.result', rid: m.rid, ok: false, code: 'failed', reason: 'rig up a échoué' }); });
    try {
      await rigForm(tui);
      await tui.press(CTRL_S);
      await until(() => tui.frame().includes('Refusé : rig up a échoué'));
      expect(tui.frame()).toContain('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ');
      await tui.press(CTRL_S);
      await until(() => sent(tui.daemon.received, 'rig.launch').length === 2);
      expect(sent(tui.daemon.received, 'rig.prepare')).toHaveLength(2);
      expect(sent(tui.daemon.received, 'rig.launch').map(m => m.planId)).toEqual(['plan-1', 'plan-2']);
    } finally { await tui.cleanup(); }
  });

  it('a machine without OpenRig shows the install command, ctrl+s launches nothing', async () => {
    const tui = await startTui({ openrig: { rigs: [], escalations: [], status: { machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' } } });
    openRigDaemon(tui);
    try {
      await rigForm(tui);
      await until(() => tui.frame().includes('npm i -g @openrig/cli'));
      expect(tui.frame()).toContain('OpenRig n’est pas installé sur Local');
      await tui.press(CTRL_S);
      await tui.press('v');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'rig.prepare')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('a seat waiting for trust is attached on ↵, « Annuler le lancement » sends rig.act down', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ openrig: {}, run: async argv => { runs.push(argv); return 0; } });
    openRigDaemon(tui);
    tui.daemon.onMessage(m => { if (m.type === 'rig.act') tui.daemon.reply({ type: 'rig.result', rid: m.rid, ok: true }); });
    try {
      await rigForm(tui);
      await tui.press(CTRL_S);
      await until(() => tui.frame().includes('LE DÉMARRAGE'));
      tui.daemon.push({ type: 'rig.updated', rig: launched('plan-1', ['working', 'trust']) });
      await until(() => tui.frame().includes('review attend ta confiance dans le dossier · ↵ ouvrir l’invite'));
      await tui.press('\r');
      await until(() => runs.length === 1);
      expect(runs[0]!.join(' ')).toContain('review@reconnexion');
      await tui.press('x');
      await until(() => sent(tui.daemon.received, 'rig.act').length === 1);
      expect(sent(tui.daemon.received, 'rig.act')[0]).toMatchObject({ machine: 'local', rigId: 'reconnexion', verb: 'down' });
      await until(() => tui.frame().includes('lancement annulé'));
    } finally { await tui.cleanup(); }
  });

  it('« Lance une équipe… » and + on a rig open the rig mode directly; ctrl+t goes back to the session', async () => {
    const tui = await startTui({ openrig: {} });
    openRigDaemon(tui);
    try {
      await tui.press('2'); // a rig chosen in the left column
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ'));
      await tui.press(CTRL_T);
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press(ESC);
      await until(() => !tui.frame().includes('NOUVELLE SESSION'));
      await tui.press('/');
      await tui.press(`${ESC}1`); // alt+1: the first suggestion
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ'));
    } finally { await tui.cleanup(); }
  });
});

/** Lot F final review I1: the launch entry points follow the engine in force, not whether the bridge reports an OpenRig status. */
describe('ledge tui: « Lancer une équipe » follows the teams engine', () => {
  const T0 = '2026-11-01T08:00:00.000Z';
  const LEDGE_TEAM: Rig = { id: 'team-a1b2', name: 'ledge-roles', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, engine: 'ledge', repos: [],
    seats: [{ ref: 'build@team-a1b2', address: '@build', name: 'Nova', runtime: 'codex', state: 'working', sessionId: 'nova' }] };
  /** Ledge mode, with an OpenRig status still reported by the bridge (it always is on this branch): roles and templates answered, team.launch launched. */
  async function ledgeMode() {
    const tui = await startTui();
    tui.daemon.onMessage(m => {
      if (m.type === 'roles.list') tui.daemon.push({ type: 'roles.listing', requestId: m.requestId, roles: [{ id: 'lead', label: 'Chef', prompt: '', source: 'home', path: '/h/lead.md' }], templates: [{ id: 'workshop', name: 'workshop', seats: [{ role: 'lead' }], source: 'home', path: '/h/w.yaml' }], problems: [] });
      if (m.type === 'team.launch') tui.daemon.push({ type: 'team.launched', rid: m.rid, team: { id: 'team-e5f6', name: 'workshop', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [], createdAt: T0, updatedAt: T0 } });
    });
    await tui.resize(160, 46);
    tui.daemon.push({ type: 'teams.engine', engine: 'ledge', openrigAvailable: true, running: true });
    tui.daemon.push({ type: 'openrig.status', status: { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' } });
    tui.daemon.push({ type: 'rig.snapshot', machine: 'local', rigs: [LEDGE_TEAM] });
    await until(() => tui.frame().includes('▣ ledge-roles'));
    return tui;
  }
  const ledgeForm = (tui: Tui) => until(() => tui.frame().includes('L’équipe workshop aura sa propre pièce dans Ledge.'));

  it('Ledge: + on a team row opens Ledge’s team form, never OpenRig’s plan launch; its objective goes with team.launch', async () => {
    const tui = await ledgeMode();
    try {
      await tui.press('2'); // the team chosen in the left column
      await tui.press('+');
      await ledgeForm(tui);
      expect(tui.frame()).not.toContain('LE BUT, LA SPEC, OÙ');
      expect(tui.frame()).toContain('Objectif');
      // tab to the objective (project → folder → template → seats → name → objective… from the template)
      for (let i = 0; i < 3; i++) await tui.press('\t');
      await tui.press('Réparer la reconnexion ssh');
      await until(() => tui.frame().includes('Réparer la reconnexion ssh'));
      await tui.press(CTRL_S);
      await until(() => sent(tui.daemon.received, 'team.launch').length === 1);
      expect(sent(tui.daemon.received, 'team.launch')[0]).toMatchObject({ cwd: '/w/ledge', template: 'workshop', objective: { goal: 'Réparer la reconnexion ssh' } });
      expect(sent(tui.daemon.received, 'rig.prepare')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('Ledge: « Lance une équipe… » of the composer and ctrl+t of the session form open Ledge’s team form', async () => {
    const tui = await ledgeMode();
    try {
      await tui.press('/');
      await tui.press(`${ESC}1`); // alt+1: the first suggestion
      await ledgeForm(tui);
      expect(tui.frame()).not.toContain('LE BUT, LA SPEC, OÙ');
      await tui.press(ESC);
      await until(() => !tui.frame().includes('NOUVELLE ÉQUIPE'));
      await tui.press('3'); // a session's screen, not a team's row: + opens the session form
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press(CTRL_T);
      await ledgeForm(tui);
      expect(tui.frame()).not.toContain('LE BUT, LA SPEC, OÙ');
    } finally { await tui.cleanup(); }
  });

  it('Ledge: + on the « Équipes » tab of Ledge’s home opens Ledge’s team form', async () => {
    const tui = await ledgeMode();
    try {
      await tui.press('1');
      await tui.press('\r'); // Ledge's field
      await tui.press('\t'); // its conversation, whose ← → change the tab
      await tui.press('\u001b[C'); // → « Équipes »
      await new Promise(r => setTimeout(r, 100));
      await tui.press('+');
      await ledgeForm(tui);
      expect(tui.frame()).not.toContain('LE BUT, LA SPEC, OÙ');
    } finally { await tui.cleanup(); }
  });

  it('OpenRig: + on a team row and ctrl+t still open OpenRig’s plan launch', async () => {
    const tui = await startTui({ openrig: {} });
    openRigDaemon(tui);
    try {
      tui.daemon.push({ type: 'teams.engine', engine: 'openrig', openrigAvailable: true, running: true });
      await tui.press('2');
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ'));
      await tui.press(CTRL_T);
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press(CTRL_T);
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE · LE BUT, LA SPEC, OÙ'));
    } finally { await tui.cleanup(); }
  });
});
