import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, declarations, listSessions, ottoThread } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const pane = () => document.querySelector<HTMLElement>('.file-pane')!;
const more: ThreadItem[] = [
  { kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/docs/guide.md', status: 'success', files: [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide\n+ Bonjour' }] },
  { kind: 'tool', id: 'e9', at: new Date().toISOString(), turn: 2, tool: 'Edit', label: '/w/ledge/src/App.tsx', status: 'success', files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- c\n+ d' }] }
];
/** Otto's page on its thread (ottoThread, whose t3 edits src/App.tsx) and `extra`; `base` replaces ottoThread. */
async function openOtto(extra: ThreadItem[] = more, tool: Session['tool'] = 'claude', base: ThreadItem[] = ottoThread()) {
  const env = await boot({ sessions: listSessions().map(s => (s.name === 'Otto' ? { ...s, tool } : s)), list: true });
  env.d.thread('otto', [...base, ...extra]);
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  return env;
}

it('Thread / Changes with the count; files grouped by folder; the diff with its signs', async () => {
  const { user } = await openOtto();
  expect(tab(/^Changes/)).toHaveTextContent('Changes2');
  await user.click(tab(/^Changes/));
  expect(tab(/^Changes/)).toHaveAttribute('aria-selected', 'true');
  const list = within(screen.getByRole('navigation', { name: 'Changed files' }));
  expect([...document.querySelectorAll('.dir-name')].map(e => e.textContent)).toEqual(['src', 'docs']);
  expect(list.getByRole('button', { name: /App\.tsx/ })).toHaveAttribute('aria-current', 'true');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  expect(within(pane()).getByText('Changed by')).toBeVisible();
  expect([...pane().querySelectorAll('.touch-link')].map(e => e.textContent)).toEqual(['Edit · turn 1+1−1', 'Edit · turn 2+1−1']);
  expect([...pane().querySelectorAll('.diff-line')].map(r => r.className.replace('diff-line ', '') + ':' + r.querySelector('.code')!.textContent)).toEqual(['del:a', 'add:b', 'del:c', 'add:d']);
});
it('J / K walk the files, never while typing; Copy the path says so', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
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
it('« turn 2 » goes back to the action in the thread and flashes it; « View the change » opens the file', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  expect(tab(/^Thread/)).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('[data-tool="e9"]')).toHaveClass('flash');
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="w1"]')!).getByRole('button', { name: 'View the change' }));
  expect(tab(/^Thread/)).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('complementary', { name: 'Reading pane' })).getByText('Change · guide.md')).toBeVisible();
});
it('« View the change » on an absolute path finds the file a relative path opened', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'k1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', change: 'edit', diff: '@@\n-x\n+y' }] },
    { kind: 'tool', id: 'k2', at: new Date().toISOString(), turn: 2, tool: 'Edit', label: '/w/ledge/src/b.ts', status: 'success', files: [{ path: '/w/ledge/src/b.ts', change: 'edit', diff: '- y\n+ z' }] }
  ]);
  await user.click(tab(/^Changes/));
  await user.click(within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', { name: /b\.ts/ }));
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="k2"]')!).getByRole('button', { name: 'View the change' }));
  const side = screen.getByRole('complementary', { name: 'Reading pane' });
  expect(side.querySelector('.side-title code')).toHaveTextContent('src/b.ts');
  expect([...side.querySelectorAll('.diff-line .code')].map(c => c.textContent)).toEqual(['x', 'y', 'y', 'z']);   // both actions' diffs
});
it('on a narrow page, Escape closes the file list and the page stays; the next Escape leaves it', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
  await user.click(within(pane()).getByRole('button', { name: 'Files · 2' }));
  const nav = screen.getByRole('navigation', { name: 'Changed files' });
  expect(nav).toHaveClass('open');
  await user.keyboard('{Escape}');
  expect(nav).not.toHaveClass('open');
  expect(document.querySelector('.session-page')).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(document.querySelector('.session-page')).toBeNull();
});
it('a held J does not walk the files: only a new press does', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
  fireEvent.keyDown(document.body, { key: 'j', repeat: true });
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  fireEvent.keyDown(document.body, { key: 'j' });
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
});
it('before the thread is there, Changes says what the thread says, and the tab gives no count', async () => {
  const { user } = await boot({ sessions: listSessions().map(s => (s.name === 'Otto' ? { ...s, offline: true } : s)), list: true });
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('The thread was not loaded before the connection was lost.');
  expect(tab(/^Changes/).querySelector('.tab-count')).toBeNull();
  await user.click(tab(/^Changes/));
  expect(document.querySelector('.changes-empty')).toHaveTextContent('The thread was not loaded before the connection was lost.');
  expect(screen.queryByText('No file changed')).toBeNull();
});
it('a file without a diff, a cut diff, a renamed file', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'n1', at: new Date().toISOString(), turn: 2, tool: 'NotebookEdit', label: '/w/ledge/a.ipynb', status: 'success', files: [{ path: '/w/ledge/a.ipynb', change: 'edit' }] },
    { kind: 'tool', id: 'c1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/big.txt', status: 'success', files: [{ path: '/w/ledge/big.txt', change: 'write', diff: [...Array.from({ length: 80 }, (_, i) => `+ l${i}`), '…'].join('\n') }] },
    { kind: 'tool', id: 'r1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }] }
  ]);
  await user.click(tab(/^Changes/));
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
  const { user } = await openOtto([], 'cursor', ottoThread().filter(i => i.id !== 't3'));
  await user.click(tab(/^Changes/));
  expect(screen.getByText('Cursor Agent does not report the files it touches.')).toBeVisible();
});
it('a renamed file wears the colour of an edited one', () => {
  expect(declarations('session.css', '.change-rename')).toBe(declarations('session.css', '.change-edit'));
  expect(declarations('session.css', '.change-rename')).toContain('color:var(--warning)');
});

