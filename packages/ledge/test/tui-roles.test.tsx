import { describe, it, expect } from 'vitest';
import type { OpenRigState, RoleDetail, RoleSeat, RoleSummary, StartupEntry } from '@ledge/protocol';
import { glyphsFor } from '../src/tui/glyphs.js';
import { fr } from '../src/tui/i18n/fr.js';
import { contextRows, fileAsks, lenses, listItems, pieces, provText, roleDocs, roleRows, yamlRows } from '../src/tui/model/roles.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const LIB = '/home/u/.openrig/specs/openrig/agents';
const sum = (o: Partial<RoleSummary> & Pick<RoleSummary, 'id' | 'name'>): RoleSummary => ({ source: 'user', path: `${LIB}/${o.name}/agent.yaml`, importOnly: false, seats: 0, running: 0, skills: [], startupFiles: [], seatRefs: [], ...o });
const ROLES: RoleSummary[] = [
  sum({ id: 'u1', name: 'ledge-developer', version: '1.0', description: 'Dev de ledge-dev', runtime: 'claude-code', seats: 1, running: 1, seatRefs: [{ rig: 'ledge-dev', logicalId: 'dev.front', session: 'dev-front@ledge-dev' }] }),
  sum({ id: 'u2', name: 'shared', importOnly: true }),
  sum({ id: 'b1', name: 'pm', source: 'builtin', path: '/n/pm/agent.yaml', description: 'Product Manager', skills: ['terraform-plan'] })
];
const roleMd: StartupEntry = { kind: 'file', path: 'guidance/role.md', absolutePath: `${LIB}/developer/guidance/role.md`, size: 1843, layer: 'agent', layerInferred: false, delivery: 'send_text', required: true, orientation: 'role', appliesOn: ['fresh_start', 'restore'], origin: { kind: 'here', key: 'startup.files[0]' } };
const scope: StartupEntry = { kind: 'file', path: 'guidance/scope-front.md', absolutePath: '/home/u/.ledge/rigs/ledge-dev/guidance/scope-front.md', size: 700, layer: 'member', layerInferred: true, delivery: 'send_text', required: true, appliesOn: ['fresh_start', 'restore'], origin: { kind: 'inherited', from: 'member', ref: 'dev.front' } };
const missing: StartupEntry = { kind: 'file', path: 'openrig-seat-skills.md', absolutePath: '/o/openrig-seat-skills.md', size: 175, layer: 'openrig', layerInferred: true, delivery: 'guidance_merge', into: '/home/u/Workspace/ledge/CLAUDE.md', delivered: false, required: false, appliesOn: ['fresh_start'], origin: { kind: 'unknown', why: 'missing_from_guidance' } };
const src = (value: string | null, origin: RoleSeat['runtime']['origin']) => ({ value, origin });
const member = { kind: 'inherited' as const, from: 'member' as const, ref: 'dev.front' };
const SEAT: RoleSeat = {
  rig: 'ledge-dev', rigId: 'r1', rigSpecPath: '/home/u/.ledge/rigs/ledge-dev/rig.yaml', composed: true, logicalId: 'dev.front', session: 'dev-front@ledge-dev', profile: 'default', running: true, activity: 'running',
  runtime: src('claude-code', member), model: src('claude-opus-5-5', member), effort: src(null, { kind: 'inherited', from: 'launch', ref: 'runtime_default' }), cwd: src('/home/u/Workspace/ledge', member), cultureFile: src('CULTURE.md', { kind: 'inherited', from: 'rig', ref: 'ledge-dev' }),
  member: '- id: front\n  model: claude-opus-5-5', memberStartup: [scope], roleDocs: [roleMd, scope],
  live: { resolvedSpec: {}, resources: [], startup: [roleMd, scope, missing], skills: [{ id: 'queue-handoff' }] }
};
const uses = (declared: boolean, key: string) => ({ declared, key, items: [] });
const DEV: RoleDetail = {
  summary: ROLES[0]!, file: { path: `${LIB}/developer/agent.yaml`, copies: [{ kind: 'repo', path: '/w/agent.yaml', identical: true }] },
  role: { path: 'guidance/role.md', absolutePath: roleMd.absolutePath!, origin: { kind: 'here' } },
  defaults: { runtime: src('claude-code', { kind: 'here', key: 'defaults.runtime' }), model: src(null, { kind: 'absent' }), effort: src(null, { kind: 'absent' }) },
  imports: [{ ref: 'local:../shared', key: 'imports[0].ref', resolved: true, path: `${LIB}/shared/agent.yaml` }], importedBy: [],
  profiles: [{ name: 'default', runtime: src('claude-code', { kind: 'here', key: 'defaults.runtime' }), model: src(null, { kind: 'absent' }), effort: src(null, { kind: 'absent' }),
    uses: { skills: uses(true, 'skills'), guidance: uses(false, 'guidance'), subagents: uses(true, 'subagents'), plugins: uses(true, 'plugins'), runtimeResources: uses(true, 'runtime_resources') }, startup: [roleMd] }],
  resources: [], seats: [SEAT], unavailable: ['harness_prompt', 'effective_settings'], warnings: [], openrigVersion: '0.7.7'
};
const FILES: Record<string, string> = { [roleMd.absolutePath!]: '# Rôle : développeur de ledge-dev\n\nTu implémentes la tâche.', [scope.absolutePath!]: '# Ton périmètre : front-end', [DEV.file.path]: 'name: ledge-developer\nversion: "1.0"', [`${LIB}/shared/agent.yaml`]: 'name: shared' };
const STATE: OpenRigState = { installed: true, version: '0.7.7', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: '2026-11-02T09:00:00.000Z',
  rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [{ logicalId: 'dev.front', session: 'dev-front@ledge-dev', runtime: 'claude-code', model: 'claude-opus-5-5', sessionStatus: 'running', lifecycleState: 'running', activity: 'running', stopped: false, work: 0 }] }] };

