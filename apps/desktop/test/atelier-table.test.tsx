import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Helper, Project, Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { ProjectTable, type ProjectTableProps } from '../src/atelier/ProjectTable';
import type { Filing } from '../src/atelier/filing';

/** No drag under way: the table only renders. */
const noFiling: Filing = {
  dragging: null, over: null, seated: null,
  dragProps: () => ({ draggable: true, onDragStart: () => {}, onDragEnd: () => {} }),
  dropProps: () => ({ onDragOver: () => {}, onDragLeave: () => {}, onDrop: () => {} }),
  file: () => {}
};

describe('a project table', () => {
const main = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, name: id, machineId: 'local', cwd: '/w/ledge', ...extra });
const helper = (id: string, state: Helper['state'] = 'working'): Helper => ({ id, kind: 'Explore', task: `Task ${id}`, state });
const ledge: Project = { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [] };

type Overrides = Partial<Omit<ProjectTableProps, 'mains' | 'dispatch'>>;
function tableElement(mains: readonly Session[], overrides: Overrides = {}, dispatch: ProjectTableProps['dispatch'] = vi.fn()) {
  return (
    <LangProvider lang="en">
      <ProjectTable project={ledge} mains={mains} order={mains} helpers paused={false} isolated={false} focusedId={null} seated={null} dispatch={dispatch} filing={noFiling} {...overrides} />
    </LangProvider>
  );
}
function renderTable(mains: readonly Session[], overrides: Overrides = {}) {
  const dispatch = vi.fn();
  const { rerender } = render(tableElement(mains, overrides, dispatch));
  return { dispatch, rerender: (el: ReactElement) => rerender(el) };
}

