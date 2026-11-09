import { beforeEach, describe, expect, it } from 'vitest';
import { atelierOnly, bootShown, bootWorkspace, capture, cleanName, loadBoot, loadCurrent, loadDispositions, parseBoot, parseDispositions, plan, remove, saveBoot, saveCurrent, saveDispositions, shapeOf, signature, upsert, BOOT_KEY, DISPOSITIONS_KEY, type ApplyDeps, type Disposition, type ShellSpec } from '../../src/workspace/dispositions';
import { empty, MAIN, move, open, split, type Tab, type Workspace } from '../../src/workspace/model';

const ATELIER: Tab = { kind: 'atelier', ref: 'main' };
const pim: Tab = { kind: 'session', ref: 'pim', view: 'thread' };
const nova: Tab = { kind: 'session', ref: 'nova', view: 'thread' };
const shell: Tab = { kind: 'terminal', ref: 'shell:1' };
const PANELS = { bottom: true, right: false };

/** Two tabs in the main window, a third torn out into a window of its own (lot 9). */
function withWindow(): Workspace {
  let w = open(empty(), pim, 'active');
  w = open(w, nova, 'right');
  w = open(w, ATELIER, 'active');
  return move(w, 'atelier:main', { window: 'new' });
}
const tabsOf = (w: Workspace) => w.groups.map(g => g.tabs.map(t => t.ref));

beforeEach(() => { localStorage.clear(); });

describe('dispositions', () => {
  it('keep the windows, the groups, the panels, and what opens each shell again', () => {
    const ws = open(withWindow(), shell, 'active');
    const specs: Record<string, ShellSpec> = { 'shell:1': { kind: 'wsl', dir: '/w/ledge' }, 'shell:2': { kind: 'powershell', dir: 'C:\\' } };
    const d = capture('Revue', ws, PANELS, ['shell:2', 'agent:pim'], r => specs[r]);
    expect(d).toEqual({ name: 'Revue', ws, bottom: true, right: false, panel: ['shell:2', 'agent:pim'], shells: specs });
    expect(shapeOf(d)).toEqual({ groups: ws.groups.length, windows: 1 });
    expect(shapeOf(capture('A', empty(), PANELS))).toEqual({ groups: 1, windows: 0 });
  });

  it('replace one saved under the same name, where it was', () => {
    const a = capture('A', empty(), PANELS);
    const b = capture('B', empty(), PANELS);
    const a2 = capture('A', withWindow(), PANELS);
    const list = upsert(upsert(upsert([], a), b), a2);
    expect(list.map(x => x.name)).toEqual(['A', 'B']);
    expect(list[0]).toBe(a2);
    expect(remove(list, 'A').map(x => x.name)).toEqual(['B']);
  });

  it('take a trimmed name; an empty one saves nothing', () => {
    expect(cleanName('  Revue  ')).toBe('Revue');
    expect(cleanName('   ')).toBeNull();
  });

  it('come back as saved, and the unreadable ones are dropped', () => {
    const ws = withWindow();
    const d = capture('Revue', ws, PANELS, ['shell:2'], () => ({ kind: 'ssh:srv', dir: '~' }));
    saveDispositions([d]);
    expect(loadDispositions()).toEqual([d]);
    expect(loadDispositions()).toBe(loadDispositions());
    const good = JSON.parse(localStorage.getItem(DISPOSITIONS_KEY)!)[0];
    expect(parseDispositions([good, { name: 'x', ws: '{"version":2}' }, { name: '', ws: good.ws }, 'nope', { ...good }]).map(x => x.name)).toEqual(['Revue']);
    expect(parseDispositions([{ ...good, shells: { 'shell:2': { kind: 'bash', dir: '~' } } }])[0]!.shells).toEqual({});
    expect(parseDispositions({})).toEqual([]);
  });

  it('are « modified » when windows, groups, tabs, links or panels change; not for the focus or the tab in front', () => {
    const ws = withWindow();
    const sig = signature(ws, PANELS);
    expect(signature({ ...ws, focus: 'other', groups: ws.groups.map(g => ({ ...g, active: 0 })) }, PANELS)).toBe(sig);
    expect(signature(ws, { bottom: false, right: false })).not.toBe(sig);
    expect(signature(open(ws, shell, 'active'), PANELS)).not.toBe(sig);
    expect(signature(split(ws, ws.groups[0]!.id), PANELS)).not.toBe(sig);
    saveCurrent({ name: 'Revue', sig });
    expect(loadCurrent()).toEqual({ name: 'Revue', sig });
  });
});

