import { describe, expect, it } from 'vitest';
import { routeNav, tabNav } from '../../src/workspace/route';
import { ATELIER_TAB, SETTINGS_TAB, openrigTab } from '../../src/workspace/store';
import { empty, focused, keyOf, open, type Workspace } from '../../src/workspace/model';
import type { OpenSession } from '../../src/workspace/openPrefs';
import type { NavAction, NavState } from '../../src/nav/state';

const ctx = (o: Partial<{ seat: boolean; modalOpen: boolean; openSession: OpenSession }> = {}) => ({ isSeat: () => o.seat ?? false, modalOpen: o.modalOpen ?? false, openSession: o.openSession ?? 'active' as OpenSession });
const active = (w: Workspace) => { const g = focused(w); return g.tabs[g.active]; };
const applied = (a: NavAction, c = ctx()) => { const r = routeNav(a, c); return { r, tab: r.ws ? active(r.ws(empty())) : undefined }; };

describe('routeNav, the « Ouvrir une session » setting', () => {
  const base = open(empty(), { kind: 'session', ref: 'a' });
  it("'right' without where: a new group on the right holds the tab, active", () => {
    const w = routeNav({ type: 'open', id: 'b' }, ctx({ openSession: 'right' })).ws!(base);
    expect(w.groups).toHaveLength(2);
    expect(focused(w).id).toBe('g2');
    expect(focused(w).tabs.map(keyOf)).toEqual(['session:b']);
  });
  it("where 'active' wins over the setting", () => {
    const w = routeNav({ type: 'open', id: 'b', where: 'active' }, ctx({ openSession: 'right' })).ws!(base);
    expect(w.groups).toHaveLength(1);
    expect(focused(w).tabs.map(keyOf)).toEqual(['session:a', 'session:b']);
  });
  it('a tab already open is brought forward, never duplicated', () => {
    const w = routeNav({ type: 'open', id: 'a' }, ctx({ openSession: 'right' })).ws!(base);
    expect(w.groups).toHaveLength(1);
    expect(focused(w).tabs).toHaveLength(1);
  });
});

describe('routeNav', () => {
  it('open: a session tab, the action kept', () => {
    const a: NavAction = { type: 'open', id: 's1', focus: 'reply' };
    const { r, tab } = applied(a);
    expect(r.nav).toBe(a); expect(tab).toEqual({ kind: 'session', ref: 's1' }); expect(r.layout).toBeUndefined();
  });
  it('open: a seat tab for a seat', () => {
    expect(applied({ type: 'open', id: 'rig/dev' }, ctx({ seat: true })).tab).toEqual({ kind: 'seat', ref: 'rig/dev' });
  });
  it('open twice the same id gives one tab', () => {
    const w = routeNav({ type: 'open', id: 's1' }, ctx()).ws!(routeNav({ type: 'open', id: 's1' }, ctx()).ws!(empty()));
    expect(focused(w).tabs).toHaveLength(1);
  });
  it('home: atelier tab, filter when a project is given', () => {
    expect(applied({ type: 'home', project: 'p1' })).toMatchObject({ r: { nav: { type: 'filter', project: 'p1' } }, tab: ATELIER_TAB });
    const n = applied({ type: 'home' });
    expect(n.r.nav).toBeUndefined(); expect(n.tab).toEqual(ATELIER_TAB);
  });
  it('ledge: chat open, right panel shown', () => {
    expect(routeNav({ type: 'ledge' }, ctx())).toEqual({ nav: { type: 'chat', open: true }, layout: { type: 'show', panel: 'right', on: true } });
  });
  it('chat closed hides the right panel, otherwise shows it', () => {
    expect(routeNav({ type: 'chat', open: false }, ctx())).toEqual({ nav: { type: 'chat', open: false }, layout: { type: 'show', panel: 'right', on: false } });
    expect(routeNav({ type: 'chat', open: true }, ctx()).layout).toEqual({ type: 'show', panel: 'right', on: true });
    expect(routeNav({ type: 'chat' }, ctx()).layout).toEqual({ type: 'show', panel: 'right', on: true });
  });
  it('settings', () => {
    const a: NavAction = { type: 'settings', section: 'sounds' };
    const { r, tab } = applied(a);
    expect(r.nav).toBe(a); expect(tab).toEqual(SETTINGS_TAB);
  });
  it('openrig', () => {
    const a: NavAction = { type: 'openrig', machine: 'm2' };
    const { r, tab } = applied(a);
    expect(r.nav).toBe(a); expect(tab).toEqual(openrigTab('m2'));
    expect(applied({ type: 'openrig' }).tab).toEqual(openrigTab());
  });
  it('escape closes a modal only when one is open', () => {
    expect(routeNav({ type: 'escape' }, ctx({ modalOpen: true }))).toEqual({ nav: { type: 'modal', modal: null } });
    expect(routeNav({ type: 'escape' }, ctx())).toEqual({});
  });
  it('any other action passes through', () => {
    const a: NavAction = { type: 'helpers' };
    expect(routeNav(a, ctx())).toEqual({ nav: a });
    const f: NavAction = { type: 'filter', project: 'x' };
    expect(routeNav(f, ctx()).nav).toBe(f);
  });
});

const nav = (place: NavState['place']): NavState => ({ place, modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: false, paused: false });
describe('tabNav', () => {
  it('a session tab matching the place gets the real nav', () => {
    const n = nav({ kind: 'session', id: 's1', view: 'atelier', project: 'all' });
    expect(tabNav(n, { kind: 'session', ref: 's1' })).toBe(n);
    expect(tabNav(n, { kind: 'seat', ref: 's1' })).toBe(n);
  });
  it('another session gets a synthetic place', () => {
    const n = nav({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(tabNav(n, { kind: 'session', ref: 's2' })).toEqual({ ...n, place: { kind: 'session', id: 's2', view: 'atelier', project: 'all' } });
  });
  it('settings tab', () => {
    const s = nav({ kind: 'settings', section: 'about', back: { kind: 'overview', view: 'atelier', project: 'all' } });
    expect(tabNav(s, SETTINGS_TAB)).toBe(s);
    const o = nav({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(tabNav(o, SETTINGS_TAB).place).toEqual({ kind: 'settings', section: 'general', back: { kind: 'overview', view: 'atelier', project: 'all' } });
  });
  it('atelier and openrig get the nav', () => {
    const o = nav({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(tabNav(o, ATELIER_TAB)).toBe(o); expect(tabNav(o, openrigTab())).toBe(o);
    expect(keyOf(ATELIER_TAB)).toBe('atelier:main');
  });
});
