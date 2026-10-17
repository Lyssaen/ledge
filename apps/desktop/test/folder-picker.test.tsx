import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { FolderPicker } from '../src/projects/FolderPicker';
import { machine } from './fleet-helpers';
import { declarations } from './helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MockDaemon = Awaited<ReturnType<typeof createMockDaemon>>;
const opened: { d: MockDaemon; client: DaemonClient }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const { d, client } of opened.splice(0)) { client.close(); await d.close(); }
});

/** The fleet on a mock daemon: Local (home /home/me: the Git repository ledge on main, the plain folder notes) and NAS, which never connects. */
async function setup(opts: { taken?: (m: string, p: string) => boolean } = {}) {
  const d = await createMockDaemon();
  d.options.home = '/home/me';
  d.machines([{ id: 'local', label: 'Local' }, { id: 'nas', label: 'NAS', ssh: 'nas' }]);
  d.folders.set('/home/me', { entries: ['ledge', 'notes'], repos: [{ name: 'ledge', branch: 'main' }] });
  d.folders.set('/home/me/notes', { entries: ['drafts'] });
  d.repoInfo.set('/srv/gone', { path: '/srv/gone', exists: false, branch: null });
  d.repoInfo.set('/srv/app', { path: '/srv/app', exists: true, branch: 'develop' });
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  opened.push({ d, client });
  client.connect();
  await waitFor(() => {
    const ms = client.fleet!.machines();
    expect(ms.find(m => m.id === 'local')?.ready).toBe(true);
    expect(ms.find(m => m.id === 'nas')).toBeDefined();
  });
  const onAdd = vi.fn();
  const taken = vi.fn(opts.taken ?? (() => false));
  render(<FolderPicker client={client} machines={client.fleet!.machines()} taken={taken} onAdd={onAdd} />);
  const list = await screen.findByRole('list', { name: 'Contents of /home/me on Local' });
  return { d, client, onAdd, taken, user: userEvent.setup(), list: within(list) };
}
const rowOf = (el: HTMLElement) => el.closest('li')!;
const typedField = (m: string) => screen.getByRole('textbox', { name: `Path on ${m}` });
const inspections = (d: MockDaemon) => d.received.filter(m => m.type === 'repos.inspect');

