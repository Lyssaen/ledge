import { beforeEach, describe, expect, it } from 'vitest';
import { layoutFor, layoutReducer, loadLayout, rightFits, rightShown, saveLayout, type IdeLayout } from '../../src/workspace/layout';

const KEY = 'ledge.ide.layout';
const base: IdeLayout = { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 240, right: true };

beforeEach(() => localStorage.clear());

describe('loadLayout', () => {
  it('default layout', () => {
    expect(loadLayout()).toEqual(base);
  });
  it('corrupt storage falls back to the defaults, a valid field is kept', () => {
    localStorage.setItem(KEY, '{"sideWidth":"x"}');
    expect(loadLayout()).toEqual(base);
    localStorage.setItem(KEY, '{"bottom":true}');
    expect(loadLayout()).toEqual({ ...base, bottom: true });
    localStorage.setItem(KEY, 'not json');
    expect(loadLayout()).toEqual(base);
  });
  it('round-trips through saveLayout', () => {
    const l: IdeLayout = { sideOpen: false, sideWidth: 300, sideView: 'rigs', bottom: true, bottomHeight: 320, right: false };
    saveLayout(l);
    expect(loadLayout()).toEqual(l);
  });
});

describe('layoutReducer', () => {
  it('view on the active view folds the sidebar; another view switches and opens', () => {
    expect(layoutReducer(base, { type: 'view', view: 'projects' }).sideOpen).toBe(false);
    const r = layoutReducer({ ...base, sideOpen: false }, { type: 'view', view: 'rigs' });
    expect(r).toMatchObject({ sideView: 'rigs', sideOpen: true });
    expect(layoutReducer(base, { type: 'view', view: 'atoi' })).toMatchObject({ sideView: 'atoi', sideOpen: true });
  });
  it('drag clamps', () => {
    expect(layoutReducer(base, { type: 'drag', width: 90 }).sideWidth).toBe(120);
    expect(layoutReducer(base, { type: 'drag', width: 600 }).sideWidth).toBe(440);
  });
  it('drop under 150 folds and restores the default', () => {
    expect(layoutReducer({ ...base, sideWidth: 140 }, { type: 'drop', width: 140 })).toMatchObject({ sideOpen: false, sideWidth: 248 });
    expect(layoutReducer(base, { type: 'drop', width: 300 })).toMatchObject({ sideOpen: true, sideWidth: 300 });
  });
  it('resetWidth', () => {
    expect(layoutReducer({ ...base, sideWidth: 300 }, { type: 'resetWidth' }).sideWidth).toBe(248);
  });
  it('toggle and show flip panels, leaving sideWidth alone', () => {
    const w = { ...base, sideWidth: 300 };
    expect(layoutReducer(w, { type: 'toggle', panel: 'side' })).toEqual({ ...w, sideOpen: false });
    expect(layoutReducer(w, { type: 'toggle', panel: 'bottom' }).bottom).toBe(true);
    expect(layoutReducer(w, { type: 'toggle', panel: 'right' }).right).toBe(false);
    expect(layoutReducer(w, { type: 'show', panel: 'side', on: false })).toEqual({ ...w, sideOpen: false });
    expect(layoutReducer(w, { type: 'show', panel: 'bottom', on: true }).bottom).toBe(true);
  });
  it('an action that changes nothing returns the same object', () => {
    expect(layoutReducer(base, { type: 'show', panel: 'side', on: true })).toBe(base);
    expect(layoutReducer(base, { type: 'show', panel: 'right', on: true })).toBe(base);
    expect(layoutReducer(base, { type: 'resetWidth' })).toBe(base);
    expect(layoutReducer(base, { type: 'drag', width: 248 })).toBe(base);
    expect(layoutReducer(base, { type: 'drop', width: 248 })).toBe(base);
    expect(layoutReducer(base, { type: 'resetBottom' })).toBe(base);
    expect(layoutReducer(base, { type: 'dragBottom', height: 240 })).toBe(base);
  });
  it('the bottom panel\'s height stays between 120 and 640, and a double click restores 240', () => {
    expect(layoutReducer(base, { type: 'dragBottom', height: 40 }).bottomHeight).toBe(120);
    expect(layoutReducer(base, { type: 'dragBottom', height: 900 }).bottomHeight).toBe(640);
    expect(layoutReducer({ ...base, bottomHeight: 400 }, { type: 'dragBottom', height: 360 }).bottomHeight).toBe(360);
    expect(layoutReducer({ ...base, bottomHeight: 400 }, { type: 'resetBottom' }).bottomHeight).toBe(240);
    expect(layoutReducer({ ...base, bottomHeight: 400 }, { type: 'toggle', panel: 'bottom' }).bottomHeight).toBe(400);
  });
});

describe('rightFits', () => {
  it('hides the right panel when the editor would drop under its minimum', () => {
    expect(rightFits(base, 1920)).toBe(true);
    expect(rightFits({ ...base, sideWidth: 440 }, 1000)).toBe(false);
    expect(rightFits({ ...base, sideOpen: false }, 760)).toBe(true);
  });
});

describe('layoutFor: the right panel asked for makes its room', () => {
  const hidden = { ...base, right: false };
  it('fits: shown as asked, the sidebar left alone', () => {
    expect(layoutFor(hidden, { type: 'toggle', panel: 'right' }, 1200)).toEqual(base);
  });
  it('fits only folded: the sidebar folds (toggle, show, and a toggle while it is asked but off screen)', () => {
    expect(layoutFor(hidden, { type: 'toggle', panel: 'right' }, 900)).toEqual({ ...base, sideOpen: false });
    expect(layoutFor(hidden, { type: 'show', panel: 'right', on: true }, 900)).toEqual({ ...base, sideOpen: false });
    expect(rightShown(base, 900)).toBe(false);
    expect(layoutFor(base, { type: 'toggle', panel: 'right' }, 900)).toEqual({ ...base, sideOpen: false });
  });
  it('a toggle while it shows hides it; with no room even folded, nothing else moves', () => {
    expect(layoutFor(base, { type: 'toggle', panel: 'right' }, 1200)).toEqual(hidden);
    expect(layoutFor(hidden, { type: 'toggle', panel: 'right' }, 600)).toEqual(base);
    expect(rightShown(layoutFor(hidden, { type: 'toggle', panel: 'right' }, 600), 600)).toBe(false);
  });
  it('other actions are layoutReducer\'s', () => {
    expect(layoutFor(base, { type: 'toggle', panel: 'bottom' }, 600)).toEqual(layoutReducer(base, { type: 'toggle', panel: 'bottom' }));
  });
});