describe('applying a disposition (plan)', () => {
  const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps & { spawned: ShellSpec[] } => {
    const spawned: ShellSpec[] = [];
    return { keep: () => true, live: () => undefined, spawn: s => { spawned.push(s); return `shell:new${spawned.length}`; }, open: [], spawned, ...over };
  };

  it('opens a new shell, same type and folder, for each shell gone; keeps one still running', () => {
    const ws = open(open(empty(), pim, 'active'), shell, 'right');
    const d = capture('T', ws, PANELS, ['shell:2', 'shell:3'], r => ({ kind: 'wsl', dir: `/w/${r}` }));
    const x = deps({ live: r => (r === 'shell:3' ? { kind: 'wsl', dir: '/w/shell:3' } : undefined) });
    const r = plan(d, x);
    expect(x.spawned).toEqual([{ kind: 'wsl', dir: '/w/shell:1' }, { kind: 'wsl', dir: '/w/shell:2' }]);
    expect(tabsOf(r.ws)).toEqual([['pim'], ['shell:new1']]);
    expect(r.panel).toEqual(['shell:new2', 'shell:3']);
    expect(r.dropped).toBe(0);
  });

  it('leaves out the tabs whose subject is gone, and counts them; an emptied group goes, an emptied window does not open', () => {
    const d = capture('R', withWindow(), PANELS, ['agent:pim', 'agent:otto']);
    const r = plan(d, deps({ keep: t => t.ref !== 'nova' && t.ref !== 'main' && t.ref !== 'agent:otto' }));
    expect(tabsOf(r.ws)).toEqual([['pim']]);
    expect(r.ws.windows).toEqual([MAIN]);
    expect(r.panel).toEqual(['agent:pim']);
    expect(r.dropped).toBe(3);
  });

  it('kills no shell: those open that it does not hold go to the bottom panel', () => {
    const d = capture('P', open(empty(), pim, 'active'), PANELS, ['shell:9'], () => ({ kind: 'wsl', dir: '' }));
    const r = plan(d, deps({ live: r => (r === 'shell:9' ? { kind: 'wsl', dir: '' } : { kind: 'cmd', dir: 'C:\\' }), open: ['shell:5', 'shell:9', 'shell:6'] }));
    expect(r.panel).toEqual(['shell:9', 'shell:5', 'shell:6']);
  });

  // Review lot 10 (B1, M1): TermStore numbers shells from 1 at each launch, so a saved ref can name another shell now. A store
  // that numbers the same way.
  const store = (start: Array<[string, ShellSpec]> = []) => {
    const live = new Map<string, ShellSpec>(start);
    let next = start.length + 1;
    return {
      live,
      deps: (): ApplyDeps => ({
        keep: () => true, live: r => live.get(r), open: [...live.keys()],
        spawn: s => { const id = `shell:${next++}`; live.set(id, s); return id; }
      })
    };
  };
  const shells = (refs: string[]) => ({ version: 1 as const, windows: [MAIN], groups: [{ id: 'g1', window: MAIN, tabs: refs.map(ref => ({ kind: 'terminal' as const, ref })), active: 0, link: null }], focus: 'g1', next: 2 });
  const A: ShellSpec = { kind: 'wsl', dir: '/home/a' }, B: ShellSpec = { kind: 'powershell', dir: 'C:\\b' };

  it('at start (no shell alive), each saved shell opens once, with its own type and folder, even renumbered', () => {
    const d: Disposition = { name: 'Dev', ws: shells(['shell:2']), bottom: true, right: true, panel: ['shell:1'], shells: { 'shell:2': A, 'shell:1': B } };
    const s = store();
    const r = plan(d, s.deps());
    expect(s.live.get(r.ws.groups[0]!.tabs[0]!.ref)).toEqual(A);
    expect(r.panel.map(x => s.live.get(x))).toEqual([B]);
    expect(s.live.size).toBe(2);
  });

  it('after a restart, a saved shell is not mistaken for another one that got its number', () => {
    const d: Disposition = { name: 'Dev', ws: shells(['shell:1']), bottom: false, right: true, panel: [], shells: { 'shell:1': A } };
    const s = store([['shell:1', B]]);
    const r = plan(d, s.deps());
    expect(s.live.get(r.ws.groups[0]!.tabs[0]!.ref)).toEqual(A);
    // The PowerShell is not killed: it goes to the bottom panel.
    expect(r.panel).toEqual(['shell:1']);
  });

  it('applied twice after its shell was closed, it opens one shell, not one per application', () => {
    const d: Disposition = { name: 'Dev', ws: shells(['shell:1']), bottom: false, right: true, panel: [], shells: { 'shell:1': A } };
    const s = store();
    s.deps().spawn(A); s.live.delete('shell:1');
    const first = plan(d, s.deps());
    const second = plan(d, s.deps());
    expect(s.live.size).toBe(1);
    expect(second.ws.groups[0]!.tabs[0]!.ref).toBe(first.ws.groups[0]!.tabs[0]!.ref);
    expect(second.panel).toEqual([]);
  });
});