describe('FolderPicker', () => {
  it('opens on the home the machine resolves; a Git repository shows its branch, a plain folder « no Git »', async () => {
    const { d, list } = await setup();
    // The first listing asks for no path: the daemon answers with the home, resolved.
    expect(d.received.find(m => m.type === 'folder.list')).toMatchObject({ type: 'folder.list' });
    expect((d.received.find(m => m.type === 'folder.list') as Extract<ClientMessage, { type: 'folder.list' }>).path).toBeUndefined();
    expect(screen.getByRole('radiogroup', { name: 'Machine to browse' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Local' })).toBeChecked();
    const crumbs = within(screen.getByRole('navigation', { name: 'Current folder' }));
    expect(crumbs.getAllByRole('button').map(b => b.textContent)).toEqual(['root', 'home', 'me']);
    expect(crumbs.getByRole('button', { name: 'me' })).toHaveAttribute('aria-current', 'location');
    const ledge = rowOf(list.getByRole('button', { name: 'ledge' }));
    expect(ledge).toHaveClass('is-git');
    expect(ledge.querySelector('.picker-branch')!.textContent).toBe('⎇ main');
    expect(within(ledge).getByRole('button', { name: 'Add ledge (Local)' })).toHaveAttribute('data-variant', 'outline');
    const notes = rowOf(list.getByRole('button', { name: 'notes' }));
    expect(notes).not.toHaveClass('is-git');
    expect(notes.querySelector('.picker-branch')!.textContent).toBe('no Git');
    expect(within(notes).getByRole('button', { name: 'Add notes (Local)' })).toHaveAttribute('data-variant', 'ghost');
  });

  it('a folder opens by its name, and « Parent folder » comes back', async () => {
    const { d, user, list } = await setup();
    await user.click(list.getByRole('button', { name: 'notes' }));
    const inside = within(await screen.findByRole('list', { name: 'Contents of /home/me/notes on Local' }));
    expect(d.received.filter(m => m.type === 'folder.list').at(-1)).toMatchObject({ path: '/home/me/notes' });
    expect(await inside.findByRole('button', { name: 'drafts' })).toBeVisible();
    expect(within(screen.getByRole('navigation', { name: 'Current folder' })).getByRole('button', { name: 'notes' })).toHaveAttribute('aria-current', 'location');
    await user.click(inside.getByRole('button', { name: 'Parent folder' }));
    const back = within(await screen.findByRole('list', { name: 'Contents of /home/me on Local' }));
    expect(await back.findByRole('button', { name: 'ledge' })).toBeVisible();
    expect(d.received.filter(m => m.type === 'folder.list').at(-1)).toMatchObject({ path: '/home/me' });
  });

  it('« Add » gives the machine, the absolute path and the branch (null without Git)', async () => {
    const { onAdd, user, list } = await setup();
    await user.click(list.getByRole('button', { name: 'Add ledge (Local)' }));
    expect(onAdd).toHaveBeenLastCalledWith({ machine: 'local', path: '/home/me/ledge', branch: 'main' });
    await user.click(list.getByRole('button', { name: 'Add notes (Local)' }));
    expect(onAdd).toHaveBeenLastCalledWith({ machine: 'local', path: '/home/me/notes', branch: null });
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('a repository already in the list shows « Added », disabled', async () => {
    const { onAdd, taken, user, list } = await setup({ taken: (m, p) => m === 'local' && p === '/home/me/ledge' });
    const added = list.getByRole('button', { name: 'ledge already added' });
    expect(added).toBeDisabled();
    expect(added).toHaveTextContent('Added');
    expect(taken).toHaveBeenCalledWith('local', '/home/me/ledge');
    await user.click(added);
    expect(onAdd).not.toHaveBeenCalled();
    expect(list.getByRole('button', { name: 'Add notes (Local)' })).toBeEnabled();
  });

  it('an offline machine says so; a path typed on it is not checked, nothing is added and the text stays', async () => {
    const { d, onAdd, user } = await setup();
    const nas = screen.getByRole('radio', { name: /^NAS/ });
    expect(nas.closest('label')).toHaveTextContent('offline');
    expect(nas.closest('label')!.querySelector('.machine-dot.off')).not.toBeNull();
    await user.click(nas);
    expect(document.querySelector('p.picker-offline')!.textContent).toBe('NAS is offline. Reconnect it in Settings › Machines to browse its folders.');
    expect(screen.queryByRole('list')).toBeNull();
    const asked = d.received.length;
    await user.type(typedField('NAS'), '/srv/x{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('NAS is offline: this path cannot be checked.');
    expect(typedField('NAS')).toHaveValue('/srv/x');
    expect(typedField('NAS')).toHaveAttribute('aria-invalid', 'true');
    expect(d.received.slice(asked).filter(m => m.type === 'repos.inspect' || m.type === 'folder.list')).toEqual([]);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a path not found on the machine is said, nothing is added and the text stays', async () => {
    const { d, onAdd, user } = await setup();
    await user.type(typedField('Local'), '/srv/gone');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder not found on Local.');
    expect(inspections(d)).toEqual([expect.objectContaining({ paths: ['/srv/gone'] })]);
    expect(typedField('Local')).toHaveValue('/srv/gone');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a path already in the list (once normalized) is refused before any check, the text stays', async () => {
    const { d, onAdd, taken, user } = await setup({ taken: (m, p) => m === 'local' && p === '/home/me/ledge' });
    await user.type(typedField('Local'), '  /home/me//ledge/ {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('This repository is already in the list.');
    expect(taken).toHaveBeenCalledWith('local', '/home/me/ledge');
    expect(typedField('Local')).toHaveValue('  /home/me//ledge/ ');
    expect(inspections(d)).toEqual([]);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a path starting with ~ (or any relative one) asks for a full path, the text stays', async () => {
    const { d, onAdd, user } = await setup();
    await user.type(typedField('Local'), '~/x{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Type a full path, starting with /.');
    expect(typedField('Local')).toHaveValue('~/x');
    await user.clear(typedField('Local'));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(typedField('Local'), 'w/x{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Type a full path, starting with /.');
    expect(inspections(d)).toEqual([]);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a typed path found on the machine is added normalized, with the branch the check returned, and the field empties', async () => {
    const { d, onAdd, user } = await setup();
    await user.type(typedField('Local'), '/srv//app/{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ machine: 'local', path: '/srv/app', branch: 'develop' }));
    expect(inspections(d)).toEqual([expect.objectContaining({ paths: ['/srv/app'] })]);
    expect(typedField('Local')).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switching machine starts again from that machine\'s home', async () => {
    const { d, user, list } = await setup();
    await user.click(list.getByRole('button', { name: 'notes' }));
    await screen.findByRole('button', { name: 'drafts' });
    await user.click(screen.getByRole('radio', { name: /^NAS/ }));
    const asked = d.received.length;
    await user.click(screen.getByRole('radio', { name: 'Local' }));
    const back = within(await screen.findByRole('list', { name: 'Contents of /home/me on Local' }));
    expect(await back.findByRole('button', { name: 'ledge' })).toBeVisible();
    const again = d.received.slice(asked).filter((m): m is Extract<ClientMessage, { type: 'folder.list' }> => m.type === 'folder.list');
    expect(again).toHaveLength(1);
    expect(again[0]!.path).toBeUndefined();
  });

  it('the machine chips show keyboard focus (the chip rule of launch.css, loaded with the app)', () => {
    expect(declarations('launch.css', '.chip:has(input:focus-visible)')).toContain('outline:2pxsolidvar(--ring)');
    expect(readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8')).toContain('@import "./launch.css";');
  });
});

describe('useFolderListing through FolderPicker', () => {
  /** A client that records its sends and plays daemon messages. */
  function fakeClient() {
    const sent: ClientMessage[] = [];
    const fns = new Set<(m: ServerMessage) => void>();
    const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } } as unknown as DaemonClient;
    return { client, sent, emit: (m: ServerMessage) => act(() => { fns.forEach(fn => fn(m)); }) };
  }
  const lists = (sent: ClientMessage[]) => sent.filter((m): m is Extract<ClientMessage, { type: 'folder.list' }> => m.type === 'folder.list');
  const local: MachineState = machine('local');

  it('one requestId per listing: another request\'s answer is ignored, and a folder that never answers says so after 10 s', () => {
    vi.useFakeTimers();
    const { client, sent, emit } = fakeClient();
    render(<FolderPicker client={client} machines={[local]} taken={() => false} onAdd={vi.fn()} />);
    expect(lists(sent)).toHaveLength(1);
    const first = lists(sent)[0]!;
    expect(first).toMatchObject({ machineId: 'local' });
    expect(first.requestId).toBeTruthy();
    expect(first.path).toBeUndefined();
    emit({ type: 'folder.listing', requestId: 'someone-else', path: '/elsewhere', parent: '/', entries: ['wrong'] });
    expect(screen.queryByRole('button', { name: 'wrong' })).toBeNull();
    emit({ type: 'folder.listing', requestId: first.requestId!, path: '/home/me', parent: '/home', entries: ['a'] });
    expect(screen.getByRole('list', { name: 'Contents of /home/me on Local' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    const second = lists(sent)[1]!;
    expect(second).toMatchObject({ path: '/home/me/a', machineId: 'local' });
    expect(second.requestId).not.toBe(first.requestId);
    // The first answer played again does not bring the home back.
    emit({ type: 'folder.listing', requestId: first.requestId!, path: '/home/me', parent: '/home', entries: ['a'] });
    expect(screen.queryByRole('list', { name: 'Contents of /home/me on Local' })).toBeNull();
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(screen.queryByText('The folder did not answer.')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('The folder did not answer.')).toBeVisible();
    // A late answer to the timed-out request changes nothing.
    emit({ type: 'folder.listing', requestId: second.requestId!, path: '/home/me/a', parent: '/home/me', entries: ['late'] });
    expect(screen.queryByRole('button', { name: 'late' })).toBeNull();
    // The crumbs still lead back up.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Current folder' })).getByRole('button', { name: 'me' }));
    expect(lists(sent).at(-1)).toMatchObject({ path: '/home/me' });
  });

  it('a typed path whose check never answers says so after 10 s; nothing is added and the text stays', () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient();
    const onAdd = vi.fn();
    render(<FolderPicker client={client} machines={[local]} taken={() => false} onAdd={onAdd} />);
    fireEvent.change(typedField('Local'), { target: { value: '/srv/slow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(sent.filter(m => m.type === 'repos.inspect')).toEqual([expect.objectContaining({ paths: ['/srv/slow'], machineId: 'local' })]);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('The folder did not answer.');
    expect(typedField('Local')).toHaveValue('/srv/slow');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a listing that failed is asked again by « Try again », and by its current crumb', () => {
    const { client, sent, emit } = fakeClient();
    render(<FolderPicker client={client} machines={[local]} taken={() => false} onAdd={vi.fn()} />);
    emit({ type: 'folder.listing', requestId: lists(sent)[0]!.requestId!, path: '~', parent: null, entries: [], error: 'busy' });
    expect(screen.getByText(/^busy/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(lists(sent)).toHaveLength(2);
    expect(lists(sent)[1]!.path).toBeUndefined();
    expect(lists(sent)[1]!.requestId).not.toBe(lists(sent)[0]!.requestId);
    emit({ type: 'folder.listing', requestId: lists(sent)[1]!.requestId!, path: '/home/me', parent: '/home', entries: ['a'] });
    expect(screen.getByRole('list', { name: 'Contents of /home/me on Local' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    emit({ type: 'folder.listing', requestId: lists(sent)[2]!.requestId!, path: '/home/me/a', parent: null, entries: [], error: 'permission denied' });
    expect(screen.getByText(/^permission denied/)).toBeVisible();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Current folder' })).getByRole('button', { name: 'a' }));
    expect(lists(sent)).toHaveLength(4);
    expect(lists(sent)[3]).toMatchObject({ path: '/home/me/a' });
    emit({ type: 'folder.listing', requestId: lists(sent)[3]!.requestId!, path: '/home/me/a', parent: '/home/me', entries: ['b'] });
    expect(screen.getByRole('button', { name: 'b' })).toBeVisible();
  });

  it('a machine dropping during a typed check says it is offline, not that the path is missing; nothing is added', () => {
    const { client, sent, emit } = fakeClient();
    const onAdd = vi.fn();
    const view = render(<FolderPicker client={client} machines={[local]} taken={() => false} onAdd={onAdd} />);
    fireEvent.change(typedField('Local'), { target: { value: '/srv/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const ask = sent.find((m): m is Extract<ClientMessage, { type: 'repos.inspect' }> => m.type === 'repos.inspect')!;
    view.rerender(<FolderPicker client={client} machines={[{ ...local, status: 'unreachable', ready: false }]} taken={() => false} onAdd={onAdd} />);
    // The fleet answers a dropped machine's inspection « not found » for every path.
    emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/srv/x', exists: false, branch: null }] });
    expect(screen.getByRole('alert')).toHaveTextContent('Local is offline: this path cannot be checked.');
    expect(typedField('Local')).toHaveValue('/srv/x');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a typed check answered after the same repository was added from the list says « already listed »: added once', () => {
    const { client, sent, emit } = fakeClient();
    const onAdd = vi.fn();
    function Host() {
      const [repos, setRepos] = useState<string[]>([]);
      return <FolderPicker client={client} machines={[local]} taken={(m, p) => m === 'local' && repos.includes(p)} onAdd={r => { onAdd(r); setRepos(x => [...x, r.path]); }} />;
    }
    render(<Host />);
    emit({ type: 'folder.listing', requestId: lists(sent)[0]!.requestId!, path: '/home/me', parent: '/home', entries: ['ledge'], repos: [{ name: 'ledge', branch: 'main' }] });
    fireEvent.change(typedField('Local'), { target: { value: '/home/me/ledge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const ask = sent.find((m): m is Extract<ClientMessage, { type: 'repos.inspect' }> => m.type === 'repos.inspect')!;
    fireEvent.click(screen.getByRole('button', { name: 'Add ledge (Local)' }));
    emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/home/me/ledge', exists: true, branch: 'main' }] });
    expect(screen.getByRole('alert')).toHaveTextContent('This repository is already in the list.');
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ machine: 'local', path: '/home/me/ledge', branch: 'main' });
    expect(screen.getByRole('button', { name: 'ledge already added' })).toBeDisabled();
  });
});
