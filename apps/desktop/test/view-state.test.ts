import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, reduce } from '../src/state/view';

describe('view reducer', () => {
  it('switches view, grouping and filter', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'view', view: 'team' }); expect(s.view).toBe('team');
    s = reduce(s, { type: 'grouping', grouping: 'jira' }); expect(s.grouping).toBe('jira');
    s = reduce(s, { type: 'attention', on: true }); expect(s.attentionOnly).toBe(true);
  });
  it('keeps the selection when it is still visible, replaces it by the first visible otherwise', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'select', id: 'local:otto' });
    s = reduce(s, { type: 'visible', ids: ['local:pim', 'local:otto'] }); expect(s.selected).toBe('local:otto');
    s = reduce(s, { type: 'visible', ids: ['local:pim', 'devbox:nova'] }); expect(s.selected).toBe('local:pim');
    s = reduce(s, { type: 'visible', ids: [] }); expect(s.selected).toBeNull();
  });
  it('the Ledge chat selection survives a visibility change', () => {
    const s = reduce(reduce(DEFAULT_VIEW, { type: 'select', id: 'ledge' }), { type: 'visible', ids: ['local:pim'] });
    expect(s.selected).toBe('ledge');
  });
  it('returns the same object when nothing changes', () => {
    const s = reduce(DEFAULT_VIEW, { type: 'select', id: null });
    expect(reduce(s, { type: 'visible', ids: [] })).toBe(s);
    const t = reduce(s, { type: 'select', id: 'a' });
    expect(reduce(t, { type: 'visible', ids: ['a', 'b'] })).toBe(t);
  });
  it('with no selection, the first visible session is selected (the mockup always opens one)', () => {
    expect(reduce(DEFAULT_VIEW, { type: 'visible', ids: ['a', 'b'] }).selected).toBe('a');
  });
  it('a selection hidden by the attention filter moves to the first visible session, never an off-screen one', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'select', id: 'local:otto' });
    s = reduce(s, { type: 'attention', on: true });
    s = reduce(s, { type: 'visible', ids: ['devbox:nova', 'local:pim'] });
    expect(s.selected).toBe('devbox:nova');
    expect(s.attentionOnly).toBe(true);
  });
  it('a selection hidden by a grouping change or a removed machine moves to the first visible session', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'select', id: 'devbox:nova' });
    s = reduce(s, { type: 'grouping', grouping: 'machine' });
    s = reduce(s, { type: 'visible', ids: ['local:pim', 'local:otto'] });
    expect(s.selected).toBe('local:pim');
    s = reduce(s, { type: 'visible', ids: ['local:otto'] }); // local:pim's machine removed
    expect(s.selected).toBe('local:otto');
  });
});