describe('the start (« Au démarrage »)', () => {
  const last = open(empty(), pim, 'active');
  const saved = capture('Revue', withWindow(), PANELS);

  it('is the last disposition by default, and anything unknown reads so', () => {
    expect(loadBoot()).toEqual({ kind: 'last' });
    for (const raw of [null, 'atelier', { kind: 'fixed' }, { kind: 'fixed', name: '' }, { kind: 'other' }]) expect(parseBoot(raw)).toEqual({ kind: 'last' });
    saveBoot({ kind: 'fixed', name: 'Revue' });
    expect(JSON.parse(localStorage.getItem(BOOT_KEY)!)).toEqual({ kind: 'fixed', name: 'Revue' });
    expect(loadBoot()).toEqual({ kind: 'fixed', name: 'Revue' });
  });

  it('opens the last workspace as it was', () => {
    expect(bootWorkspace({ kind: 'last' }, last, [saved], ATELIER)).toEqual({ ws: last, panels: null });
  });

  it('opens a fixed disposition with its panels; deleted, the last workspace, and the setting says so', () => {
    expect(bootWorkspace({ kind: 'fixed', name: 'Revue' }, last, [saved], ATELIER)).toEqual({ ws: saved.ws, panels: { bottom: true, right: false }, current: 'Revue', disposition: saved });
    expect(bootWorkspace({ kind: 'fixed', name: 'Gone' }, last, [saved], ATELIER)).toEqual({ ws: last, panels: null });
    expect(bootShown({ kind: 'fixed', name: 'Gone' }, [saved])).toEqual({ boot: { kind: 'last' }, deleted: 'Gone' });
    expect(bootShown({ kind: 'fixed', name: 'Revue' }, [saved])).toEqual({ boot: { kind: 'fixed', name: 'Revue' }, deleted: null });
  });

  it('opens the atelier alone, in the main window', () => {
    const r = bootWorkspace({ kind: 'atelier' }, last, [saved], ATELIER);
    expect(r.ws).toEqual(atelierOnly(ATELIER));
    expect(r.ws.groups[0]!.tabs).toEqual([ATELIER]);
    expect(r.current).toBeNull();
  });
});
