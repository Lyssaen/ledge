import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientMessage, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { Button } from '../src/ui/Button';
import { fakeSession } from './mockDaemon';

// The shell commands, spied: the rest of the bridge (browser shortcut binding included) stays real.
const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => {}) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

function stubClient() {
  const sent: ClientMessage[] = [];
  const client: DaemonClient = { connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
  return { client, sent };
}
const snapshot = (sessions: Session[]) => act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions }); });
const update = (s: Session) => act(() => { daemonStore.apply({ type: 'session.updated', session: s }); });
const remove = (id: string) => act(() => { daemonStore.apply({ type: 'session.removed', id }); });
const daemonError = (id: string, message: string) => act(() => { daemonStore.apply({ type: 'error', id, message }); });
const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const press = (key: string, extra: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(document.activeElement ?? window, { key, ...extra }); });
const shortcut = () => press('l', { ctrlKey: true, altKey: true });
/** Keyboard focus on the n-th listed row (1-based), with K to the top then J down. */
const toRow = (n: number) => { for (let i = 0; i < 9; i++) press('k'); for (let i = 1; i < n; i++) press('j'); };
const surface = () => document.querySelector('[data-surface]') as HTMLElement;
const layer = (name: string) => document.querySelector(`[data-layer="${name}"]`) as HTMLElement;
const mode = () => surface().getAttribute('data-mode');

const otto = (extra: Partial<Session> = {}) => fakeSession('a', extra);
const pim = (extra: Partial<Session> = {}) => fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', ...extra });
const asks = (text: string) => ({ state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text, source: 'hook' as const } });
const review = (kind: 'diff' | 'plan', text: string) => ({ state: 'waiting_permission' as const, pending: { kind, text, source: 'hook' as const } });
const question = (text: string, options: string[]) => ({ state: 'waiting_input' as const, pending: { kind: 'question' as const, text, options, source: 'hook' as const } });

