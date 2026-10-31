// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Projects, Rig, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { initialNav, navReducer, reconcile, type NavState } from '../src/nav/state';
import { loadOverview, saveOverview, type Overview } from '../src/nav/overview';

const o: Overview = { view: 'atelier', helpers: true, paused: false };
const s0 = initialNav(o);
const sess = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { machineId: 'local', ...extra });

describe('nav state', () => {
  beforeEach(() => localStorage.clear());

  it('starts on Ledge’s home view (ledge home spec §2.1), the atelier behind it, even when a list view was stored', () => {
    expect(s0).toEqual({ place: { kind: 'home', tab: 'conversation', view: 'atelier', project: 'all' }, modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: true, paused: false });
    expect(initialNav({ ...o, view: 'list' as 'atelier' }).place).toEqual({ kind: 'home', tab: 'conversation', view: 'atelier', project: 'all' });
    // Escape from the home view at start goes to the atelier.
    expect(navReducer(s0, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  });
  it('the home view is reached from anywhere, keeps the place it came from for Escape, and closes the docked chat', () => {
    const page = navReducer(navReducer(s0, { type: 'home', project: 'ledge' }), { type: 'open', id: 'a' });
    const chatOpen = navReducer(page, { type: 'chat', open: true });
    const home = navReducer(chatOpen, { type: 'ledge' });
    expect(home.place).toEqual({ kind: 'home', tab: 'conversation', view: 'atelier', project: 'ledge', back: { kind: 'session', id: 'a', view: 'atelier', project: 'ledge' } });
    expect(home.chat).toBe(false);
    expect(home.chatFocus).toBe(chatOpen.chatFocus + 1);
    // Another tab keeps the way back.
    const history = navReducer(home, { type: 'ledge', tab: 'history' });
    expect(history.place).toMatchObject({ kind: 'home', tab: 'history', back: { kind: 'session', id: 'a' } });
    expect(navReducer(history, { type: 'ledge' }).place).toMatchObject({ tab: 'history' });
    expect(navReducer(history, { type: 'escape' }).place).toEqual({ kind: 'session', id: 'a', view: 'atelier', project: 'ledge' });
    // From Settings: back to what Settings was over.
    const fromSettings = navReducer(navReducer(page, { type: 'settings' }), { type: 'ledge' });
    expect(fromSettings.place).toMatchObject({ kind: 'home', back: { kind: 'session', id: 'a' } });
  });
  it('the Rigs tab keeps its sub-tab and its chosen spec from tab to tab', () => {
    const specs = navReducer(navReducer(s0, { type: 'ledge', tab: 'rigs', rigs: 'specs' }), { type: 'ledge', tab: 'rigs', spec: 'factory' });
    expect(specs.place).toMatchObject({ kind: 'home', tab: 'rigs', rigs: 'specs', spec: 'factory' });
    const back = navReducer(navReducer(specs, { type: 'ledge', tab: 'conversation' }), { type: 'ledge', tab: 'rigs' });
    expect(back.place).toMatchObject({ tab: 'rigs', rigs: 'specs', spec: 'factory' });
    expect(navReducer(s0, { type: 'ledge', tab: 'rigs' }).place).not.toHaveProperty('rigs');
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
    s = navReducer(s, { type: 'open', id: 'local:otto' });
    expect(s.place).toEqual({ kind: 'session', id: 'local:otto', view: 'atelier', project: 'ledge' });
    expect(navReducer(s, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'ledge' });
  });
  it('open with an item keeps it on the place; the next open forgets it', () => {
    const r = navReducer(s0, { type: 'open', id: 'local:nova', item: 'recv-1-0' });
    expect(r.place).toEqual({ kind: 'session', id: 'local:nova', item: 'recv-1-0', view: 'atelier', project: 'all' });
    expect(navReducer(r, { type: 'open', id: 'local:nova' }).place).toEqual({ kind: 'session', id: 'local:nova', view: 'atelier', project: 'all' });
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
  it('home returns to the atelier, on every project or on one', () => {
    const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
    expect(navReducer(inSession, { type: 'home' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
    expect(navReducer(s0, { type: 'home', project: 'ledge' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'ledge' });
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
  it('reconcile keeps a rig or kernel filter while that rig (or a kernel on that machine) is listed, else back to « all »', () => {
    const factory: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false, seats: [], repos: [] };
    const kernel: Rig = { ...factory, id: 'k', name: 'kernel', kernel: true };
    const onRig = navReducer(s0, { type: 'home', project: 'rig:local/r1' });
    expect(reconcile(onRig, [], null, [factory])).toBe(onRig);
    expect(reconcile(onRig, [], null, []).place).toMatchObject({ kind: 'overview', project: 'all' });
    expect(reconcile(onRig, [], null).place).toMatchObject({ kind: 'overview', project: 'all' });
    expect(reconcile(onRig, [], null, [{ ...factory, machine: 'nas' }]).place).toMatchObject({ project: 'all' });
    const onKernel = navReducer(s0, { type: 'home', project: 'kernel:local' });
    expect(reconcile(onKernel, [], null, [kernel])).toBe(onKernel);
    expect(reconcile(onKernel, [], null, [factory]).place).toMatchObject({ project: 'all' });
    // A session page over a rig filter keeps it too.
    const page = navReducer(onRig, { type: 'open', id: 'local:otto' });
    expect(reconcile(page, [sess('otto', { id: 'local:otto' })], null, [factory])).toBe(page);
  });
  it('overview storage survives garbage and reads a stored list as the atelier', () => {
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'room', helpers: 'yes', paused: true }));
    expect(loadOverview()).toEqual({ view: 'atelier', helpers: true, paused: true });
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: false, paused: false }));
    expect(loadOverview()).toEqual({ view: 'atelier', helpers: false, paused: false });
    saveOverview({ view: 'atelier', helpers: false, paused: true });
    expect(loadOverview()).toEqual({ view: 'atelier', helpers: false, paused: true });
  });

  it('reconcile repairs the back of a settings place whose session is gone', () => {
    const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
    const st = navReducer(inSession, { type: 'settings' });
    const r = reconcile(st, [], null);
    expect(r.place).toEqual({ kind: 'settings', section: 'general', back: { kind: 'overview', view: 'atelier', project: 'all' } });
  });
  it('home on a project stays on the atelier', () => {
    const listed = initialNav({ ...o, view: 'list' as 'atelier' });
    expect(navReducer(listed, { type: 'home', project: 'ledge' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'ledge' });
  });
  it('dialogs carry their target; full screen off when already off changes nothing', () => {
    expect(navReducer(s0, { type: 'modal', modal: { kind: 'launch', project: 'ledge' } }).modal).toEqual({ kind: 'launch', project: 'ledge' });
    expect(navReducer(s0, { type: 'fullscreen', on: false })).toBe(s0);
  });
});