it('« turn 2 » aims at the action: the thread growing as its fold opens does not snap the view back to the end', async () => {
  const calls: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { calls.push(cb); } observe() {} unobserve() {} disconnect() {} });
  try {
    const { user } = await openOtto();
    const el = document.querySelector<HTMLElement>('.session-thread')!;
    const g = { top: 1500, height: 2000 };
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.top, set: (v: number) => { g.top = v; } });
    await user.click(tab(/^Changes/));
    await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
    g.top = 900;                                         // the flash brought the action to the middle
    g.height = 2200;                                     // its fold opened
    act(() => { for (const cb of calls) cb(); });
    expect(g.top).toBe(900);
  } finally { vi.unstubAllGlobals(); }
});

const touchHeads = () => [...pane().querySelectorAll('.diff-scroll > .touch-head')];
it('a touch without a diff among several says so under its header', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'n1', at: new Date().toISOString(), turn: 2, tool: 'NotebookEdit', label: '/w/ledge/src/App.tsx', status: 'success', files: [{ path: '/w/ledge/src/App.tsx', change: 'edit' }] }
  ]);
  await user.click(tab(/^Changes/));
  expect(touchHeads().map(h => h.textContent)).toEqual(['Edit · turn 1', 'NotebookEdit · turn 2']);
  expect(touchHeads()[1]!.nextElementSibling).toHaveTextContent('No recorded difference for this action.');
  expect(touchHeads()[0]!.nextElementSibling).toHaveRole('table');
});
it('the diff is a table of rows, each with cells; a line says whether it was added or removed', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'k1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/c.ts', status: 'success',
      files: [{ path: 'src/c.ts', change: 'edit', diff: `@@ -1,12 +1,12 @@ fn x\n-a\n+b\n${Array.from({ length: 10 }, (_, i) => ` c${i}`).join('\n')}\n-y\n+z\n@@ -40,1 +40,1 @@\n-p\n+q` }] }
  ]);
  await user.click(tab(/^Changes/));
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
  await user.click(tab(/^Changes/));
  const file = within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', { name: /b\.ts/ });
  expect(file.querySelector('.change-letter')).toHaveTextContent('D');
  await user.click(file);
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/a.ts → src/b.ts');
  expect(touchHeads().map(h => h.textContent)).toEqual(['apply_patch · turn 2', 'Edit · turn 2', 'apply_patch · turn 2', 'Edit · turn 2', 'apply_patch · turn 2']);
  expect(touchHeads()[4]!.nextElementSibling).toHaveTextContent('No recorded difference for this action.');
  expect(pane().querySelectorAll('.diff-scroll > [role="table"]')).toHaveLength(4);
});
