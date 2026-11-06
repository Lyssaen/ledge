import { describe, expect, it } from 'vitest';
import { activate, agentTerminalTab, beside, changesBeside, changesTab, close, closeOthers, cycleLink, deserialize, emptyProposals, empty, find, focused, keyOf, MAIN, move, moveTo, open, reconcile, serialize, setView, split, type Tab, type Workspace } from '../../src/workspace/model';

const S = (id: string): Tab => ({ kind: 'session', ref: id });
const keys = (w: Workspace, groupId: string) => w.groups.find(g => g.id === groupId)!.tabs.map(keyOf);
const front = (w: Workspace, groupId: string) => { const g = w.groups.find(x => x.id === groupId)!; const t = g.tabs[g.active]; return t ? keyOf(t) : null; };

describe('open', () => {
  it('adds to the active group and focuses the tab', () => {
    const w = open(open(empty(), S('pim')), S('nova'));
    expect(keys(w, 'g1')).toEqual(['session:pim', 'session:nova']);
    expect(front(w, 'g1')).toBe('session:nova');
  });

  it('never duplicates a tab: an open one is brought forward, in whichever window', () => {
    let w = open(empty(), S('pim'));
    w = open(w, S('nova'), 'window');
    const nova = find(w, 'session:nova')!.group.id;
    w = activate(w, 'g1', 0);
    w = open(w, S('nova'));
    expect(w.groups.flatMap(g => g.tabs).filter(t => t.ref === 'nova')).toHaveLength(1);
    expect(w.focus).toBe(nova);
  });

  it('« à droite » opens a new group right of the focused one', () => {
    const w = open(open(empty(), S('pim')), S('nova'), 'right');
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g2']);
    expect(keys(w, 'g2')).toEqual(['session:nova']);
    expect(w.focus).toBe('g2');
  });

  it('« nouvelle fenêtre » opens a new window with its own group', () => {
    const w = open(open(empty(), S('pim')), S('nova'), 'window');
    expect(w.windows).toHaveLength(2);
    expect(find(w, 'session:nova')!.group.window).not.toBe(MAIN);
  });
});

describe('close', () => {
  it('a group emptied disappears', () => {
    let w = open(open(empty(), S('pim')), S('nova'), 'right');
    w = close(w, 'session:nova');
    expect(w.groups.map(g => g.id)).toEqual(['g1']);
    expect(w.focus).toBe('g1');
  });

  it('except the last group of the main window', () => {
    const w = close(open(empty(), S('pim')), 'session:pim');
    expect(w.groups).toHaveLength(1);
    expect(w.groups[0]!.tabs).toEqual([]);
  });

  it('a secondary window left without groups closes', () => {
    let w = open(open(empty(), S('pim')), S('nova'), 'window');
    w = close(w, 'session:nova');
    expect(w.windows).toEqual([MAIN]);
  });

  it('an empty group made by a split stays when another tab closes', () => {
    let w = open(open(empty(), S('pim')), S('nova'));
    w = split(w, 'g1');
    w = close(w, 'session:nova');
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g2']);
  });

  it('keeps the active tab when an earlier one closes', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    w = close(w, 'session:a');
    expect(front(w, 'g1')).toBe('session:c');
  });
});

describe('move', () => {
  it('to another group, the source emptied disappears', () => {
    let w = open(open(empty(), S('pim')), S('nova'), 'right');
    w = move(w, 'session:nova', { group: 'g1' });
    expect(w.groups.map(g => g.id)).toEqual(['g1']);
    expect(keys(w, 'g1')).toEqual(['session:pim', 'session:nova']);
  });

  it('torn out of the window: a new window', () => {
    let w = open(open(empty(), S('pim')), S('nova'));
    w = move(w, 'session:nova', { window: 'new' });
    expect(w.windows).toHaveLength(2);
    expect(find(w, 'session:nova')!.group.window).not.toBe(MAIN);
    // Dragged back into a group: the secondary window closes.
    w = move(w, 'session:nova', { group: 'g1' });
    expect(w.windows).toEqual([MAIN]);
  });

  it('to a new group right of one', () => {
    let w = open(open(empty(), S('pim')), S('nova'));
    w = move(w, 'session:nova', { rightOf: 'g1' });
    expect(w.groups.map(g => keys(w, g.id))).toEqual([['session:pim'], ['session:nova']]);
  });
});

