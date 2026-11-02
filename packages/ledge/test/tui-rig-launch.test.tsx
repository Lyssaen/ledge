import { describe, it, expect } from 'vitest';
import type { OpenRigState, RigLaunch, RigSpec } from '@ledge/protocol';
import {
  emptyForm, fieldsOf, folderChoices, launchOf, missingOf, moveField, nextFolder, orderSpecs, rolesOf, warningLines, withModel, withPolicy, withRolePolicy, withRuntime, withSeats, withSpec, yoloChosen
} from '../src/tui/model/rigLaunch.js';
import { PROJECTS, startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const STARTER: RigSpec = { name: 'starter', source: 'builtin', summary: 'A builder and a reviewer', path: '/s/starter/rig.yaml', edges: 1,
  pods: [{ id: 'dev', label: 'Project', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'review', runtime: 'codex', model: 'gpt-6-astra', agent: 'qa' }] }] };
const MINE: RigSpec = { name: 'ledge-x3', source: 'user', path: '/u/ledge-x3/rig.yaml', edges: 3, pods: [{ id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }] }] };
const FACTORY: RigSpec = { name: 'factory', source: 'builtin', path: '/s/factory/rig.yaml', edges: 0, pods: [{ id: 'orch', members: [{ id: 'lead', runtime: 'claude-code', agent: 'orchestrator' }] }] };