it('a seat per main agent with its name, machine and badge, never the harness', () => {
  renderTable([main('otto', { name: 'Otto', topic: 'Préparer la migration', state: 'waiting_permission', tool: 'codex', machineName: 'Dev SSH' }), main('nova', { name: 'Nova', machineName: 'Local' })]);
  const table = screen.getByRole('region', { name: 'Ledge table' });
  const otto = within(table).getByRole('button', { name: 'Otto, Préparer la migration, Dev SSH' });
  expect(within(otto).getByText('Approval')).toHaveAttribute('data-badge', 'approval');
  expect(otto).toHaveTextContent('Alt 1');
  expect(table).not.toHaveTextContent(/Codex|Claude Code|Cursor Agent/);
});
it('sheets carry the state marks', () => {
  renderTable([main('a', { state: 'waiting_permission' }), main('b', { state: 'waiting_input' }), main('c', { state: 'exited' }), main('d', { state: 'idle' }), main('e', { state: 'waiting_permission', offline: true })]);
  const sheets = [...document.querySelectorAll('.task-sheet')];
  expect(sheets.map(s => [...s.classList].find(c => /^sheet-(approval|question|done|offline|working)$/.test(c)))).toEqual(['sheet-approval', 'sheet-question', 'sheet-done', 'sheet-done', 'sheet-offline']);
  expect(sheets.map(s => [!!s.querySelector('.sheet-flag'), !!s.querySelector('.sheet-stamp')])).toEqual([[true, false], [true, false], [false, true], [false, true], [false, false]]);
  expect(screen.getByRole('button', { name: /^e,/ })).toHaveClass('seat-offline');
});
it("helpers sit at the ends with ↳ parent; the first one's task is a post-it with +N; hidden with the toggle", () => {
  const otto = main('otto', { name: 'Otto', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }, helper('h2')] });
  const { rerender } = renderTable([otto]);
  expect(screen.getByRole('button', { name: 'Explore, subagent of Otto: Lire le code' })).toHaveTextContent('↳ Otto');
  const note = document.querySelector('.sheet-note')!;
  expect(note).toHaveTextContent('Lire le code');
  expect(note.querySelector('.note-more')).toHaveTextContent('+1');
  rerender(tableElement([otto], { helpers: false }));
  expect(document.querySelector('.helper-seat')).toBeNull();
  expect(document.querySelector('.sheet-note')).toBeNull();
});
it('beyond six agents and four helpers: +N opens the List on the project, no plant under it', async () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id, { helpers: id === 'a' ? ['a1', 'a2', 'a3', 'a4', 'a5'].map(h => helper(h)) : [] }));
  const { dispatch } = renderTable(many);
  expect(document.querySelectorAll('.agent-seat:not(.helper-seat)')).toHaveLength(6);
  expect(document.querySelectorAll('.helper-seat')).toHaveLength(4);
  await userEvent.click(screen.getByRole('button', { name: /\+2 at this table/ }));       // g and a5
  expect(dispatch).toHaveBeenCalledWith({ type: 'home', project: 'ledge', view: 'list' });
  expect(document.querySelector('.plant-spot.spot-br')).toBeNull();
});
it('the label: colour, a long name cut with its full name in title, the main branch', () => {
  const long = 'Payment Service Platform Migration Europe';
  renderTable([main('a', { branch: 'desktop' })], { project: { id: 'pay', name: long, color: 'green', description: '', repos: [] } });
  const table = screen.getByRole('region', { name: `${long} table` });
  expect(table.style.getPropertyValue('--project')).toBe('#10b981');
  expect(within(table).getByRole('button', { name: `Conversations of project ${long}` })).toHaveAttribute('title', long);
  expect(within(table).getByText('⎇ desktop')).toHaveAttribute('title', 'desktop');
});
it('the table menu: edit, new session at this table, isolate; Escape closes only the menu', async () => {
  const { dispatch } = renderTable([main('a')]);
  const user = userEvent.setup();
  const open = () => user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'New session at the Ledge table' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'Isolate project Ledge' }));
  expect(dispatch.mock.calls.map(c => c[0])).toEqual([
    { type: 'modal', modal: { kind: 'project', edit: 'ledge' } },
    { type: 'modal', modal: { kind: 'launch', project: 'ledge' } },
    { type: 'home', project: 'ledge' }
  ]);
  await open();
  const onWindow = vi.fn(); window.addEventListener('keydown', onWindow);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(onWindow).not.toHaveBeenCalled();
  window.removeEventListener('keydown', onWindow);
});
it('isolated, the menu offers Show every project, and says so to a screen reader too', async () => {
  const { dispatch } = renderTable([main('a')], { isolated: true });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
  const item = screen.getByRole('menuitem', { name: 'Show every project' });
  expect(item).toHaveTextContent('Show every project');
  expect(screen.queryByRole('menuitem', { name: /Isolate/ })).toBeNull();
  await user.click(item);
  expect(dispatch).toHaveBeenCalledWith({ type: 'home' });
});
it("a seat's name is clamped on its own: the Alt n hint is its sibling, never cut with it", () => {
  renderTable([main('otto', { name: 'Otto with a very long name indeed' })]);
  const strong = screen.getByRole('button', { name: /^Otto with/ }).querySelector('strong')!;
  const name = strong.querySelector(':scope > span.seat-name')!;
  expect(name).toHaveTextContent('Otto with a very long name indeed');
  expect(name).toHaveAttribute('title', 'Otto with a very long name indeed');
  expect(name.nextElementSibling).toHaveClass('seat-shortcut');
  expect(name.nextElementSibling).toHaveTextContent('Alt 1');
  expect(name.querySelector('.seat-shortcut')).toBeNull();
});
it('a seat opens its session, a helper seat its parent', async () => {
  const { dispatch } = renderTable([main('otto', { name: 'Otto', helpers: [helper('h1')] })]);
  await userEvent.click(screen.getByRole('button', { name: /^Otto,/ }));
  await userEvent.click(screen.getByRole('button', { name: /subagent of Otto/ }));
  expect(dispatch.mock.calls.map(c => c[0])).toEqual([{ type: 'open', id: 'local:otto' }, { type: 'open', id: 'local:otto' }]);
});
});