describe('split', () => {
  it('an empty group right of it, remembering the session left', () => {
    const w = split(open(empty(), S('pim')), 'g1');
    expect(w.groups[1]!).toMatchObject({ tabs: [], from: 'pim' });
    expect(w.focus).toBe(w.groups[1]!.id);
  });
});

describe('linked groups', () => {
  /** Pim and Nova in g1, Pim's changes in g2, both violet. */
  function linked(): Workspace {
    let w = open(open(empty(), S('pim')), S('nova'));
    w = activate(w, 'g1', 0);
    w = beside(w, 'g1', 'changes', 'pim');
    return w;
  }

  it('« +N −N » links the group and opens the changes beside it, in the same colour', () => {
    const w = linked();
    expect(w.groups.map(g => g.link)).toEqual(['violet', 'violet']);
    expect(keys(w, 'g2')).toEqual(['changes:pim']);
    expect(w.focus).toBe('g1');
  });

  it('choosing another session switches the changes of the linked group', () => {
    const w = activate(linked(), 'g1', 1);
    expect(keys(w, 'g2')).toEqual(['changes:nova']);
  });

  it('follows across windows', () => {
    let w = linked();
    w = move(w, 'changes:pim', { window: 'new' });
    const pop = find(w, 'changes:pim')!.group.id;
    w = cycleLink(w, pop); // none → violet
    w = activate(w, 'g1', 1);
    expect(front(w, pop)).toBe('changes:nova');
  });

  it('a group of another colour does not follow', () => {
    let w = linked();
    w = cycleLink(w, 'g2'); // violet → teal
    w = activate(w, 'g1', 1);
    expect(keys(w, 'g2')).toEqual(['changes:pim']);
  });

  it('a terminal of the session follows too; a plain shell does not', () => {
    let w = open(open(empty(), S('pim')), S('nova'));
    w = activate(w, 'g1', 0);
    w = beside(w, 'g1', 'terminal', 'pim');
    w = activate(w, 'g1', 1);
    expect(keys(w, 'g2')).toEqual([keyOf(agentTerminalTab('nova'))]);
    w = open(w, { kind: 'terminal', ref: 'shell:1' });
    expect(keys(w, 'g1')).toContain('terminal:shell:1');
  });

  it('the link square cycles none → violet → teal → none', () => {
    let w = open(empty(), S('pim'));
    const seen = [w.groups[0]!.link];
    for (let i = 0; i < 3; i++) { w = cycleLink(w, 'g1'); seen.push(w.groups[0]!.link); }
    expect(seen).toEqual([null, 'violet', 'teal', null]);
  });

  it('« +N −N » again focuses the existing changes, never a second copy', () => {
    let w = linked();
    w = beside(w, 'g1', 'changes', 'pim');
    expect(w.groups.flatMap(g => g.tabs).filter(t => keyOf(t) === keyOf(changesTab('pim')))).toHaveLength(1);
  });
});

describe('views, reconcile, layouts', () => {
  it('Ctrl+` switches a session tab between thread and terminal', () => {
    const w = setView(open(empty(), S('pim')), 'session:pim', 'terminal');
    expect(w.groups[0]!.tabs[0]!.view).toBe('terminal');
  });

  it('drops tabs whose session is gone', () => {
    let w = open(open(empty(), S('pim')), S('gone'), 'right');
    w = reconcile(w, t => t.ref !== 'gone');
    expect(w.groups.flatMap(g => g.tabs).map(keyOf)).toEqual(['session:pim']);
    expect(w.groups).toHaveLength(1);
  });

  it('a layout survives serialisation', () => {
    let w = open(open(empty(), S('pim')), S('nova'), 'window');
    w = beside(w, 'g1', 'changes', 'pim');
    expect(deserialize(serialize(w))).toEqual(w);
  });

  it('a malformed layout is refused', () => {
    expect(deserialize('{')).toBeNull();
    expect(deserialize(JSON.stringify({ ...empty(), version: 2 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...empty(), groups: [{ id: 'g1', window: 'nowhere', tabs: [], active: 0, link: null }] }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...empty(), groups: [{ id: 'g1', window: MAIN, tabs: [{ kind: 'wall', ref: 'x' }], active: 0, link: null }] }))).toBeNull();
  });

  it('a layout without a main-window group gets one', () => {
    const w = deserialize(JSON.stringify({ version: 1, windows: [MAIN], groups: [], focus: 'g9', next: 3 }))!;
    expect(w.groups).toHaveLength(1);
    expect(focused(w).window).toBe(MAIN);
  });
});

