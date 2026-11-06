import { beforeEach, describe, expect, it } from 'vitest';
import { layoutReducer, loadLayout, rightFits, saveLayout, type IdeLayout } from '../../src/workspace/layout';

const KEY = 'ledge.ide.layout';
const base: IdeLayout = { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, right: true };

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
    const l: IdeLayout = { sideOpen: false, sideWidth: 300, sideView: 'rigs', bottom: true, right: false };
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
  });
});

describe('rightFits', () => {
  it('hides the right panel when the editor would drop under its minimum', () => {
    expect(rightFits(base, 1920)).toBe(true);
    expect(rightFits({ ...base, sideWidth: 440 }, 1000)).toBe(false);
    expect(rightFits({ ...base, sideOpen: false }, 760)).toBe(true);
  });
});