describe('rig launch model', () => {
  it('the person’s specs first, then OpenRig’s, by name; a role per pod.member', () => {
    expect(orderSpecs([STARTER, FACTORY, MINE]).map(s => s.name)).toEqual(['ledge-x3', 'factory', 'starter']);
    expect(rolesOf(STARTER)).toEqual([
      { role: 'dev.build', pod: 'dev', member: 'build', agent: 'implementer', runtime: 'claude-code' },
      { role: 'dev.review', pod: 'dev', member: 'review', agent: 'qa', runtime: 'codex', model: 'gpt-6-astra' }
    ]);
  });
  it('sends only what differs from the spec: 3 builds and 3 reviews in pairs, a harness, a model, saved', () => {
    const roles = rolesOf(STARTER);
    let f = withSpec(emptyForm(null, '~/w/ledge'), 'starter');
    expect(launchOf(f, roles, true)).toEqual({ spec: 'starter', cwd: '~/w/ledge', name: 'starter', plan: true });
    f = withSeats(withSeats(withSeats(withSeats(f, 'dev.build', 1), 'dev.build', 1), 'dev.review', 1), 'dev.review', 1);
    f = withRuntime(f, roles[1]!, 1); // codex → claude-code
    f = withModel(f, roles[0]!, ' opus ');
    f = { ...f, name: 'ledge-scale', save: true };
    const l: RigLaunch = launchOf(f, roles, false);
    expect(l).toEqual({ spec: 'starter', cwd: '~/w/ledge', name: 'ledge-scale', seats: { 'dev.build': 3, 'dev.review': 3 }, runtimes: { 'dev.review': 'claude-code' }, models: { 'dev.build': 'opus' }, delegation: 'pairs', save: true });
    // Back to the spec's own harness and model: no change sent.
    expect(launchOf(withModel(withRuntime(f, roles[1]!, 1), roles[0]!, ''), roles, false)).not.toHaveProperty('runtimes');
    // 0 to 9 seats; another spec starts its roles over.
    expect(withSeats(withSeats(f, 'dev.build', -9), 'dev.build', -1).seats['dev.build']).toBe(0);
    expect(withSeats(f, 'dev.build', 20).seats['dev.build']).toBe(9);
    expect(withSpec(f, 'factory')).toMatchObject({ spec: 'factory', seats: {}, runtimes: {}, models: {}, name: 'ledge-scale', cwd: '~/w/ledge' });
  });
  it('permissions: the rig’s policy and a role’s are sent only when chosen; --non-interruptive only with YOLO somewhere', () => {
    const roles = rolesOf(STARTER);
    let f = withSpec(emptyForm(null, '/w'), 'starter');
    expect(launchOf(f, roles, false)).not.toHaveProperty('policy');
    f = withPolicy(f, 1); expect(f.policy).toBe('auto');
    f = withPolicy(withPolicy(f, -1), -1); expect(f.policy).toBe('locked');
    f = withPolicy(f, 1); expect(f.policy).toBeNull();
    f = withPolicy(f, 2); // standard
    f = withRolePolicy(withRolePolicy(withRolePolicy(withRolePolicy(f, 'dev.review'), 'dev.review'), 'dev.review'), 'dev.review'); // auto, standard, open, yolo
    expect(f.policies).toEqual({ 'dev.review': 'yolo' });
    expect(yoloChosen(f, roles)).toBe(true);
    expect(fieldsOf(roles, true)).toEqual(['spec', 'cwd', 'name', 'role:0', 'role:1', 'policy', 'nonInterruptive', 'delegation', 'save']);
    expect(launchOf({ ...f, nonInterruptive: true }, roles, false)).toMatchObject({ policy: 'standard', policies: { 'dev.review': 'yolo' }, nonInterruptive: true });
    // No YOLO left: the box ticked is not sent.
    const back = withRolePolicy(withRolePolicy(f, 'dev.review'), 'dev.review'); // locked, then as the rig
    expect(back.policies).toEqual({});
    expect(launchOf({ ...back, nonInterruptive: true }, roles, false)).not.toHaveProperty('nonInterruptive');
    // Another spec: the roles' policies start over, the rig's stays.
    expect(withSpec(f, 'factory')).toMatchObject({ policy: 'standard', policies: {} });
  });
  it('says what is missing', () => {
    const roles = rolesOf(STARTER);
    expect(missingOf(emptyForm(null, '/w'), roles)).toBe('spec');
    expect(missingOf(withSpec(emptyForm(null, ' '), 'starter'), roles)).toBe('cwd');
    expect(missingOf({ ...withSpec(emptyForm(null, '/w'), 'starter'), name: '-x' }, roles)).toBe('name');
    expect(missingOf(withSeats(withSeats(withSpec(emptyForm(null, '/w'), 'starter'), 'dev.build', -1), 'dev.review', -1), roles)).toBe('seats');
    expect(missingOf(withSpec(emptyForm(null, '/w'), 'starter'), roles)).toBeNull();
  });
  it('folders: the projects’ ones on this machine; ← → cycles them', () => {
    const c = folderChoices(PROJECTS, 'local');
    expect(c.map(x => x.path)).toEqual(['/w/ledge', '/w/ledge-ssh', '/w/ledge-docs', '/w/website']);
    expect(folderChoices(PROJECTS, 'ec2')).toEqual([]);
    expect(nextFolder(c, '/w/website', 1)).toBe('/w/ledge');
    expect(nextFolder(c, '/elsewhere', -1)).toBe('/w/website');
    expect(nextFolder([], '/x', 1)).toBe('/x');
  });
  it('the same warning for several seats reads as one line naming them', () => {
    expect(warningLines(['dev.build: permission_policy absent; launch_posture=floor', 'dev.review: permission_policy absent; launch_posture=floor', 'no cmux'])).toEqual([
      { text: 'permission_policy absent; launch_posture=floor', seats: ['dev.build', 'dev.review'] }, { text: 'no cmux', seats: [] }
    ]);
  });
  it('fields in tab order, one per role, wrapping', () => {
    const f = fieldsOf(rolesOf(STARTER));
    expect(f).toEqual(['spec', 'cwd', 'name', 'role:0', 'role:1', 'policy', 'delegation', 'save']);
    expect(moveField(f, 'save', 1)).toBe('spec');
    expect(moveField(f, 'role:5', 1)).toBe('spec');
  });
});