describe('closeOthers', () => {
  it('keeps only the tab, active, in its group; other groups stay', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    w = open(w, S('z'), 'right');
    const out = closeOthers(w, 'session:b');
    expect(keys(out, 'g1')).toEqual(['session:b']);
    expect(front(out, 'g1')).toBe('session:b');
    expect(keys(out, 'g2')).toEqual(['session:z']);
  });
  it('an unknown key gives the same object', () => {
    const w = open(empty(), S('a'));
    expect(closeOthers(w, 'session:nope')).toBe(w);
  });
});

describe('changesBeside', () => {
  it('gives the colour of the linked group fronting the session changes', () => {
    let w = open(empty(), S('a'));
    w = beside(w, 'g1', 'changes', 'a');
    const link = w.groups.find(g => g.id === 'g1')!.link;
    expect(link).not.toBeNull();
    expect(changesBeside(w, 'session:a')).toBe(link);
  });
  it('is null without a linked group', () => {
    expect(changesBeside(open(empty(), S('a')), 'session:a')).toBeNull();
  });
  it('is null when the linked group fronts another tab', () => {
    let w = open(empty(), S('a'));
    w = beside(w, 'g1', 'changes', 'a');
    const peer = w.groups.find(g => g.id !== 'g1')!;
    w = open(activate(w, peer.id, 0), S('other'));
    expect(changesBeside(w, 'session:a')).toBeNull();
  });
});

describe('moveTo', () => {
  const two = () => { const w = open(open(empty(), S('a')), S('b')); return move(w, 'session:b', { rightOf: 'g1' }); };
  it('to index 0 of another group: first and active, the group focused', () => {
    const w = moveTo(two(), 'session:a', { group: 'g2', index: 0 });
    expect(keys(w, 'g2')).toEqual(['session:a', 'session:b']);
    expect(keys(w, 'g2')[0]).toBe('session:a');
    expect(front(w, 'g2')).toBe('session:a');
    expect(w.focus).toBe('g2');
  });
  it('without index: at the end; index is clamped', () => {
    const w = moveTo(two(), 'session:a', { group: 'g2' });
    expect(keys(w, 'g2')).toEqual(['session:b', 'session:a']);
    const v = moveTo(open(two(), S('c')), 'session:c', { group: 'g2', index: 99 });
    expect(keys(v, 'g2')).toEqual(['session:b', 'session:c']);
  });
  it('the emptied source disappears, except MAIN\'s last', () => {
    const w = moveTo(two(), 'session:a', { group: 'g2' });
    expect(w.groups.map(g => g.id)).toEqual(['g2']);
    const one = open(empty(), S('a'));
    expect(moveTo(one, 'session:a', { group: 'g1' })).toBe(one);
  });
  it('{rightOf}: a new group just right', () => {
    const w = moveTo(open(two(), S('c')), 'session:c', { rightOf: 'g1' });
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g3', 'g2']);
    expect(keys(w, 'g3')).toEqual(['session:c']);
    expect(w.focus).toBe('g3');
  });
});

describe('emptyProposals', () => {
  it('from a session: terminalOf is its id', () => {
    const w = split(open(empty(), S('pim')), 'g1');
    expect(emptyProposals(w, 'g2')).toEqual({ terminalOf: 'pim' });
  });
  it('from the atelier, or a group with tabs or unknown: null', () => {
    const w = split(open(empty(), { kind: 'atelier', ref: '' }), 'g1');
    expect(emptyProposals(w, 'g2')).toEqual({ terminalOf: null });
    expect(emptyProposals(open(split(open(empty(), S('pim')), 'g1'), S('x')), 'g2')).toEqual({ terminalOf: null });
    expect(emptyProposals(w, 'nope')).toEqual({ terminalOf: null });
  });
});

describe('a linked Changes group follows until the link is cycled off', () => {
  it('follows, then stops after cycleLink goes to null', () => {
    let w = open(open(empty(), S('a')), S('b'));
    w = beside(w, 'g1', 'changes', 'a');
    const peer = w.groups.find(g => g.id !== 'g1')!.id;
    w = activate(w, 'g1', 1);
    expect(front(w, peer)).toBe('changes:b');
    while (w.groups.find(g => g.id === peer)!.link !== null) w = cycleLink(w, peer);
    w = activate(w, 'g1', 0);
    expect(front(w, peer)).toBe('changes:b');
  });
});
