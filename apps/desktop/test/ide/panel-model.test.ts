import { describe, expect, it } from 'vitest';
import { addTerm, createPanelStore, EMPTY_PANEL, isTerminalRef, removeTerm } from '../../src/workspace/panel';

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
