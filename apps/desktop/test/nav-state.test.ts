// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Projects, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { initialNav, navReducer, reconcile, type NavState } from '../src/nav/state';
import { loadOverview, saveOverview, type Overview } from '../src/nav/overview';

const o: Overview = { view: 'atelier', helpers: true, paused: false };
const s0 = initialNav(o);
const sess = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { machineId: 'local', ...extra });

describe('nav state', () => {
  beforeEach(() => localStorage.clear());

  it('starts on the overview of the stored view, nothing open', () => {
    expect(s0).toEqual({ place: { kind: 'overview', view: 'atelier', project: 'all' }, modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: true, paused: false });
    expect(initialNav({ ...o, view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'all' });
  });
  it('asking for the chat when it is already open asks its field for the focus again; closing it does not', () => {
    const opened = navReducer(s0, { type: 'chat', open: true });
    expect(opened.chat).toBe(true);
    const again = navReducer(opened, { type: 'chat', open: true });
    expect(again.chat).toBe(true);
    expect(again.chatFocus).toBeGreaterThan(opened.chatFocus);
    expect(navReducer(again, { type: 'chat', open: false }).chatFocus).toBe(again.chatFocus);
  });
  it('opens a session from a filtered overview and comes back to it', () => {
    let s = navReducer(s0, { type: 'home', project: 'ledge' });
    s = navReducer(navReducer(s, { type: 'view', view: 'list' }), { type: 'open', id: 'local:otto' });
    expect(s.place).toEqual({ kind: 'session', id: 'local:otto', view: 'list', project: 'ledge' });
    expect(navReducer(s, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'list', project: 'ledge' });
  });
  it('open may name a subagent and ask for the reply; the next open forgets both', () => {
    const base = s0;
    const s = navReducer(base, { type: 'open', id: 'local:otto', helper: 'h1' });
    expect(s.place).toEqual({ kind: 'session', id: 'local:otto', helper: 'h1', view: 'atelier', project: 'all' });
    const r = navReducer(s, { type: 'open', id: 'local:kit', focus: 'reply' });
    expect(r.place).toEqual({ kind: 'session', id: 'local:kit', focus: 'reply', view: 'atelier', project: 'all' });
    expect(navReducer(r, { type: 'open', id: 'local:kit' }).place).toEqual({ kind: 'session', id: 'local:kit', view: 'atelier', project: 'all' });
    expect(navReducer(s, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  });
  it('a subagent page stays while its parent exists', () => {
    const s = navReducer(s0, { type: 'open', id: 'local:otto', helper: 'gone' });
    expect(reconcile(s, [fakeSession('local:otto')], null)).toBe(s);
    expect(reconcile(s, [], null).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  });
  it('settings remember where they were opened from; a section change keeps it', () => {
    const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
    let s = navReducer(inSession, { type: 'settings' });
    expect(s.place).toEqual({ kind: 'settings', section: 'general', back: inSession.place });
    s = navReducer(s, { type: 'settings', section: 'machines' });
    expect(s.place).toMatchObject({ section: 'machines', back: inSession.place });
    expect(navReducer(s, { type: 'escape' }).place).toEqual(inSession.place);
  });
  it('escape closes one layer at a time: modal, chat, settings, session, filter, fullscreen', () => {
    let s = navReducer(s0, { type: 'home', project: 'ledge' });
    s = navReducer(s, { type: 'open', id: 'local:otto' });
    s = navReducer(navReducer(navReducer(navReducer(s, { type: 'fullscreen', on: true }), { type: 'settings' }), { type: 'chat' }), { type: 'modal', modal: { kind: 'search' } });
    const steps: NavState[] = [];
    for (let i = 0; i < 7; i++) { s = navReducer(s, { type: 'escape' }); steps.push(s); }
    expect(steps.map(x => [x.modal, x.chat, x.place.kind, x.place.kind !== 'settings' ? x.place.project : '-', x.fullscreen])).toEqual([
      [null, true, 'settings', '-', true],
      [null, false, 'settings', '-', true],
      [null, false, 'session', 'ledge', true],
      [null, false, 'overview', 'ledge', true],
      [null, false, 'overview', 'all', true],
      [null, false, 'overview', 'all', false],
      [null, false, 'overview', 'all', false]
    ]);
  });
  it('the view change and home keep the place kind sensible', () => {
    const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
    expect(navReducer(inSession, { type: 'home' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(navReducer(s0, { type: 'view', view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'all' });
  });
  it('reconcile drops a gone session and a gone project filter, keeps an offline session, returns the same object when nothing changes', () => {
    const projects: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [] }], rules: [] };
    const s = navReducer(navReducer(s0, { type: 'home', project: 'ledge' }), { type: 'open', id: 'local:otto' });
    expect(reconcile(s, [sess('otto', { id: 'local:otto', offline: true })], projects)).toBe(s);
    expect(reconcile(s, [], projects).place).toEqual({ kind: 'overview', view: 'atelier', project: 'ledge' });
    expect(reconcile(s, [], { projects: [], rules: [] }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(reconcile(navReducer(s0, { type: 'home', project: 'ledge' }), [], null).place).toMatchObject({ project: 'all' });
    expect(reconcile(navReducer(s0, { type: 'home', project: 'none' }), [], null).place).toMatchObject({ project: 'none' });
  });
  it('overview storage survives garbage and keeps valid fields', () => {
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'room', helpers: 'yes', paused: true }));
    expect(loadOverview()).toEqual({ view: 'atelier', helpers: true, paused: true });
    saveOverview({ view: 'list', helpers: false, paused: false });
    expect(loadOverview()).toEqual({ view: 'list', helpers: false, paused: false });
  });

  it('reconcile repairs the back of a settings place whose session is gone', () => {
    const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
    const st = navReducer(inSession, { type: 'settings' });
    const r = reconcile(st, [], null);
    expect(r.place).toEqual({ kind: 'settings', section: 'general', back: { kind: 'overview', view: 'atelier', project: 'all' } });
  });
  it('home may switch the view too (the « +N » pill opens the List on its project)', () => {
    expect(navReducer(s0, { type: 'home', project: 'ledge', view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'ledge' });
  });
  it('dialogs carry their target; full screen off when already off changes nothing', () => {
    expect(navReducer(s0, { type: 'modal', modal: { kind: 'launch', project: 'ledge' } }).modal).toEqual({ kind: 'launch', project: 'ledge' });
    expect(navReducer(s0, { type: 'fullscreen', on: false })).toBe(s0);
  });
});