describe('Roles view model (TUI)', () => {
  const g = glyphsFor({}), ascii = glyphsFor({ LEDGE_TUI_ASCII: '1' });
  it('says each provenance in words, and short at 80 columns; ASCII has its own glyphs', () => {
    expect(provText({ kind: 'here' }, fr, g)).toBe('● ici');
    expect(provText(member, fr, g)).toBe('↳ membre dev.front');
    expect(provText(member, fr, g, true)).toBe('↳ dev.front');
    expect(provText({ kind: 'inherited', from: 'launch', ref: 'runtime_default' }, fr, g)).toBe('↳ lancement');
    expect(provText({ kind: 'absent' }, fr, g)).toBe('○ non déclaré');
    expect(provText({ kind: 'unknown', why: 'not_exposed' }, fr, g)).toBe('? non exposé');
    expect([provText({ kind: 'here' }, fr, ascii), provText(member, fr, ascii, true), provText({ kind: 'absent' }, fr, ascii)]).toEqual(['* ici', '> dev.front', 'o non déclaré']);
    expect(ascii.rail).toBe('|');
  });
  it('the list: my specs, then OpenRig’s group, folded unless searched', () => {
    expect(listItems(ROLES, '', false).items.map(i => (i.kind === 'role' ? i.role.name : '▸'))).toEqual(['ledge-developer', 'shared', '▸']);
    expect(listItems(ROLES, 'terraform', false).items.map(i => (i.kind === 'role' ? i.role.name : '▸'))).toEqual(['▸', 'pm']);
  });
  it('« vu »: the spec then the seats; Rôle: role.md, then the seat’s file; Contexte: the harness first, OpenRig’s order', () => {
    expect(lenses(DEV).map(s => s?.logicalId ?? 'spec')).toEqual(['spec', 'dev.front']);
    expect(roleDocs(DEV, null).map(e => e.path)).toEqual(['guidance/role.md']);
    expect(roleDocs(DEV, SEAT).map(e => e.path)).toEqual(['guidance/role.md', 'guidance/scope-front.md']);
    expect(pieces(DEV, SEAT).map(p => (p.kind === 'harness' ? 'harness' : p.entry.path))).toEqual(['harness', 'guidance/role.md', 'guidance/scope-front.md', 'openrig-seat-skills.md']);
  });
});

describe('Roles view: long lines and late answers (TUI)', () => {
  const g = glyphsFor({});
  const text = (rows: Array<{ line: Array<{ text: string }> }>) => rows.map(r => r.line.map(x => x.text).join('')).join('\n');
  const long = `description: ${'mot '.repeat(40)}FIN-RECONNAISSABLE`;
  it('a long YAML, raw or action line wraps at the pane’s width, its end readable, at 80 and 120 columns', () => {
    for (const width of [76, 116]) {
      const files = { [DEV.file.path]: { content: `name: x\n${long}` }, [roleMd.absolutePath!]: { content: long } };
      const yaml = yamlRows(DEV, null, files, { width }, fr);
      expect(text(yaml)).toContain('FIN-RECONNAISSABLE');
      expect(yaml.every(r => r.line.reduce((n, x) => n + [...x.text].length, 0) <= width)).toBe(true);
      expect(text(roleRows(DEV, null, files, { width, raw: true, narrow: width < 100, g, lang: 'fr' }, fr))).toContain('FIN-RECONNAISSABLE');
      const action: StartupEntry = { kind: 'action', builtin: 'x', value: long, layer: 'openrig', layerInferred: false, delivery: 'send_text', appliesOn: [], origin: { kind: 'inherited', from: 'openrig' } };
      const seat = { ...SEAT, live: { ...SEAT.live!, startup: [action] } };
      expect(text(contextRows(DEV, seat, files, 1, { width, raw: false, narrow: width < 100, g, lang: 'fr' }, fr).rows)).toContain('FIN-RECONNAISSABLE');
    }
  });
  it('a late answer from a machine or role left is dropped, even after coming back to it', async () => {
    const asks = fileAsks();
    const shown: string[] = [];
    const later: Array<() => void> = [];
    const read = (v: string) => () => new Promise<string>(res => later.push(() => res(v)));
    asks.reset(); asks.ask('/p', read('machine A, first visit'), v => shown.push(v));
    asks.reset(); asks.ask('/p', read('machine B'), v => shown.push(v));
    asks.reset(); asks.ask('/p', read('machine A, back again'), v => shown.push(v));
    // Answers in reverse order: only the current generation's is kept.
    for (const f of later.reverse()) { f(); await Promise.resolve(); await Promise.resolve(); }
    expect(shown).toEqual(['machine A, back again']);
    // Asked once per generation.
    asks.ask('/p', read('again'), v => shown.push(v));
    expect(later).toHaveLength(3);
  });
});

