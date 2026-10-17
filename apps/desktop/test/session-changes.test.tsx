import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, ottoThread } from './helpers';

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
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="e9"]')!).getByRole('button', { name: 'View the change' }));
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
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
