import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, declarations, listSessions, ottoThread, unfoldPast } from './helpers';
import { changesTab, empty, open, serialize } from '../src/workspace/model';
import { ATELIER_TAB, WORKSPACE_KEY } from '../src/workspace/store';

/** The workspace a restart restores: the Atelier, then Otto's Changes left open (the session bar offers « +N −N » only once
 *  something changed, so an empty Changes is a tab kept from before). */
const keepChanges = () => localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(open(open(empty(), changesTab('local:otto')), ATELIER_TAB))));

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

/** An IDE tab of the dock, by its name. */
const dvTab = (name: string) => screen.getAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === name);
/** The session's own tab shows its thread (the IDE flips a tab's view; no Thread | Terminal tabs on the page). */
const onThread = () => !document.querySelector('.session-thread')?.hasAttribute('hidden');
/** A dock tab pressed: its group takes the focus, so its page hears the keys (the IDE's own way, as a click on the tab). */
const front = (name: string) => act(() => { dvTab(name)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
type User = Awaited<ReturnType<typeof boot>>['user'];
/** The IDE (lot 12b): the session bar's « +N −N » opens the session's Changes beside, in a linked group. */
async function showChanges(user: User) {
  await user.click(await screen.findByTitle(/^Changes: \d+ files? · beside/));
  await screen.findByRole('navigation', { name: 'Changed files' });
  front('Changes · Otto');
}
const pane = () => document.querySelector<HTMLElement>('.file-pane')!;
const more: ThreadItem[] = [
  { kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/docs/guide.md', status: 'success', files: [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide\n+ Bonjour' }] },
  { kind: 'tool', id: 'e9', at: new Date().toISOString(), turn: 2, tool: 'Edit', label: '/w/ledge/src/App.tsx', status: 'success', files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- c\n+ d' }] }
];
/** Otto's page on its thread (ottoThread, whose t3 edits src/App.tsx) and `extra`; `base` replaces ottoThread. */
async function openOtto(extra: ThreadItem[] = more, tool: Session['tool'] = 'claude', base: ThreadItem[] = ottoThread()) {
  const env = await boot({ sessions: listSessions().map(s => (s.name === 'Otto' ? { ...s, tool } : s)), list: true });
  env.d.thread('otto', [...base, ...extra]);
  await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
  await unfoldPast(env.user);
  return env;
}

it('Thread / Changes with the count; files grouped by folder; the diff with its signs', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  expect(screen.getByTitle(/^Changes: \d+ files? · beside/)).toHaveAttribute('title', expect.stringMatching(/^Changes: 2 files/));
  expect(dvTab('Changes · Otto')).toHaveAttribute('aria-selected', 'true');
  const list = within(screen.getByRole('navigation', { name: 'Changed files' }));
  expect([...document.querySelectorAll('.dir-name')].map(e => e.textContent)).toEqual(['src', 'docs']);
  expect(list.getByRole('button', { name: /App\.tsx/ })).toHaveAttribute('aria-current', 'true');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  expect(within(pane()).getByText('Changed by')).toBeVisible();
  expect([...pane().querySelectorAll('.touch-link')].map(e => e.textContent)).toEqual(['Edit · turn 1+1−1', 'Edit · turn 2+1−1']);
  expect([...pane().querySelectorAll('.diff-line')].map(r => r.className.replace('diff-line ', '') + ':' + r.querySelector('.code')!.textContent)).toEqual(['del:a', 'add:b', 'del:c', 'add:d']);
});
// 12b: the IDE's Changes tab (ChangesTab.tsx) binds no J / K and no Escape, which the old right panel had.
it.skip('J / K walk the files, never while typing; Copy the path says so', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  await user.keyboard('j');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
  expect(within(pane()).getByText('2 / 2')).toHaveClass('file-pos');
  await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
  await user.keyboard('k');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('k');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  await user.click(within(pane()).getByRole('button', { name: 'Copy the path' }));
  expect(screen.getByText('Path copied: /w/ledge/src/App.tsx')).toBeVisible();     // the live line is a status too
});
// The IDE (R10, ChangesTab.tsx): an action clicked brings the session's tab forward; the action is not lit.
it('« turn 2 » brings the session\'s tab forward on its thread; « View the change » opens the file', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  expect(dvTab('Otto')).toHaveAttribute('aria-selected', 'true');
  expect(onThread()).toBe(true);
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="w1"]')!).getByRole('button', { name: 'View the change' }));
  expect(onThread()).toBe(true);
  expect(within(screen.getByRole('complementary', { name: 'Reading pane' })).getByText('Change · guide.md')).toBeVisible();
});
it('from the Terminal view, « turn 2 » brings the session\'s tab forward; the Changes tab stays', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  // The session's tab on its Terminal view (Ctrl+`, its own view in the IDE), then the action clicked in Changes.
  fireEvent.contextMenu(dvTab('Otto')!);
  await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Switch to the terminal/ }));
  await waitFor(() => expect(onThread()).toBe(false));
  front('Changes · Otto');
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  await waitFor(() => expect(dvTab('Otto')).toHaveAttribute('aria-selected', 'true'));
  expect(dvTab('Changes · Otto')).toBeDefined();
});
it('« View the change » on an absolute path finds the file a relative path opened', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'k1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', change: 'edit', diff: '@@\n-x\n+y' }] },
    { kind: 'tool', id: 'k2', at: new Date().toISOString(), turn: 2, tool: 'Edit', label: '/w/ledge/src/b.ts', status: 'success', files: [{ path: '/w/ledge/src/b.ts', change: 'edit', diff: '- y\n+ z' }] }
  ]);
  await showChanges(user);
  await user.click(within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', { name: /b\.ts/ }));
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="k2"]')!).getByRole('button', { name: 'View the change' }));
  const side = screen.getByRole('complementary', { name: 'Reading pane' });
  expect(side.querySelector('.side-title code')).toHaveTextContent('src/b.ts');
  expect([...side.querySelectorAll('.diff-line .code')].map(c => c.textContent)).toEqual(['x', 'y', 'y', 'z']);   // both actions' diffs
});
// 12b: the IDE's Changes tab binds no Escape for its file list.
it.skip('on a narrow page, Escape closes the file list and the page stays', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  await user.click(within(pane()).getByRole('button', { name: 'Files · 2' }));
  const nav = screen.getByRole('navigation', { name: 'Changed files' });
  expect(nav).toHaveClass('open');
  await user.keyboard('{Escape}');
  expect(nav).not.toHaveClass('open');
  expect(document.querySelector('.session-page')).not.toBeNull();
});
// 12b: the IDE's Changes tab binds no J / K.
it.skip('a held J does not walk the files: only a new press does', async () => {
  const { user } = await openOtto();
  await showChanges(user);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'j', repeat: true });
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'j' });
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
});
it('before the thread is there, Changes says what the thread says, and the tab gives no count', async () => {
  keepChanges();
  await boot({ sessions: listSessions().map(s => (s.name === 'Otto' ? { ...s, offline: true } : s)), list: true });
  front('Changes · Otto');
  await waitFor(() => expect(document.querySelector('.changes-empty')).not.toBeNull());
  expect(screen.queryByTitle(/^Changes: [1-9]/)).toBeNull();
  expect(document.querySelector('.changes-empty')).toHaveTextContent('The thread was not loaded before the connection was lost.');
  expect(screen.queryByText('No file changed')).toBeNull();
});
it('a file without a diff, a cut diff, a renamed file', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'n1', at: new Date().toISOString(), turn: 2, tool: 'NotebookEdit', label: '/w/ledge/a.ipynb', status: 'success', files: [{ path: '/w/ledge/a.ipynb', change: 'edit' }] },
    { kind: 'tool', id: 'c1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/big.txt', status: 'success', files: [{ path: '/w/ledge/big.txt', change: 'write', diff: [...Array.from({ length: 80 }, (_, i) => `+ l${i}`), '…'].join('\n') }] },
    { kind: 'tool', id: 'r1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }] }
  ]);
  await showChanges(user);
  const list = within(screen.getByRole('navigation', { name: 'Changed files' }));
  await user.click(list.getByRole('button', { name: /a\.ipynb/ }));
  expect(within(pane()).getByText('This file has no recorded difference.')).toBeVisible();
  await user.click(list.getByRole('button', { name: /big\.txt/ }));
  expect(within(pane()).getByText('Diff limited to the first 80 lines.')).toBeVisible();
  await user.click(list.getByRole('button', { name: /b\.ts/ }));
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/a.ts → src/b.ts');
  expect(list.getByRole('button', { name: /b\.ts/ }).querySelector('.change-letter')).toHaveTextContent('R');
});
it('nothing changed: said plainly, and Cursor named as the one that does not tell', async () => {
  keepChanges();
  await openOtto([], 'cursor', ottoThread().filter(i => i.id !== 't3'));
  front('Changes · Otto');
  await waitFor(() => expect(document.querySelector('.changes-empty')).not.toBeNull());
  expect(screen.getByText('Cursor Agent does not report the files it touches.')).toBeVisible();
});
it('a renamed file wears the colour of an edited one', () => {
  expect(declarations('session.css', '.change-rename')).toBe(declarations('session.css', '.change-edit'));
  expect(declarations('session.css', '.change-rename')).toContain('color:var(--warning)');
});

