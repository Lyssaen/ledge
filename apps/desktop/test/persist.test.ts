import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadViewState, saveViewState } from '../src/state/persist';
import { DEFAULT_VIEW, reduce } from '../src/state/view';

beforeEach(() => localStorage.clear());

describe('view persistence', () => {
  it('round-trips under desktop.view and desktop.selected', () => {
    saveViewState({ view: 'team', grouping: 'jira', attentionOnly: true, selected: 'local:otto' });
    expect(JSON.parse(localStorage.getItem('desktop.view')!)).toEqual({ view: 'team', grouping: 'jira', attentionOnly: true });
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
    expect(loadViewState()).toEqual({ view: 'team', grouping: 'jira', attentionOnly: true, selected: 'local:otto' });
  });
  it('validates field by field and keeps what is sound', () => {
    localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', grouping: 'foo', attentionOnly: 'yes' }));
    expect(loadViewState()).toEqual({ ...DEFAULT_VIEW, view: 'team' });
    localStorage.setItem('desktop.view', '"room"'); expect(loadViewState()).toEqual(DEFAULT_VIEW);
    localStorage.setItem('desktop.view', '{not json'); expect(loadViewState()).toEqual(DEFAULT_VIEW);
    localStorage.setItem('desktop.selected', ''); expect(loadViewState().selected).toBeNull();
    localStorage.setItem('desktop.lang', 'en'); loadViewState(); expect(localStorage.getItem('desktop.lang')).toBe('en');
  });
  it('a null selection removes the key', () => {
    saveViewState({ ...DEFAULT_VIEW, selected: 'ledge' }); saveViewState(DEFAULT_VIEW);
    expect(localStorage.getItem('desktop.selected')).toBeNull();
  });
  it('corrupted desktop.view / desktop.selected start on defaults, never throw, and leave other keys alone', () => {
    localStorage.setItem('desktop.lang', 'fr');
    localStorage.setItem('desktop.sounds', '{"a":1}');
    for (const bad of ['null', '42', '[]', '[1,2]', 'true', '{"view":null,"grouping":7,"attentionOnly":[]}', '\u0000\u{1F4A5}', '{']) {
      localStorage.setItem('desktop.view', bad);
      localStorage.setItem('desktop.selected', '');
      expect(() => loadViewState()).not.toThrow();
      expect(loadViewState()).toEqual(DEFAULT_VIEW);
    }
    expect(localStorage.getItem('desktop.lang')).toBe('fr');
    expect(localStorage.getItem('desktop.sounds')).toBe('{"a":1}');
    expect(localStorage.getItem('desktop.view')).toBe('{');
  });
  it('unavailable storage yields defaults and saving does not throw', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadViewState()).toEqual(DEFAULT_VIEW);
    expect(() => saveViewState(DEFAULT_VIEW)).not.toThrow();
    get.mockRestore(); set.mockRestore();
  });
  it('desktop.selected follows when the selection moves to a visible session', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'select', id: 'local:otto' });
    saveViewState(s);
    s = reduce(s, { type: 'visible', ids: ['devbox:nova'] });
    saveViewState(s);
    expect(localStorage.getItem('desktop.selected')).toBe('devbox:nova');
    s = reduce(s, { type: 'visible', ids: [] });
    saveViewState(s);
    expect(localStorage.getItem('desktop.selected')).toBeNull();
  });
});
