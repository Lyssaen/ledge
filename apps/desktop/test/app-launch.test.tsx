import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { recent } from './launch-helpers';

// Every wait here rides a real WebSocket (connect, snapshot, machines, then the launch round trip) inside jsdom. Testing
// Library's 1 s default and vitest's 5 s test limit are too tight when parallel workers starve the CPU: the first test of the
// file, which also pays the cold module load, failed after ~2 s on `findByRole('button', { name: 'Start a session' })`
// because the fleet was not ready yet. The waits still return as soon as the condition holds; only the give-up point moves.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

/** The real Desktop fleet against the mock daemon: one machine (local) with one recent project, /w/ledge. */
async function boot(seed: { sessions?: Session[]; view?: Record<string, unknown>; selected?: string; panel?: unknown } = {}) {
  localStorage.clear();
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', ...seed.view }));
  if (seed.selected) localStorage.setItem('desktop.selected', seed.selected);
  if (seed.panel) localStorage.setItem('desktop.panel', JSON.stringify(seed.panel));
  const d = await createMockDaemon(); daemons.push(d);
  for (const s of seed.sessions ?? []) d.upsert(s);
  d.recents([recent('/w/ledge', '2026-10-15T09:00:00.000Z')]);
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  return d;
}
const launches = (d: Daemon) => d.received.filter(m => m.type === 'session.launch');
const listed = (id: string) => waitFor(() => expect(document.querySelector(`[data-session="${id}"]`)).not.toBeNull());
async function fillAndStart(user: ReturnType<typeof userEvent.setup>, prompt = 'Fix the flaky test') {
  await screen.findByRole('form', { name: 'New session settings' });
  await user.type(screen.getByLabelText('First instruction'), prompt);
  await user.click(screen.getByRole('button', { name: 'Start the session' }));
}

describe('launching from the Shell', () => {
  it('starts a session from the empty workspace and opens its conversation', async () => {
    const user = userEvent.setup();
    const d = await boot({ panel: { width: 38, expanded: true } });
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    // The launch screen takes the place of the heading and the sessions; the status bar stays.
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'New session' })).toBeInTheDocument();
    expect(document.querySelector('.statusbar')).not.toBeNull();
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the flaky test' }]));
    expect(within(screen.getByRole('region', { name: 'Starting the session' })).getByRole('status')).toHaveTextContent('Preparing the session on Local · WSL…');
    expect(localStorage.getItem('desktop.launch')).not.toBeNull();
    d.launched(fakeSession('ari', { name: 'Ari', cwd: '/w/ledge', project: 'ledge', state: 'working' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari'));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('conversation-reply')));
    expect(localStorage.getItem('desktop.selected')).toBe('local:ari');
    expect(localStorage.getItem('desktop.launch')).toBeNull();
    expect(JSON.parse(localStorage.getItem('desktop.panel')!)).toMatchObject({ expanded: false });
    expect(screen.queryByRole('form', { name: 'New session settings' })).toBeNull();
  });

  it('turns the attention filter off so the new session shows', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto', state: 'waiting_input' })], view: { attentionOnly: true }, selected: 'local:otto' });
    await listed('local:otto');
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.launched(fakeSession('ari', { name: 'Ari', state: 'working' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari'));
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-session="local:ari"]')).not.toBeNull();
  });

  it('Cancel closes the screen; the late session is listed, not selected, and the form is kept', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto' })], selected: 'local:otto' });
    await listed('local:otto');
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cancel launch' }));
    expect(screen.getByRole('button', { name: 'New session' })).toHaveFocus();
    d.launched(fakeSession('late', { name: 'Late' }));
    await listed('local:late');
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
    expect(JSON.parse(localStorage.getItem('desktop.launch')!)).toMatchObject({ prompt: 'Fix the flaky test' });
    await user.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByLabelText('First instruction')).toHaveValue('Fix the flaky test');
  });

  it('Back to sessions returns the focus to the button that opened the screen', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'Start a session' })).toHaveFocus();
    expect(localStorage.getItem('desktop.launch')).toBeNull();   // nothing typed, nothing written
  });

  it('a refused launch says why; Retry sends the same request and its session is selected', async () => {
    const user = userEvent.setup();
    const d = await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.refuse('folder not found: /w/ledge');
    expect(await screen.findByRole('alert')).toHaveTextContent('The daemon refused: folder not found: /w/ledge');
    expect(screen.getByRole('heading', { level: 3, name: 'The agent could not start' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(launches(d)).toHaveLength(2));
    expect(launches(d)[1]).toEqual(launches(d)[0]);
    d.launched(fakeSession('ari', { name: 'Ari' }));
    await waitFor(() => expect(localStorage.getItem('desktop.selected')).toBe('local:ari'));
  });

  it('a launched session the fleet never lists does not keep the focus from coming back later', async () => {
    const user = userEvent.setup();
    const d = await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.reply({ type: 'session.launched', id: 'ghost' });   // it died at once: never listed
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Starting the session' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Start a session' }));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'Start a session' })).toHaveFocus();
  });

  it('the local daemon falling while the launch screen is open shows its notice as a status, not an alert (R3)', async () => {
    const user = userEvent.setup();
    const d = await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    daemons.splice(daemons.indexOf(d), 1);
    await d.close();
    const notice = (await screen.findByText('Local daemon unreachable')).closest('[role]')!;
    expect(notice).toHaveAttribute('role', 'status');
    // Still on the launch screen, the notice among its own notices (between its heading and its scrolled body).
    expect(screen.getByRole('heading', { level: 2, name: 'New session' })).toBeInTheDocument();
    expect(document.querySelector('.settings-heading ~ .local-down')).toBe(notice);
    expect(screen.queryAllByRole('alert').filter(a => a.textContent?.includes('Local daemon unreachable'))).toEqual([]);
  });
});

// The local daemon never answers: everything is read-only (spec §6).
class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('launching while the local daemon is down', () => {
  it('disables New session and Start a session', async () => {
    localStorage.clear();
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeDisabled();
  });
});