const touchHeads = () => [...pane().querySelectorAll('.diff-scroll > .touch-head')];
it('a touch without a diff among several says so under its header', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'n1', at: new Date().toISOString(), turn: 2, tool: 'NotebookEdit', label: '/w/ledge/src/App.tsx', status: 'success', files: [{ path: '/w/ledge/src/App.tsx', change: 'edit' }] }
  ]);
  await showChanges(user);
  expect(touchHeads().map(h => h.textContent)).toEqual(['Edit · turn 1', 'NotebookEdit · turn 2']);
  expect(touchHeads()[1]!.nextElementSibling).toHaveTextContent('No recorded difference for this action.');
  expect(touchHeads()[0]!.nextElementSibling).toHaveRole('table');
});
it('the diff is a table of rows, each with cells; a line says whether it was added or removed', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'k1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/c.ts', status: 'success',
      files: [{ path: 'src/c.ts', change: 'edit', diff: `@@ -1,12 +1,12 @@ fn x\n-a\n+b\n${Array.from({ length: 10 }, (_, i) => ` c${i}`).join('\n')}\n-y\n+z\n@@ -40,1 +40,1 @@\n-p\n+q` }] }
  ]);
  await showChanges(user);
  await user.click(within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', { name: /c\.ts/ }));
  const table = within(pane()).getByRole('table', { name: 'Differences' });
  const rows = within(table).getAllByRole('row');
  expect(rows.length).toBeGreaterThan(10);
  for (const r of rows) expect(within(r).queryAllByRole('cell').length).toBeGreaterThan(0);
  // Every row of the table's own children is a row: hunks, gaps and folds too.
  for (const child of table.children) expect(child).toHaveRole('row');
  expect(within(table).getAllByRole('cell', { name: 'added' })).toHaveLength(3);
  expect(within(table).getAllByRole('cell', { name: 'removed' })).toHaveLength(3);
  expect(within(table).getByRole('cell', { name: /unchanged lines \(lines 13–39\)/ })).toBeVisible();
  await user.click(within(table).getByRole('button', { name: 'Show 4 unchanged lines' }));
  expect(within(table).queryByRole('button', { name: /unchanged line/ })).toBeNull();
});
it('a file touched by five actions: added, edited, renamed, edited, deleted by a Codex patch without a diff', async () => {
  const at = new Date().toISOString();
  const { user } = await openOtto([
    { kind: 'tool', id: 'f1', at, turn: 2, tool: 'apply_patch', label: 'src/a.ts', status: 'success', files: [{ path: 'src/a.ts', change: 'add', diff: '+one\n+two' }] },
    { kind: 'tool', id: 'f2', at, turn: 2, tool: 'Edit', label: '/w/ledge/src/a.ts', status: 'success', files: [{ path: '/w/ledge/src/a.ts', change: 'edit', diff: '- one\n+ uno' }] },
    { kind: 'tool', id: 'f3', at, turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-uno\n+un' }] },
    { kind: 'tool', id: 'f4', at, turn: 2, tool: 'Edit', label: '/w/ledge/src/b.ts', status: 'success', files: [{ path: '/w/ledge/src/b.ts', change: 'edit', diff: '- two\n+ deux' }] },
    { kind: 'tool', id: 'f5', at, turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', change: 'delete' }] }
  ]);
  await showChanges(user);
  const file = within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', { name: /b\.ts/ });
  expect(file.querySelector('.change-letter')).toHaveTextContent('D');
  await user.click(file);
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/a.ts → src/b.ts');
  expect(touchHeads().map(h => h.textContent)).toEqual(['apply_patch · turn 2', 'Edit · turn 2', 'apply_patch · turn 2', 'Edit · turn 2', 'apply_patch · turn 2']);
  expect(touchHeads()[4]!.nextElementSibling).toHaveTextContent('No recorded difference for this action.');
  expect(pane().querySelectorAll('.diff-scroll > [role="table"]')).toHaveLength(4);
});