const STATE: OpenRigState = { installed: true, daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, rigs: [], at: '' };

describe('ledge tui: launch a rig (+ on the OpenRig screen)', () => {
  it('lists the specs, p checks and shows the plan and the YAML, ctrl+s launches and goes back to the OpenRig screen', async () => {
    const tui = await startTui();
    try {
      const launches: RigLaunch[] = [];
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
        if (m.type === 'openrig.specs') tui.daemon.push({ type: 'openrig.specList', requestId: m.requestId, specs: [STARTER, MINE] });
        if (m.type === 'openrig.launch') {
          launches.push(m.launch);
          tui.daemon.push({ type: 'openrig.launched', requestId: m.requestId, ok: true, plan: !!m.launch.plan, commands: [`rig up ${m.launch.name}`], seats: 4, yaml: 'name: ledge-scale\npods:\n  - id: dev',
            ...(m.launch.plan ? { check: { status: 'planned', errors: [], warnings: ['dev.build: permission_policy absent; launch_posture=floor', 'dev.review: permission_policy absent; launch_posture=floor'] } } : {}) });
        }
      });
      await tui.resize(110, 36);
      await tui.press('6');
      await until(() => tui.frame().includes('RIGS'));
      await tui.press('+');
      await until(() => tui.frame().includes('ledge-x3'));
      // The person's spec is first, chosen; → takes OpenRig's starter.
      await tui.press('\u001b[C');
      await until(() => tui.frame().includes('dev.review'));
      expect(tui.frame()).toContain('/w/ledge');
      // tab to the folder, the name, then the first role: + twice.
      await tui.press('\t'); await tui.press('\t');
      await tui.press('ledge-scale');
      await tui.press('\t'); await tui.press('+');
      await until(() => tui.frame().includes('par paires'));
      // 4 · Permissions: ← → to YOLO (red explanation), the box appears and is ticked with space.
      await tui.press('\t'); await tui.press('\t');
      for (let i = 0; i < 4; i++) await tui.press('\u001b[C');
      await until(() => tui.frame().includes('◂ YOLO ▸') && tui.frame().includes('aucune demande'));
      await tui.press('\t'); await tui.press(' ');
      await until(() => tui.frame().includes('✓ accepter les avertissements'));
      expect(tui.frame()).toContain('dev.review'); // the roles keep their room
      await tui.press('p');
      await until(() => tui.frame().includes('le plan passe'));
      const f = tui.frame();
      expect(f).toContain('permission_policy absent');
      expect(f.match(/permission_policy absent/g)).toHaveLength(1);
      expect(f).toContain('name: ledge-scale');
      expect(launches[0]).toEqual({ spec: 'starter', cwd: '/w/ledge', name: 'ledge-scale', seats: { 'dev.build': 2 }, policy: 'yolo', nonInterruptive: true, delegation: 'pairs', plan: true });
      await tui.press('\u0013'); // ctrl+s
      await until(() => launches.length === 2);
      expect(launches[1]).not.toHaveProperty('plan');
      await until(() => tui.frame().includes('RIGS') && !tui.frame().includes('ledge-x3'));
      expect(tui.frame()).toContain('Rig « ledge-scale » lancé · 4 sièges.');
    } finally { await tui.cleanup(); }
  }, 15_000);
  it('daemon stopped: says to start it first; esc goes back to the OpenRig screen', async () => {
    const tui = await startTui();
    try {
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
        if (m.type === 'openrig.specs') tui.daemon.push({ type: 'openrig.specList', requestId: m.requestId, specs: [], error: 'daemon_stopped' });
      });
      await tui.press('6'); await until(() => tui.frame().includes('RIGS'));
      await tui.press('+');
      await until(() => tui.frame().includes('Démarrez le daemon OpenRig d’abord'));
      await tui.press('\u001b');
      await until(() => tui.frame().includes('RIGS'));
    } finally { await tui.cleanup(); }
  });
});
