import { describe, expect, it } from 'vitest';
import { activate, agentTerminalTab, beside, changesBeside, changesTab, close, closeGroup, closeOthers, CLOSED_MAX, cycleLink, setLink, cycleTab, deserialize, emptyProposals, empty, find, focusGroup, focusNth, focused, keyOf, MAIN, move, moveActive, moveTo, open, place, reconcile, remember, reopenLast, serialize, setView, split, type Closed, type Tab, type Workspace } from '../../src/workspace/model';

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

  it('six link colours: cycleLink goes through them, then none; setLink picks one', () => {
    let w = open(empty(), S('pim'));
    const seen = [w.groups[0]!.link];
    for (let i = 0; i < 7; i++) { w = cycleLink(w, 'g1'); seen.push(w.groups[0]!.link); }
    expect(seen).toEqual([null, 'violet', 'teal', 'rose', 'lime', 'fuchsia', 'sand', null]);
    expect(setLink(w, 'g1', 'lime').groups[0]!.link).toBe('lime');
    expect(setLink(setLink(w, 'g1', 'lime'), 'g1', null).groups[0]!.link).toBeNull();
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

  it('a Rig tab survives serialisation', () => {
    const w = open(empty(), { kind: 'rig', ref: 'local:ledge-dev' });
    expect(deserialize(serialize(w))).toEqual(w);
    expect(deserialize(JSON.stringify(w))?.groups[0]!.tabs).toEqual([{ kind: 'rig', ref: 'local:ledge-dev' }]);
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
  it('the same group with an index reorders: clamped, active, group focused', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    const r = moveTo(w, 'session:c', { group: 'g1', index: 0 });
    expect(keys(r, 'g1')).toEqual(['session:c', 'session:a', 'session:b']);
    expect(front(r, 'g1')).toBe('session:c');
    const e = moveTo(w, 'session:a', { group: 'g1', index: 99 });
    expect(keys(e, 'g1')).toEqual(['session:b', 'session:c', 'session:a']);
    expect(front(e, 'g1')).toBe('session:a');
    expect(e.focus).toBe('g1');
    expect(moveTo(w, 'session:a', { group: 'g1' })).toBe(w);
  });
  it('{rightOf}: a new group just right', () => {
    const w = moveTo(open(two(), S('c')), 'session:c', { rightOf: 'g1' });
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g3', 'g2']);
    expect(keys(w, 'g3')).toEqual(['session:c']);
    expect(w.focus).toBe('g3');
  });
});

describe('place (a terminal brought from the bottom panel)', () => {
  const T: Tab = { kind: 'terminal', ref: 'shell:1' };
  const two = () => { const w = open(open(empty(), S('a')), S('b')); return move(w, 'session:b', { rightOf: 'g1' }); };
  it('into a group: at index (clamped) or the end, active, the group focused; nothing else moves', () => {
    const w = two();
    const at0 = place(w, T, { group: 'g2', index: 0 });
    expect(keys(at0, 'g2')).toEqual(['terminal:shell:1', 'session:b']);
    expect(front(at0, 'g2')).toBe('terminal:shell:1');
    expect(at0.focus).toBe('g2');
    expect(keys(at0, 'g1')).toEqual(['session:a']);
    expect(keys(place(w, T, { group: 'g2', index: 9 }), 'g2')).toEqual(['session:b', 'terminal:shell:1']);
    expect(keys(place(w, T, { group: 'g1' }), 'g1')).toEqual(['session:a', 'terminal:shell:1']);
  });
  it('{rightOf}: a new group just right, holding it; an empty focused group elsewhere stays', () => {
    const w = split(two(), 'g1');   // g1, g3 (empty, focused), g2
    const r = place(w, T, { rightOf: 'g2' });
    expect(r.groups.map(g => g.tabs.map(keyOf))).toEqual([['session:a'], [], ['session:b'], ['terminal:shell:1']]);
    expect(r.focus).toBe(r.groups[3]!.id);
  });
  it('already open: moved there (moveTo); a missing group: no change', () => {
    const w = open(two(), T);   // g2: b, T
    expect(keys(place(w, T, { group: 'g1' }), 'g1')).toEqual(['session:a', 'terminal:shell:1']);
    expect(place(two(), T, { group: 'nope' })).toEqual(two());
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

describe('focusGroup', () => {
  it('focuses a group, empty ones included, so a tab opened « active » lands in it', () => {
    const w = activate(split(open(empty(), S('pim')), 'g1'), 'g1', 0);
    expect(w.focus).toBe('g1');
    const f = focusGroup(w, 'g2');
    expect(f.focus).toBe('g2');
    expect(keys(open(f, agentTerminalTab('pim')), 'g2')).toEqual(['terminal:agent:pim']);
  });
  it('the group already focused, or an unknown one: the same object', () => {
    const w = split(open(empty(), S('pim')), 'g1');
    expect(focusGroup(w, 'g2')).toBe(w);
    expect(focusGroup(w, 'nope')).toBe(w);
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

describe('closeGroup (lot 3 follow-up)', () => {
  it('removes an empty group; the focus goes to its left neighbour', () => {
    let w = split(open(empty(), S('pim')), 'g1');
    expect(w.focus).toBe('g2');
    w = closeGroup(w, 'g2');
    expect(w.groups.map(g => g.id)).toEqual(['g1']);
    expect(w.focus).toBe('g1');
  });
  it('the leftmost group: the focus goes to its right neighbour', () => {
    const left: Workspace = { version: 1, windows: [MAIN], next: 3, focus: 'g1', groups: [
      { id: 'g1', window: MAIN, tabs: [], active: 0, link: null },
      { id: 'g2', window: MAIN, tabs: [S('pim')], active: 0, link: null }
    ] };
    const out = closeGroup(left, 'g1');
    expect(out.groups.map(g => g.id)).toEqual(['g2']);
    expect(out.focus).toBe('g2');
  });
  it('a group with tabs, the main window\'s last group, an unknown group: the same object', () => {
    const w = split(open(empty(), S('pim')), 'g1');
    expect(closeGroup(w, 'g1')).toBe(w);
    expect(closeGroup(w, 'nope')).toBe(w);
    const alone = empty();
    expect(closeGroup(alone, 'g1')).toBe(alone);
  });
  it('another group focused keeps the focus', () => {
    const w = activate(split(open(empty(), S('pim')), 'g1'), 'g1', 0);
    const out = closeGroup(w, 'g2');
    expect(out.groups.map(g => g.id)).toEqual(['g1']);
    expect(out.focus).toBe('g1');
  });
});

describe('cycleTab', () => {
  it('next and previous tab in the group, wrapping; focuses the group', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    expect(front(w, 'g1')).toBe('session:c');
    w = cycleTab(w, 'g1', 1);
    expect(front(w, 'g1')).toBe('session:a');
    w = cycleTab(w, 'g1', 1);
    expect(front(w, 'g1')).toBe('session:b');
    w = cycleTab(w, 'g1', -1);
    w = cycleTab(w, 'g1', -1);
    expect(front(w, 'g1')).toBe('session:c');
  });
  it('one tab or none, or an unknown group: the same object', () => {
    const one = open(empty(), S('a'));
    expect(cycleTab(one, 'g1', 1)).toBe(one);
    const none = empty();
    expect(cycleTab(none, 'g1', -1)).toBe(none);
    expect(cycleTab(one, 'nope', 1)).toBe(one);
  });
});

describe('focusNth', () => {
  it('focuses the Nth group of the main window, left to right; none there: the same object', () => {
    let w = open(open(open(empty(), S('a')), S('b'), 'right'), S('c'), 'right');
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g2', 'g3']);
    w = focusNth(w, 1);
    expect(w.focus).toBe('g1');
    w = focusNth(w, 2);
    expect(w.focus).toBe('g2');
    expect(focusNth(w, 4)).toBe(w);
    // A secondary window's group does not count.
    const v = open(w, S('d'), 'window');
    expect(focusNth(v, 4)).toBe(v);
  });
});

describe('moveActive (Ctrl+Alt+← / →)', () => {
  it('→ moves the focused group\'s active tab into the group on its right', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'), 'right');
    w = activate(w, 'g1', 1);
    w = moveActive(w, 1);
    expect(keys(w, 'g1')).toEqual(['session:a']);
    expect(keys(w, 'g2')).toEqual(['session:c', 'session:b']);
    expect(w.focus).toBe('g2');
  });
  it('→ with no group on the right opens one; ← with none on the left does nothing', () => {
    const w = open(open(empty(), S('a')), S('b'));
    const right = moveActive(w, 1);
    expect(right.groups.map(g => right.groups.find(x => x.id === g.id)!.tabs.map(keyOf))).toEqual([['session:a'], ['session:b']]);
    expect(moveActive(w, -1)).toBe(w);
  });
  it('← moves into the left group; the emptied group goes', () => {
    let w = open(open(empty(), S('a')), S('b'), 'right');
    w = moveActive(w, -1);
    expect(w.groups.map(g => g.id)).toEqual(['g1']);
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b']);
  });
  it('a group\'s only tab with no group on the right, or an empty group: the same object', () => {
    const one = open(empty(), S('a'));
    expect(moveActive(one, 1)).toBe(one);
    const e = split(one, 'g1');
    expect(moveActive(e, 1)).toBe(e);
    expect(moveActive(e, -1)).toBe(e);
  });
});

describe('closed tabs (Ctrl+Shift+T)', () => {
  it('remember notes the tab, its group and place; reopenLast puts it back there and pops it', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    const stack = remember([], w, 'session:b');
    expect(stack).toEqual([{ tab: S('b'), group: 'g1', index: 1 }]);
    w = close(w, 'session:b');
    const r = reopenLast(w, stack);
    expect(keys(r.w, 'g1')).toEqual(['session:a', 'session:b', 'session:c']);
    expect(front(r.w, 'g1')).toBe('session:b');
    expect(r.stack).toEqual([]);
  });
  it('its group gone: into the focused group', () => {
    let w = open(open(empty(), S('a')), S('b'), 'right');
    const stack = remember([], w, 'session:b');
    w = close(w, 'session:b');
    expect(w.groups.map(g => g.id)).toEqual(['g1']);
    const r = reopenLast(w, stack);
    expect(keys(r.w, 'g1')).toEqual(['session:a', 'session:b']);
  });
  it('the last closed first; a tab already open again is skipped; an empty stack changes nothing', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('c'));
    let stack = remember([], w, 'session:b');
    w = close(w, 'session:b');
    stack = remember(stack, w, 'session:c');
    w = close(w, 'session:c');
    w = open(w, S('c'));
    const r = reopenLast(w, stack);
    expect(keys(r.w, 'g1')).toEqual(['session:a', 'session:b', 'session:c']);
    expect(r.stack).toEqual([]);
    const none = reopenLast(r.w, []);
    expect(none.w).toBe(r.w);
  });
  it('an entry whose session is gone is discarded, the next one reopens', () => {
    let w = open(open(open(empty(), S('a')), S('b')), S('gone'));
    let stack = remember([], w, 'session:b');
    w = close(w, 'session:b');
    stack = remember(stack, w, 'session:gone');
    w = close(w, 'session:gone');
    const r = reopenLast(w, stack, t => t.ref !== 'gone');
    expect(keys(r.w, 'g1')).toEqual(['session:a', 'session:b']);
    expect(r.stack).toEqual([]);
  });
  it('keeps the 20 last; an unknown key is not noted', () => {
    let stack: readonly Closed[] = [];
    let w = empty();
    for (let i = 0; i < 25; i++) { w = open(w, S(`s${i}`)); stack = remember(stack, w, `session:s${i}`); }
    expect(stack).toHaveLength(CLOSED_MAX);
    expect(CLOSED_MAX).toBe(20);
    expect(stack.at(-1)!.tab).toEqual(S('s24'));
    expect(stack[0]!.tab).toEqual(S('s5'));
    expect(remember(stack, w, 'session:nope')).toBe(stack);
  });
});
