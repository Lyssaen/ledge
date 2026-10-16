import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, listSessions, PROJECTS, transfer } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const group = (name: string) => screen.getByRole('region', { name });

describe('filing from Sans projet in the List', () => {
  it('dragging Kit onto the Ledge group writes the rule; Kit joins that group once the daemon broadcasts', async () => {
    const { d } = await boot({ sessions: listSessions(), list: true });
    const dt = transfer();
    fireEvent.dragStart(row('Kit'), { dataTransfer: dt });
    expect(screen.getByText('Drop on a project in the sidebar or on its group.')).toBeVisible();
    fireEvent.dragOver(group('Ledge'), { dataTransfer: dt });
    expect(group('Ledge')).toHaveClass('drop-over');
    expect(within(group('Ledge')).getByText('Drop to move Kit')).toBeVisible();
    fireEvent.dragOver(group('No project'), { dataTransfer: dt });
    expect(group('No project')).not.toHaveClass('drop-over');
    fireEvent.drop(group('Ledge'), { dataTransfer: dt });
    await waitFor(() => expect(d.received).toContainEqual({ type: 'projects.set', projects: { projects: PROJECTS.projects, rules: [{ machine: 'local', path: '/tmp', project: 'ledge' }] } }));
    await waitFor(() => expect(within(group('Ledge')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible());
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Kit joins the Ledge table. Ledge will remember this folder.');
  });
  it('Move to… on a row: ↓ reaches the next project, Escape gives the focus back, a choice files Kit', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    const trigger = within(row('Kit')).getByRole('button', { name: 'Move to…' });
    await user.click(trigger);
    expect(row('Kit')).toHaveClass('menu-open');
    expect(screen.getByRole('menuitem', { name: /^Ledge/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /^Payment/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /^Payment/ }));
    await waitFor(() => expect(within(group('Payment Service Platform Migration Europe')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible());
  });
  it('with the local daemon down, a drop says so in plain words and Kit stays in Sans projet', async () => {
    const { d, side } = await boot({ sessions: listSessions(), list: true });
    await d.close();
    await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'));
    const dt = transfer();
    fireEvent.dragStart(row('Kit'), { dataTransfer: dt });
    fireEvent.dragOver(group('Ledge'), { dataTransfer: dt });
    fireEvent.drop(group('Ledge'), { dataTransfer: dt });
    expect(screen.getByRole('status')).toHaveTextContent('Kit could not be moved: the local Ledge daemon is not reachable.');
    expect(within(group('No project')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible();
  });
  it('only the main agents of Sans projet drag, with a grip; the others neither drag nor offer Move to…', async () => {
    await boot({ sessions: listSessions(), list: true });
    expect(row('Kit')).toHaveAttribute('draggable', 'true');
    expect(within(row('Kit')).getByTitle('Drag onto a project')).toBeInTheDocument();
    expect(within(row('Kit')).getByRole('button', { name: /^Open$/ })).toBeInTheDocument();
    expect(row('Otto')).not.toHaveAttribute('draggable');
    expect(within(row('Otto')).queryByTitle('Drag onto a project')).toBeNull();
    expect(within(row('Otto')).queryByRole('button', { name: 'Move to…' })).toBeNull();
    const dt = transfer();
    fireEvent.dragStart(row('Kit'), { dataTransfer: dt });
    expect(row('Kit')).toHaveClass('is-dragged');
    expect(within(group('Ledge')).getByText('Drop here')).toBeVisible();
  });
  it('Move to… opens upward for a row low in the window (flip)', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    const trigger = within(row('Kit')).getByRole('button', { name: 'Move to…' });
    const rect = (bottom: number) => { trigger.getBoundingClientRect = () => ({ bottom, top: bottom - 28, left: 0, right: 0, width: 0, height: 28, x: 0, y: 0, toJSON() {} }) as DOMRect; };
    rect(window.innerHeight * 0.9);
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Move to…' })).toHaveClass('up');
    await user.keyboard('{Escape}');
    rect(window.innerHeight * 0.2);
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Move to…' })).not.toHaveClass('up');
  });
});
