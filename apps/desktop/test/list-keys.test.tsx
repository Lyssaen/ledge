import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const filter = () => screen.getByRole('textbox', { name: 'Filter the sessions' });
// A browser runs the microtask checkpoint (React's flush of the state it just set) between the React root's key listener and the document's own;
// a script-dispatched event does not, so this listener, after React's, does the same flush. Without it the document handler sees a stale render
// and a key taken twice would go unnoticed.
// Assumes the React root is `body > div` (Testing Library's default container).
const press = (el: Element, key: string) => {
  const root = el.closest('body > div')!;
  const flush = () => { flushSync(() => {}); };
  root.addEventListener('keydown', flush);
  try { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); } finally { root.removeEventListener('keydown', flush); }
};
const banner = () => within(screen.getByRole('banner'));

describe('the List keys', () => {
  it('F goes to the filter, ↓ reaches the first row; J / K walk the rows shown, unfolded subagents included; Enter opens', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('f'); expect(filter()).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(row('Otto')).toHaveFocus();
    await user.keyboard('j'); expect(row('Bix')).toHaveFocus();
    await user.keyboard('jjj'); expect(row('Kit')).toHaveFocus();
    await user.keyboard('j'); expect(row('Otto')).toHaveFocus();
    await user.keyboard('k'); expect(row('Kit')).toHaveClass('keyboard-selected');
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    row('Otto').focus();
    await user.keyboard('j'); expect(screen.getByRole('listitem', { name: /subagent of Otto/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(banner().getByText('Otto')).toBeVisible();
  });
  it('↓ / ↑ walk like J / K; K with nothing chosen takes the last row', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('k'); expect(row('Kit')).toHaveFocus();
    await user.keyboard('{ArrowUp}'); expect(row('Nova')).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(row('Kit')).toHaveFocus();
  });
  it('an empty List takes neither J nor K', async () => {
    const { user } = await boot({ sessions: [], list: true });
    await user.keyboard('jk');
    expect(document.querySelector('.lrow')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
  it('Enter on a subagent row opens the subagent', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    screen.getByRole('listitem', { name: /subagent of Otto/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Lire le code' })).toBeVisible();
  });
  it('a wait keeps its start across a session round trip, though the pane refreshed the activity', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    expect(row('Otto').querySelector('.r-when')).toHaveTextContent('for 12 min');
    await user.click(row('Otto'));
    d.upsert({ ...listSessions()[0]!, lastActivityAt: new Date().toISOString() });
    await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
    await user.keyboard('{Escape}');
    expect(row('Otto').querySelector('.r-when')).toHaveTextContent('for 12 min');
  });
  it('↓ from the filter stops on the first row: the document handler does not take the same key as a J', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('f');
    press(filter(), 'ArrowDown');
    expect(row('Otto')).toHaveFocus();
    await waitFor(() => expect(row('Otto')).toHaveClass('keyboard-selected'));
    expect(document.querySelectorAll('.lrow.keyboard-selected')).toHaveLength(1);
  });
  it('guard: Enter from the filter chooses the first row and opens nothing', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('f');
    // Passes without the fix too: Enter is skipped from inputs, so this pins that it stays that way.
    press(filter(), 'Enter');
    expect(row('Otto')).toHaveFocus();
    await waitFor(() => expect(row('Otto')).toHaveClass('keyboard-selected'));
    expect(document.querySelectorAll('.lrow.keyboard-selected')).toHaveLength(1);
    expect(banner().queryByText('Otto')).toBeNull();
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });
  it('a collapsed group is skipped', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(screen.getByRole('button', { name: 'Collapse Ledge' }));
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('j'); expect(row('Nova')).toHaveFocus();
  });
  it('typing in the filter never walks, opens or launches: j, k, f and n are text there', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(filter());
    await user.keyboard('jkfn');
    expect(filter()).toHaveValue('jkfn');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.lrow.keyboard-selected')).toBeNull();
    expect(document.querySelector('.lrow:focus')).toBeNull();
  });
  it('leaving the filter with Escape is not undone by the next render', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('j'); expect(row('Otto')).toHaveFocus();
    await user.keyboard('f'); await user.keyboard('x');
    await user.keyboard('{Escape}{Escape}');
    expect(filter()).not.toHaveFocus(); expect(row('Otto')).not.toHaveFocus();
    d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' }, lastActivityAt: new Date().toISOString() }));
    await waitFor(() => expect(row('Nova').getAttribute('aria-label')).toMatch(/waiting|question|decide|Waiting/i));
    await new Promise(r => setTimeout(r, 50));
    expect(row('Otto')).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
  it('Escape in the filter clears it, then leaves it; only then does Escape remove the project filter', async () => {
    const { side, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    const clear = () => banner().queryByRole('button', { name: 'Remove the filter: show every project' });
    await user.keyboard('f'); await user.keyboard('bix');
    await user.keyboard('{Escape}');
    expect(filter()).toHaveValue(''); expect(filter()).toHaveFocus(); expect(clear()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(filter()).not.toHaveFocus(); expect(clear()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(clear()).toBeNull();
  });
  it('a row that starts waiting moves up its group; the selection and the focus stay on it', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('jjj'); expect(row('Rio')).toHaveFocus();
    d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', source: 'hook' }, lastActivityAt: new Date().toISOString() }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Ledge' })).getAllByRole('listitem').map(r => r.getAttribute('aria-label')!.split(',')[0])).toEqual(['Otto', 'Rio', 'Bix']));
    expect(row('Rio')).toHaveFocus();
    expect(row('Rio')).toHaveClass('keyboard-selected');
    await user.keyboard('j'); expect(row('Bix')).toHaveFocus();
  });
});
