import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATELIER_TAB, SETTINGS_TAB, createWorkspaceStore, loadWorkspace } from '../../src/workspace/store';
import { deserialize, empty, focused, keyOf, open, reconcile, type Workspace } from '../../src/workspace/model';

const KEY = 'ledge.ide.workspace';
const active = (w: Workspace) => { const g = focused(w); return g.tabs[g.active]; };
beforeEach(() => localStorage.clear());

describe('workspace store', () => {
  it('persists', () => {
    const s = createWorkspaceStore(empty());
    s.update(w => open(w, SETTINGS_TAB));
    const w = deserialize(JSON.parse(localStorage.getItem(KEY)!));
    expect(w && keyOf(active(w)!)).toBe('settings:main');
  });
  it('first run opens the atelier', () => {
    expect(active(loadWorkspace())).toEqual(ATELIER_TAB);
  });
  it('unreadable layout falls back, without exception', () => {
    for (const raw of ['{"version":2}', 'not json', '42', '{"version":1}', JSON.stringify({ version: 1 })]) {
      localStorage.setItem(KEY, raw);
      expect(active(loadWorkspace())).toEqual(ATELIER_TAB);
    }
  });
  it('round trip through the store', () => {
    createWorkspaceStore(empty()).update(w => open(w, SETTINGS_TAB));
    expect(active(loadWorkspace())).toEqual(SETTINGS_TAB);
  });
  it('deleted session tab closes, archived stays', () => {
    let w = open(open(open(empty(), ATELIER_TAB), { kind: 'session', ref: 'gone' }), { kind: 'session', ref: 'archived' });
    w = open(w, { kind: 'session', ref: 'live' });
    const known = new Set(['live', 'archived']);
    const out = reconcile(w, t => t.kind !== 'session' || known.has(t.ref));
    const keys = focused(out).tabs.map(keyOf);
    expect(keys).not.toContain('session:gone');
    expect(keys).toContain('session:archived');
    expect(keys).toContain('session:live');
  });
  it('subscribe fires once per real change', () => {
    const s = createWorkspaceStore(empty());
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.update(w => w);
    expect(cb).not.toHaveBeenCalled();
    s.update(w => open(w, SETTINGS_TAB));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    s.update(w => open(w, ATELIER_TAB));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
