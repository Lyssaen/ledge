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

describe('phone Atelier: the order on a slow link', () => {
  /**
   * The phone's view, from its snapshot: no session.updated names a project the phone was not given (the list goes first). A
   * project removed may still be a session's until that session's own update follows the list: the app shows it « Sans projet ».
   */
  const neverUnknown = (ms: PhoneServerMessage[]) => {
    let known = new Set<string>();
    const place = new Map<string, string | undefined>();
    for (const m of ms) {
      if (m.type === 'snapshot') { known = new Set(m.projects?.map(p => p.id)); for (const s of m.sessions) place.set(s.id, s.projectId); }
      if (m.type === 'projects') known = new Set(m.projects.map(p => p.id));
      if (m.type !== 'session.updated') continue;
      const p = m.session.projectId;
      if (p !== undefined && !known.has(p)) throw new Error(`${m.session.id} placed in ${p}, not yet given`);
      place.set(m.session.id, p);
    }
    for (const [id, p] of place) if (p !== undefined && !known.has(p)) throw new Error(`${id} left in ${p}, gone`);
    return place;
  };
  /** Holds the phone's sends until `release`: what the gateway pushes meanwhile waits in its outbox. */
  const held = (g: ReturnType<typeof atelier>) => {
    const send = g.fm.mobile.send;
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    g.fm.mobile.send = async (d: string, t: string) => { await gate; return send(d, t); };
    return () => open();
  };
  const NEW = { id: 'new', name: 'Nouveau', color: 'blue' as const, description: '', repos: [] };

  it('an update of a session already queued: the list still goes first, then the session placed in it', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const release = held(g);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('b')! }); // on its way, held
    await flush();
    g.gw.forward({ type: 'session.updated', session: mk('a', { title: 'queued' }) }); // waits in the outbox
    g.change({ projects: [...PROJECTS.projects, NEW], rules: [...PROJECTS.rules, { machine: 'local', path: '/w/repo', project: 'new' }] });
    release();
    await flush();
    const got = g.got('dev1');
    const projectsAt = got.findIndex(m => m.type === 'projects');
    const lastA = got.findLastIndex(m => m.type === 'session.updated' && m.session.id === 'a');
    expect(projectsAt).toBeGreaterThan(0);
    expect(lastA).toBeGreaterThan(projectsAt);
    expect(neverUnknown(got).get('a')).toBe('new');
  });

  it('several changes while held: coalesced, never a project the phone does not know, the last state at the end', async () => {
    const g = atelier();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const release = held(g);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('b')! });
    await flush();
    for (const id of ['a', 'd', 'r']) g.gw.forward({ type: 'session.updated', session: g.sessions.get(id)! });
    const step1 = { projects: [...PROJECTS.projects, NEW], rules: [...PROJECTS.rules, { machine: 'local', path: '/srv/seats', project: 'new' }] };
    g.change(step1);
    g.gw.forward({ type: 'session.updated', session: { ...g.sessions.get('r')!, title: 'between' } });
    const step2 = { projects: step1.projects.filter(p => p.id !== 'docs').map(p => (p.id === 'new' ? { ...p, name: 'Renommé' } : p)), rules: step1.rules.filter(r => r.project !== 'docs') };
    g.change(step2);
    release();
    await flush();
    const got = g.got('dev1');
    const place = neverUnknown(got);
    expect(Object.fromEntries(place)).toMatchObject({ a: 'ledge', d: 'ledge', r: 'new', e: undefined });
    expect(got.filter(m => m.type === 'projects')).toHaveLength(1);
    expect(got.findLast(m => m.type === 'projects')).toMatchObject({ projects: [{ id: 'ledge' }, { id: 'site' }, { id: 'new', name: 'Renommé' }] });
    expect(got.findLast(m => m.type === 'session.updated' && m.session.id === 'r')).toMatchObject({ session: { title: 'between', projectId: 'new' } });
  });
});
