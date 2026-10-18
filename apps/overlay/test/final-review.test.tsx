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
  const client: DaemonClient = { connect() {}, close() {}, send: m => { if (m.type !== 'session.thread') sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
  return { client, sent };
}
const snapshot = (sessions: Session[]) => act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions }); });
const update = (s: Session) => act(() => { daemonStore.apply({ type: 'session.updated', session: s }); });
const remove = (id: string) => act(() => { daemonStore.apply({ type: 'session.removed', id }); });
const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const press = (key: string, extra: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(document.activeElement ?? window, { key, ...extra }); });
const shortcut = () => press('l', { ctrlKey: true, altKey: true });
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
    expect(document.querySelector('[data-timer]')).toBeNull();
    expect(approve()).toBeEnabled();
    fireEvent.click(approve());
    expect(rec.sent.filter(m => m.type === 'session.decide')).toHaveLength(2);
    update(otto({ state: 'working' }));
    tick(900);
    expect(mode()).toBe('handle');
  });

  it('2. Ctrl+Alt+L over the ask that is already showing opens the chat and takes OS focus', () => {
    snapshot([otto(asks('rm -rf dist'))]);
    mount();
    tick(540);
    expect(mode()).toBe('bubble');
    shortcut();
    expect(mode()).toBe('chat');
    expect(bridge.focusOverlay).toHaveBeenCalledTimes(1);
  });

  it('3. a keyboard-opened chat hands OS focus back when it folds; a mouse-opened one does not', () => {
    snapshot([otto(), pim()]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    tick(180);
    expect(mode()).toBe('chat');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).not.toHaveBeenCalled();
    shortcut();
    expect(mode()).toBe('chat');
    expect(bridge.releaseFocus).not.toHaveBeenCalled();
    // The composer swallows the first Escape (it only blurs). The next one folds the chat.
    press('Escape');
    press('Escape');
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).toHaveBeenCalledTimes(1);
    shortcut(); shortcut();
    expect(mode()).toBe('handle');
    expect(bridge.releaseFocus).toHaveBeenCalledTimes(2);
  });

  it('4. buttons carry their variant for the stylesheet, which dims disabled ones and has hover states from tokens', () => {
    render(<><Button variant="primary">Go</Button><Button variant="ghost" disabled style={{ color: 'var(--danger-text)' }}>Off</Button></>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('ledge-btn');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveStyle({ color: 'var(--danger-text)' });
    const css = readFileSync(join(__dirname, '../../../packages/ui/src/styles/base.css'), 'utf8');
    expect(css).toMatch(/button:disabled\s*\{[^}]*opacity:\s*\.5[^}]*cursor:\s*not-allowed/);
    expect(css).toMatch(/\.ledge-btn\[data-variant="primary"\]:hover:not\(:disabled\)\s*\{[^}]*var\(--primary-hover\)/);
    expect(css).toMatch(/\.ledge-btn\[data-variant="ghost"\]:hover:not\(:disabled\)\s*\{[^}]*var\(--sidebar-accent\)/);
    // Colors only through tokens.
    const btnRules = css.split('\n').filter(l => l.includes('.ledge-btn') || l.includes('button:disabled')).join('\n');
    expect(btnRules).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
  });

  it('5. a question on the card sends the chosen words; an empty choice sends nothing and says so', () => {
    snapshot([otto(question('Which strategy?', ['Backfill', 'Shadow']))]);
    mount();
    tick(540);
    const bubble = layer('bubble');
    fireEvent.click(within(bubble).getByRole('button', { name: 'Reply' }));
    expect(within(bubble).getByRole('alert')).toHaveTextContent('Choose an answer or write one.');
    expect(rec.sent).toHaveLength(0);
    fireEvent.click(within(bubble).getByRole('radio', { name: /Shadow/ }));
    fireEvent.click(within(bubble).getByRole('button', { name: 'Reply' }));
    expect(rec.sent).toContainEqual({ type: 'session.reply', id: 'a', text: 'Shadow' });
  });

  it('7. a diff or plan is reread in Ledge, never approved from the island', () => {
    snapshot([otto(review('diff', 'src/app.ts +12 -3')), pim()]);
    mount();
    tick(540);
    const bubble = layer('bubble');
    expect(within(bubble).getByText('Otto has a diff to review')).toBeInTheDocument();
    expect(within(bubble).queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(within(bubble).getByRole('button', { name: /Later/ }));
    expect(mode()).toBe('handle');
    expect(rec.sent).toHaveLength(0);
    shortcut();
    expect(mode()).toBe('bubble');
    press('y');
    expect(rec.sent).toHaveLength(0);
    fireEvent.click(within(bubble).getByRole('button', { name: 'Review in Ledge' }));
    expect(mode()).toBe('bubble');
    expect(screen.getByText(/Opening Otto in Ledge Desktop/)).toBeInTheDocument();
    update(otto({ state: 'working' }));
    press('Escape');
    expect(mode()).toBe('handle');
    update(pim(review('plan', 'Refactor the poller')));
    tick(540);
    expect(within(bubble).getByText('Pim has a plan to review')).toBeInTheDocument();
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

  it('10. Open in Ledge on a read-only ask notes the session and does not focus a terminal', () => {
    snapshot([otto({ source: 'hook_only', tmuxSession: null, ...asks('npm test') })]);
    mount();
    tick(540);
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: /Open in Ledge/ }));
    expect(screen.getByText(/Opening Otto in Ledge Desktop/)).toBeInTheDocument();
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
    expect(rec.sent.filter(m => m.type === 'session.focus')).toHaveLength(0);
    expect(mode()).toBe('bubble');
  });

  it('an exited bot opens a peek, not a rename field', () => {
    snapshot([otto({ topic: 'Done work', state: 'exited' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    expect(mode()).toBe('peek');
    expect(within(layer('peek')).getByText('Done work')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done work' })).toBeNull();
  });
});
