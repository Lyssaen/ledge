import { describe, expect, it } from 'vitest';
import { activateTerm, addTerm, besideTerm, createPanelStore, EMPTY_PANEL, isTerminalRef, removeTerm, stackTerm } from '../../src/workspace/panel';

describe('the bottom panel model', () => {
  it('addTerm puts a terminal at the end and on Terminaux, once', () => {
    const p = addTerm({ terms: [], tab: 'out' }, 'shell:1');
    expect(p).toEqual({ terms: ['shell:1'], tab: 'term' });
    expect(addTerm(addTerm(p, 'agent:otto'), 'shell:1').terms).toEqual(['shell:1', 'agent:otto']);
  });

  it('removeTerm of an absent ref gives the same object', () => {
    const p = addTerm(EMPTY_PANEL, 'shell:1');
    expect(removeTerm(p, 'shell:2')).toBe(p);
    expect(removeTerm(p, 'shell:1').terms).toEqual([]);
  });

  it('isTerminalRef: a shell or an agent terminal tab key', () => {
    expect(isTerminalRef('terminal:shell:2')).toBe(true);
    expect(isTerminalRef('terminal:agent:otto')).toBe(true);
    expect(isTerminalRef('session:x')).toBe(false);
  });

  it('a tab dropped on another stacks in that column, in front of it, and is shown', () => {
    const side = { terms: ['shell:1', 'shell:2', 'agent:a'], tab: 'term' as const };
    const stacked = stackTerm(side, 'shell:1', 'agent:a');
    expect(stacked.terms).toEqual(['shell:2', 'shell:1', 'agent:a']);
    expect(stacked.stacks).toEqual([{ refs: ['shell:2'], active: 0 }, { refs: ['shell:1', 'agent:a'], active: 0 }]);
    expect(stackTerm(stacked, 'shell:1', 'agent:a')).toBe(stacked);
    // A dock tab that was not in the panel joins the column.
    expect(stackTerm(side, 'shell:9', 'shell:2').stacks).toEqual([{ refs: ['shell:1'], active: 0 }, { refs: ['shell:9', 'shell:2'], active: 0 }, { refs: ['agent:a'], active: 0 }]);
  });

  it('the right edge opens a column; choosing a stacked tab shows it; closing one leaves the other', () => {
    const side = { terms: ['shell:1', 'shell:2'], tab: 'term' as const };
    const stacked = stackTerm(side, 'shell:2', 'shell:1');
    expect(stacked.stacks).toEqual([{ refs: ['shell:2', 'shell:1'], active: 0 }]);
    expect(besideTerm(stacked, 'shell:1', 'shell:2').stacks).toEqual([{ refs: ['shell:2'], active: 0 }, { refs: ['shell:1'], active: 0 }]);
    expect(besideTerm(side, 'shell:2', 'shell:1')).toBe(side);
    const shown = activateTerm(stacked, 'shell:1');
    expect(shown.stacks?.[0]?.active).toBe(1);
    expect(activateTerm(shown, 'shell:1')).toBe(shown);
    expect(removeTerm(shown, 'shell:2').stacks).toEqual([{ refs: ['shell:1'], active: 0 }]);
  });

  it('its store notifies on change only', () => {
    const s = createPanelStore();
    let n = 0;
    s.subscribe(() => { n += 1; });
    s.update(p => addTerm(p, 'shell:1'));
    s.update(p => removeTerm(p, 'shell:9'));
    expect(n).toBe(1);
    expect(s.get().terms).toEqual(['shell:1']);
  });
});