describe('ledge tui: OpenRig › Rôles', () => {
  const start = async () => {
    const tui = await startTui();
    tui.daemon.onMessage(m => {
      if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
      if (m.type === 'openrig.roles') tui.daemon.push({ type: 'openrig.roleList', requestId: m.requestId, roles: ROLES, openrigVersion: '0.7.7' });
      if (m.type === 'openrig.role') tui.daemon.push({ type: 'openrig.roleDetail', requestId: m.requestId, roleId: m.roleId, ...(m.roleId === 'u1' ? { role: DEV } : { error: 'role_not_found' }) });
      if (m.type === 'openrig.roleFile') tui.daemon.push({ type: 'openrig.roleFileContent', requestId: m.requestId, roleId: m.roleId, path: m.path, ...(FILES[m.path] ? { content: FILES[m.path] } : { error: 'missing' }) });
    });
    return tui;
  };
  it('v opens the roles on role.md; ← → tabs; f sees it from a seat; Contexte names what is missing; read-only', async () => {
    const tui = await start();
    try {
      await tui.press('6'); await until(() => tui.frame().includes('ledge-dev'));
      await tui.press('v');
      await until(() => tui.frame().includes('Rôle : développeur de ledge-dev'));
      let f = tui.frame();
      expect(f).toContain('RÔLES · 3');
      expect(f).toContain('‹ selon la spec ›');
      expect(f).toContain('‹ Rôle 1 ›');
      expect(f).toContain('guidance/role.md  ● ici');
      expect(f).toContain('developer/agent.yaml');
      await tui.press('\x1b[C');
      await until(() => tui.frame().includes('‹ Paramètres ›'));
      expect(tui.frame()).toContain('○ non déclaré');
      await tui.press('f');
      await until(() => tui.frame().includes('‹ depuis dev.front ›'));
      f = tui.frame();
      expect(f).toContain('↳ membre dev.front');
      expect(f).toContain('défaut du runtime');
      await tui.press('\x1b[C');
      await until(() => tui.frame().includes('Prompt de base du harnais'));
      expect(tui.frame()).toMatch(/\? Skills du siège/);
      await tui.press('\x1b[D'); await tui.press('\x1b[D');
      await until(() => tui.frame().includes('Ton périmètre : front-end'));
      // v goes back to the rigs.
      await tui.press('v');
      await until(() => tui.frame().includes('DAEMON'));
    } finally { await tui.cleanup(); }
  });
  it('on the Rigs view, j k walk down an unfolded rig’s seats and i opens the seat’s role, seen from it', async () => {
    const tui = await start();
    try {
      await tui.press('6'); await until(() => tui.frame().includes('ledge-dev'));
      await tui.press('\r'); await until(() => tui.frame().includes('dev.front'));
      await tui.press('j');
      await until(() => tui.frame().includes('i  voir'));
      expect(tui.frame()).toContain('ledge-developer');
      await tui.press('i');
      await until(() => tui.frame().includes('‹ depuis dev.front ›'));
      await until(() => tui.frame().includes('Ton périmètre : front-end'));
    } finally { await tui.cleanup(); }
  });
  it('/ searches the roles; a search without result says so', async () => {
    const tui = await start();
    try {
      await tui.press('6'); await until(() => tui.frame().includes('ledge-dev'));
      await tui.press('v'); await until(() => tui.frame().includes('RÔLES'));
      await tui.press('/'); await tui.press('terraform');
      await until(() => tui.frame().includes('pm'));
      expect(tui.frame()).not.toContain('ledge-developer  ');
      await tui.press('zz');
      await until(() => tui.frame().replace(/[│\s]+/g, ' ').includes('Aucun rôle ne contient « terraformzz »'));
    } finally { await tui.cleanup(); }
  });
});