let rec: ReturnType<typeof stubClient>;
const mount = () => render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
beforeEach(() => {
  vi.useFakeTimers();
  daemonStore.reset();
  rec = stubClient();
  for (const f of Object.values(bridge)) f.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('final review fixes', () => {
  it('1. a request replaced during the acknowledgement: the bubble shows the new request unlocked and decides it', () => {
    snapshot([otto(asks('rm -rf dist'))]);
    mount();
    tick(540);
    const bubble = layer('bubble');
    const approve = () => within(bubble).getByRole('button', { name: 'Approve' });
    fireEvent.click(approve());
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    tick(900); // the hold is over, no confirmation yet
    expect(within(bubble).getByText('Sent, waiting for the terminal')).toBeInTheDocument();
    // The daemon replaced the pending in place (mergePending) and dropped the old decision silently.
    update(otto(asks('git push --force')));
    expect(mode()).toBe('bubble');
    expect(within(bubble).getByText(/git push --force/)).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-ack', 'none');
    expect(within(bubble).queryByText('Sent, waiting for the terminal')).toBeNull();
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'false');
    expect(approve()).toBeEnabled();
    fireEvent.click(approve());
    expect(rec.sent.filter(m => m.type === 'session.decide')).toHaveLength(2);
    update(otto({ state: 'working' }));
    tick(900);
    expect(mode()).toBe('handle');
  });

  it('2. Ctrl+Alt+L over a bubble opens the list from the keyboard and takes OS focus', () => {
    snapshot([otto(asks('rm -rf dist'))]);
    mount();
    tick(540);
    expect(mode()).toBe('bubble');
    shortcut();
    expect(mode()).toBe('list');
    expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Otto/));
    expect(bridge.focusOverlay).toHaveBeenCalledTimes(1);
  });

  it('3. a keyboard-opened surface hands OS focus back when it folds; a mouse-opened one does not', () => {
    snapshot([otto(), pim()]);
    mount();
    // Mouse: edge dwell, then collapse.
    fireEvent.mouseEnter(document.querySelector('[data-surface]')!);
    tick(180);
    expect(mode()).toBe('list');
    fireEvent.click(within(layer('list')).getByRole('button', { name: 'Collapse' }));
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).not.toHaveBeenCalled();
    // Keyboard: Ctrl+Alt+L then Escape.
    shortcut();
    expect(mode()).toBe('list');
    expect(bridge.releaseFocus).not.toHaveBeenCalled();
    press('Escape');
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).toHaveBeenCalledTimes(1);
    // Keyboard into a session, then closed from there; and Ctrl+Alt+L again to close.
    shortcut(); toRow(1); press('Enter');
    expect(mode()).toBe('session');
    fireEvent.click(within(layer('session')).getByRole('button', { name: 'Close' }));
    expect(bridge.releaseFocus).toHaveBeenCalledTimes(2);
    shortcut(); shortcut();
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).toHaveBeenCalledTimes(3);
  });

  it('4. buttons carry their variant for the stylesheet, which dims disabled ones and has hover states from tokens', () => {
    render(<><Button variant="primary">Go</Button><Button variant="ghost" disabled style={{ color: 'var(--danger-text)' }}>Off</Button></>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('ledge-btn');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveStyle({ color: 'var(--danger-text)' });
    const css = readFileSync(join(__dirname, '../src/styles/base.css'), 'utf8');
    expect(css).toMatch(/button:disabled\s*\{[^}]*opacity:\s*\.5[^}]*cursor:\s*not-allowed/);
    expect(css).toMatch(/\.ledge-btn\[data-variant="primary"\]:hover:not\(:disabled\)\s*\{[^}]*var\(--primary-hover\)/);
    expect(css).toMatch(/\.ledge-btn\[data-variant="ghost"\]:hover:not\(:disabled\)\s*\{[^}]*var\(--sidebar-accent\)/);
    // Colors only through tokens.
    const btnRules = css.split('\n').filter(l => l.includes('.ledge-btn') || l.includes('button:disabled')).join('\n');
    expect(btnRules).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
  });

  it('5a. a reply the daemon rejects on an idle session shows why and gives the text back', () => {
    snapshot([otto({ state: 'idle' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    const field = () => screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement;
    fireEvent.change(field(), { target: { value: 'run the tests' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(rec.sent).toContainEqual({ type: 'session.reply', id: 'a', text: 'run the tests' });
    expect(field().value).toBe('');
    daemonError('a', 'tmux send failed');
    expect(within(layer('session')).getByRole('status')).toHaveTextContent('tmux send failed');
    expect(field().value).toBe('run the tests');
    // Sending again clears the old failure.
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(within(layer('session')).queryByText('tmux send failed')).toBeNull();
  });

  it('5b. a free-text reply to a question is rejected: the request unlocks, the failure shows, the draft comes back', () => {
    snapshot([otto(question('Which strategy?', ['Backfill', 'Shadow']))]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    const view = layer('session');
    expect(within(view).getByText(/A question takes an option number/)).toBeInTheDocument();
    const field = screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'dual write' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(view).getByRole('button', { name: 'Answer' })).toBeDisabled(); // locked like a decision
    daemonError('a', 'free-text answers are not supported yet, answer in the terminal');
    expect(within(view).getByText(/free-text answers are not supported yet/)).toBeInTheDocument();
    expect(field.value).toBe('dual write');
    expect(within(view).getByRole('button', { name: 'Answer' })).toBeEnabled();
  });

  it('5c. while a permission prompt is pending the reply field explains it and sends nothing', () => {
    snapshot([otto(asks('npm test'))]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    const view = layer('session');
    expect(within(view).getByText('Approve or deny the permission first, then reply')).toBeInTheDocument();
    const field = screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'wait' } });
    expect(within(view).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(rec.sent).toHaveLength(0);
    expect(field.value).toBe('wait');
  });

  it('7. a diff or plan opens its review before any decision: bubble, list row and Y/N', () => {
    snapshot([otto(review('diff', 'src/app.ts +12 -3')), pim()]);
    mount();
    tick(540);
    const bubble = layer('bubble');
    expect(within(bubble).getByText('Otto has a diff to review')).toBeInTheDocument();
    expect(within(bubble).queryByRole('button', { name: 'Approve' })).toBeNull();
    // Later folds the bubble, the request stays pending.
    fireEvent.click(within(bubble).getByRole('button', { name: 'Later' }));
    expect(mode()).toBe('handle');
    expect(rec.sent).toHaveLength(0);
    // From the keyboard list: no inline Approve/Deny on the row, Y opens the session instead of deciding.
    shortcut();
    expect(within(layer('list')).queryByRole('button', { name: /Approve/ })).toBeNull();
    press('y');
    expect(mode()).toBe('session');
    expect(rec.sent).toHaveLength(0);
    // Inside the session (the terminal preview is the review) Approve and Y decide.
    const view = layer('session');
    expect(within(view).getByText(/proposes changes/)).toBeInTheDocument();
    press('y');
    expect(rec.sent).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept' }]);
    // A plan in the bubble: Review opens the session.
    update(otto({ state: 'working' }));
    press('Escape'); press('Escape');
    expect(mode()).toBe('handle');
    update(pim(review('plan', 'Refactor the poller')));
    tick(540);
    expect(within(bubble).getByText('Pim has a plan to review')).toBeInTheDocument();
    fireEvent.click(within(bubble).getByRole('button', { name: 'Review' }));
    expect(mode()).toBe('session');
    expect(screen.getByText('Pim · speos-api')).toBeInTheDocument();
  });

  it('8. removing the bubble session bubbles the next queued ask', () => {
    snapshot([otto(asks('rm -rf dist')), pim(asks('git push'))]);
    mount();
    tick(540);
    expect(within(layer('bubble')).getByText('Otto needs your approval')).toBeInTheDocument();
    remove('a');
    expect(mode()).toBe('bubble');
    expect(within(layer('bubble')).getByText('Pim needs your approval')).toBeInTheDocument();
  });

  it('9. brushing the handle right after an ask does not lose the bubble', () => {
    snapshot([otto()]);
    mount();
    update(otto(asks('rm -rf dist')));
    tick(300);
    const zone = document.querySelector('[data-surface]')!;
    fireEvent.mouseEnter(zone);
    tick(100);
    fireEvent.mouseLeave(zone);
    tick(539);
    expect(mode()).toBe('handle');
    tick(1);
    expect(mode()).toBe('bubble');
  });

  it('10. the terminal tab is reachable for read-only and offline sessions; only the daemon message needs the daemon', () => {
    snapshot([otto({ source: 'hook_only', tmuxSession: null, ...asks('npm test') })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    const tab = within(layer('session')).getByRole('button', { name: 'Focus terminal tab' });
    expect(tab).toBeEnabled();
    fireEvent.click(tab);
    expect(bridge.focusTerminal).toHaveBeenLastCalledWith('Otto · harness-assistant');
    expect(rec.sent).toEqual([{ type: 'session.focus', id: 'a' }]);
    act(() => daemonStore.setStatus('unreachable'));
    fireEvent.click(tab);
    expect(bridge.focusTerminal).toHaveBeenCalledTimes(2);
    expect(rec.sent).toHaveLength(1);
  });

  it('an exited session offers no rename (the daemon would ignore it); a live one does', () => {
    snapshot([otto({ topic: 'Done work', state: 'exited' }), pim({ topic: 'Live work' })]);
    mount();
    shortcut(); toRow(1); press('Enter');
    expect(mode()).toBe('session');
    expect(within(layer('session')).getByRole('button', { name: 'Done work' })).toBeDisabled();
    press('Escape');
    toRow(2); press('Enter');
    expect(within(layer('session')).getByRole('button', { name: 'Live work' })).toBeEnabled();
  });
});
