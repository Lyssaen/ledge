import { describe, it, expect, beforeEach } from 'vitest';
import type { MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { DRAFTS_KEY, DRAFT_MAX, loadDrafts, saveDrafts, setDraft } from '../src/state/drafts';
import { NO_PREF, THREAD_KEY, loadThreadPrefs, saveThreadPrefs, setThreadPref, toggled } from '../src/state/threadPrefs';
import { pruneGone } from '../src/state/prune';

const machine = (id: string, ready: boolean, status: MachineState['status'] = ready ? 'open' : 'connecting') =>
  ({ id, label: id, status, ready, recents: [], sessions: [], launcher: null }) as MachineState;

beforeEach(() => localStorage.clear());

describe('desktop.drafts', () => {
  it('one draft per qualified id; an empty text removes it; same object when unchanged', () => {
    const a = setDraft({}, 'local:otto', 'Bonjour');
    const b = setDraft(a, 'devbox:otto', 'Autre machine');
    expect(b).toEqual({ 'local:otto': 'Bonjour', 'devbox:otto': 'Autre machine' });
    expect(setDraft(b, 'local:otto', 'Bonjour')).toBe(b);
    expect(setDraft(b, 'local:otto', '')).toEqual({ 'devbox:otto': 'Autre machine' });
    expect(setDraft({}, 'x', 'é'.repeat(DRAFT_MAX + 5)).x).toHaveLength(DRAFT_MAX);
  });
  it('round-trips and keeps only valid entries (Review Focus 1)', () => {
    saveDrafts({ 'local:otto': '  garde les espaces ' });
    expect(loadDrafts()).toEqual({ 'local:otto': '  garde les espaces ' });
    localStorage.setItem(DRAFTS_KEY, '{"local:a":"ok","local:b":3,"local:c":"","local:d":null}');
    expect(loadDrafts()).toEqual({ 'local:a': 'ok' });
    for (const raw of ['"text"', '[1,2]', '{oops']) { localStorage.setItem(DRAFTS_KEY, raw); expect(loadDrafts()).toEqual({}); }
  });
});

describe('desktop.thread', () => {
  it('stores folds and reading position per qualified id, never message text', () => {
    let p = setThreadPref({}, 'local:otto', { open: toggled([], 'metadata', true) });
    p = setThreadPref(p, 'local:otto', { scroll: 420 });
    p = setThreadPref(p, 'devbox:nova', { open: ['actions-t1'] });
    saveThreadPrefs(p);
    expect(JSON.parse(localStorage.getItem(THREAD_KEY)!)).toEqual({ 'local:otto': { open: ['metadata'], scroll: 420 }, 'devbox:nova': { open: ['actions-t1'], scroll: null } });
    expect(loadThreadPrefs()).toEqual(p);
    expect(setThreadPref(p, 'local:otto', { scroll: 420 })).toBe(p);
    expect(setThreadPref(p, 'devbox:nova', { open: [] })['devbox:nova']).toBeUndefined();
  });
  it('toggled adds once and removes', () => {
    expect(toggled(['a'], 'a', true)).toEqual(['a']);
    expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
  });
  it('a corrupt entry is dropped, the valid ones kept (Review Focus 1)', () => {
    localStorage.setItem(THREAD_KEY, '{"x":{"open":"metadata","scroll":-4},"y":{"open":["metadata","metadata",3],"scroll":"top"},"z":{"open":[],"scroll":12.5}}');
    expect(loadThreadPrefs()).toEqual({ y: { open: ['metadata'], scroll: null }, z: { open: [], scroll: 12.5 } });
    for (const raw of ['"wide"', '[1,2]', '{oops']) { localStorage.setItem(THREAD_KEY, raw); expect(loadThreadPrefs()).toEqual({}); }
    expect(NO_PREF).toEqual({ open: [], scroll: null });
  });
});

describe('pruneGone (Review Focus 3)', () => {
  const map = { 'local:otto': 'a', 'local:gone': 'b', 'devbox:nova': 'c', 'ghost:x': 'd', ledge: 'e' };
  it('drops ids a ready machine no longer lists and ids of a removed machine; keeps ledge', () => {
    const out = pruneGone(map, [fakeSession('local:otto')], [machine('local', true), machine('devbox', false, 'unreachable')]);
    expect(out).toEqual({ 'local:otto': 'a', 'devbox:nova': 'c', ledge: 'e' });
  });
  it('keeps the ids of a machine still connecting or unreachable at boot', () => {
    const out = pruneGone(map, [], [machine('local', false), machine('devbox', false, 'unreachable'), machine('ghost', false)]);
    expect(out).toBe(map);
  });
  it('a frozen session is still listed, so its entry stays', () => {
    const m = { 'devbox:nova': 'brouillon' };
    expect(pruneGone(m, [fakeSession('devbox:nova', { offline: true })], [machine('local', true), machine('devbox', true)])).toBe(m);
  });
});
