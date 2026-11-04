import { describe, it, expect, afterEach } from 'vitest';
import { PhoneServerMessageSchema, type PhoneServerMessage, type Projects } from '@ledge/protocol';
import { mk, flush, setup, stopAll } from './helpers/gateway.js';

// The Atelier on the phone (iPad lot 1, docs/mockups/ledge-ipad-atelier.html): the user's projects, each session's project and
// rig seat, behind `daemon.atelier`; never a folder, a rule nor a seat.

afterEach(stopAll);

const PROJECTS: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'violet', description: 'the app', repos: [{ machine: 'local', path: '/w/repo' }] },
    { id: 'site', name: 'Site', color: 'teal', description: '', repos: [{ machine: 'other', path: '/w/site' }] },
    { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [] }
  ],
  // The user put the agent working in /w/repo/docs away in « Docs »: deeper than the repo, it wins.
  rules: [{ machine: 'local', path: '/w/repo/docs', project: 'docs' }, { machine: 'other', path: '/w/elsewhere', project: 'site' }]
};

function atelier(projects: Projects = PROJECTS) {
  let current = projects;
  const g = setup({ deps: { projects: () => current } });
  g.sessions.set('d', mk('d', { cwd: '/w/repo/docs/guide' }));
  g.sessions.set('e', mk('e', { cwd: '/w/elsewhere' }));
  g.sessions.set('r', mk('r', { cwd: '/srv/seats/dev-back', source: 'rig', rig: { seat: 'dev-back@ledge-dev', name: 'ledge-dev', role: 'dev.back' } }));
  const change = (next: Projects) => { current = next; g.gw.forward({ type: 'projects', projects: next }); };
  return { ...g, change };
}
const snapshotOf = (ms: PhoneServerMessage[]) => {
  const s = ms.find(m => m.type === 'snapshot');
  if (s?.type !== 'snapshot') throw new Error('no snapshot');
  return s;
};

describe('phone Atelier: the snapshot', () => {
  it('without the projects (an older daemon), no atelier, no projects, no place: the app shows no Atelier', async () => {
    const g = setup();
    g.sessions.set('r', mk('r', { rig: { seat: 'dev-back@ledge-dev', name: 'ledge-dev', role: 'dev.back' } }));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = snapshotOf(g.got('dev1'));
    expect(snap.daemon).not.toHaveProperty('atelier');
    expect(snap).not.toHaveProperty('projects');
    for (const s of snap.sessions) { expect(s).not.toHaveProperty('projectId'); expect(s).not.toHaveProperty('rig'); }
  });

  it('says it feeds the Atelier, lists the projects in their order, and places each session as the desktop does', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = snapshotOf(g.got('dev1'));
    expect(PhoneServerMessageSchema.parse(snap)).toMatchObject({ daemon: { atelier: true } });
    expect(snap.projects).toEqual([{ id: 'ledge', name: 'Ledge', color: 'violet' }, { id: 'site', name: 'Site', color: 'teal' }, { id: 'docs', name: 'Docs', color: 'amber' }]);
    const place = Object.fromEntries(snap.sessions.map(s => [s.id, s.projectId ?? null]));
    // a, b, c, q work in the repo; d under the rule; e under another machine's rule only; r in no project.
    expect(place).toEqual({ a: 'ledge', b: 'ledge', c: 'ledge', q: 'ledge', d: 'docs', e: null, r: null });
    expect(snap.sessions.find(s => s.id === 'r')!.rig).toEqual({ name: 'ledge-dev', role: 'dev.back' });
    expect(snap.sessions.find(s => s.id === 'a')).not.toHaveProperty('rig');
  });

  it('leaks no folder, rule nor seat, even with real projects', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const raw = g.fm.sent.filter(([d]) => d === 'dev1').map(([, t]) => t).join('\n');
    expect(raw).toContain('"atelier":true');
    for (const secret of ['/w/', '/srv/', 'dev-back@ledge-dev', '"repos"', '"rules"', '"description"', '"cwd"', '"seat"', '"machine"']) expect(raw).not.toContain(secret);
  });
});

describe('phone Atelier: the projects change', () => {
  it('a renamed or recoloured project: the list, whole, and no session moves', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').length;
    g.change({ ...PROJECTS, projects: PROJECTS.projects.map(p => (p.id === 'ledge' ? { ...p, name: 'Ledge 2', color: 'red' } : p)) });
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after).toEqual([{ type: 'projects', projects: [{ id: 'ledge', name: 'Ledge 2', color: 'red' }, { id: 'site', name: 'Site', color: 'teal' }, { id: 'docs', name: 'Docs', color: 'amber' }] }]);
    expect(after.map(m => PhoneServerMessageSchema.parse(m))).toHaveLength(1);
  });

  it('an agent put away elsewhere: its session follows, placed anew; the list does not change', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').length;
    g.change({ ...PROJECTS, rules: [...PROJECTS.rules, { machine: 'local', path: '/srv/seats/dev-back', project: 'site' }] });
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ type: 'session.updated', session: { id: 'r', projectId: 'site', rig: { name: 'ledge-dev' } } });
  });

  it('a project removed: the list first, then each of its sessions, out of any project', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').length;
    g.change({ projects: PROJECTS.projects.filter(p => p.id !== 'docs'), rules: PROJECTS.rules.filter(r => r.project !== 'docs') });
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after.map(m => m.type)).toEqual(['projects', 'session.updated']);
    const moved = after[1]!;
    if (moved.type !== 'session.updated') throw new Error('no update');
    // Under /w/repo, the repo takes it back.
    expect(moved.session).toMatchObject({ id: 'd', projectId: 'ledge' });
    for (const m of after) expect(JSON.stringify(m)).not.toContain('/w/');
  });

  it('nothing to a device that did not ask for the sessions; the next snapshot has the change', async () => {
    const g = atelier();
    g.change({ ...PROJECTS, projects: [...PROJECTS.projects, { id: 'new', name: 'Nouveau', color: 'blue', description: '', repos: [] }] });
    await flush();
    expect(g.fm.sent).toEqual([]);
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    expect(snapshotOf(g.got('dev2')).projects?.map(p => p.id)).toEqual(['ledge', 'site', 'docs', 'new']);
  });

  it('a session updated afterwards carries its place', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward({ type: 'session.updated', session: mk('d', { cwd: '/w/repo/docs/guide', title: 'renamed' }) });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'session.updated', session: { id: 'd', title: 'renamed', projectId: 'docs' } });
  });

  it('a daemon without the Atelier forwards no projects message', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.fm.sent.length;
    g.gw.forward({ type: 'projects', projects: PROJECTS });
    await flush();
    expect(g.fm.sent.length).toBe(before);
  });
});
