import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ProbeResult } from '@ledge/fleet';
import type { ClientMessage, Machines } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS, type MockDaemon } from './helpers';
import { SAVE_TIMEOUT_MS } from '../src/settings/useMachineEditor';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); cleanup(); await closeDaemons(); });

const THREE: Machines = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }, { id: 'nas', label: 'NAS', ssh: 'nas' }];
const saved = () => savedNotices(log);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const names = () => screen.getAllByRole('article').map(a => a.getAttribute('aria-label'));
const entry = (name: string) => within(screen.getByRole('article', { name }));
const form = () => within(screen.getByRole('form'));
const sets = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'machines.set' }> => m.type === 'machines.set');

async function open(machines?: Machines, before?: (env: Awaited<ReturnType<typeof boot>>) => Promise<void>) {
  const env = await boot({ projects: TWO_PROJECTS, ...(machines ? { machines } : {}) });
  await before?.(env);
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: /^Machines/ }));
  await screen.findByRole('heading', { level: 2, name: 'Your machines' });
  return env;
}
async function fill(user: Awaited<ReturnType<typeof boot>>['user'], label: string, alias: string) {
  await user.click(screen.getByRole('button', { name: 'Add a machine' }));
  if (label) await user.type(form().getByRole('textbox', { name: 'Machine name' }), label);
  if (alias) await user.type(form().getByRole('textbox', { name: 'SSH alias' }), alias);
}

describe('Settings › Machines', () => {
  it('lists the daemon’s machines, the local one first, « This machine » and without any action', async () => {
    await open(THREE);
    expect(names()).toEqual(['Local', 'Dev SSH', 'NAS']);
    expect(entry('Local').getByText('This machine')).toBeVisible();
    expect(entry('Local').queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('article', { name: 'Local' })).toHaveTextContent('Local · WSL · Unknown version · 3 sessions');
    expect(entry('Local').getByText('Connected')).toBeVisible();
    // The mock's remotes never connect (its snapshot names no SSH alias): offline, so « Reconnect » is there.
    expect(screen.getByRole('article', { name: 'NAS' })).toHaveTextContent('SSH · nas · Unknown version · 0 sessions');
    expect(entry('NAS').getByText('Offline')).toBeVisible();
    expect(entry('NAS').getAllByRole('button').map(b => b.textContent)).toEqual(['Reconnect', 'Test', 'Edit', 'Remove']);
    expect(screen.getByText('3 machines · 20 at most')).toBeVisible();
    expect(saved()).toEqual([]);
  });

  it('« Reconnect » asks the fleet to reconnect that machine now', async () => {
    const { client, user } = await open(THREE);
    const retry = vi.spyOn(client.fleet!, 'retry');
    await user.click(entry('NAS').getByRole('button', { name: 'Reconnect' }));
    expect(retry).toHaveBeenCalledWith('nas');
  });

  it('adds « nas »: machines.set is sent, and « Setting saved » comes only once the daemon’s list comes back', async () => {
    const { d, user } = await open();
    await fill(user, 'Nas', 'nas');
    expect(form().getByRole('button', { name: 'Before adding a server' })).toHaveAttribute('aria-expanded', 'true');
    expect(form().getAllByRole('listitem')).toHaveLength(4);
    await user.click(form().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sets(d)).toHaveLength(1));
    const sent = sets(d)[0]!.machines;
    expect(sent).toEqual([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }, { id: expect.stringMatching(/^remote-[a-z0-9]+$/), label: 'Nas', ssh: 'nas' }]);
    // Nothing optimistic: the list, the form and the notices wait for the daemon.
    expect(form().getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(names()).toEqual(['Local', 'Dev SSH']);
    expect(saved()).toEqual([]);
    act(() => d.machines(sent));
    expect(await screen.findByRole('article', { name: 'Nas' })).toHaveTextContent('SSH · nas');
    expect(names()).toEqual(['Local', 'Dev SSH', 'Nas']);
    expect(screen.queryByRole('form')).toBeNull();
    expect(saved()).toEqual(['Setting saved · Nas added']);
  });

  it('an alias already in the list: « already added », and nothing is sent', async () => {
    const { client, user } = await open();
    const configure = vi.spyOn(client.fleet!, 'configure');
    await fill(user, 'Other', 'dev');
    expect(form().getByRole('alert')).toHaveTextContent('This alias is already added.');
    expect(form().getByRole('textbox', { name: 'SSH alias' })).toHaveAttribute('aria-invalid', 'true');
    expect(form().getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(form().getByRole('textbox', { name: 'Machine name' }), '{Enter}');   // the form's own submit
    expect(form().getByRole('alert')).toHaveTextContent('This alias is already added.');
    expect(configure).not.toHaveBeenCalled();
    expect(saved()).toEqual([]);
  });

  it('a disabled Save says why: a name and an alias are missing, until both are there', async () => {
    const { client, user } = await open();
    const configure = vi.spyOn(client.fleet!, 'configure');
    await user.click(screen.getByRole('button', { name: 'Add a machine' }));
    const why = 'Check the name and SSH alias: letters, digits, dot, dash or underscore, no spaces.';
    expect(form().getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(form().getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(why);
    expect(form().getByText(why)).toBeVisible();
    await user.type(form().getByRole('textbox', { name: 'SSH alias' }), 'nas');
    expect(form().getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(why);   // still no name
    await user.type(form().getByRole('textbox', { name: 'Machine name' }), 'Nas');
    expect(form().getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(form().queryByText(why)).toBeNull();
    expect(form().getByRole('button', { name: 'Save' })).not.toHaveAccessibleDescription(why);
    // A malformed alias says so beside its field, once: not again beside Save.
    await user.type(form().getByRole('textbox', { name: 'SSH alias' }), ' x');
    expect(form().getByRole('alert')).toHaveTextContent('Letters, digits, dot, dash or underscore, no spaces.');
    expect(form().queryByText(why)).toBeNull();
    expect(configure).not.toHaveBeenCalled();
    expect(saved()).toEqual([]);
  });

  it('edits a machine in place, keeping its id and its own alias', async () => {
    const { d, user } = await open();
    await user.click(entry('Dev SSH').getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Edit Dev SSH' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Dev SSH' })).toBeNull();
    await user.clear(form().getByRole('textbox', { name: 'Machine name' }));
    await user.type(form().getByRole('textbox', { name: 'Machine name' }), 'Dev box');
    await user.click(form().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sets(d)).toHaveLength(1));
    expect(sets(d)[0]!.machines).toEqual([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev box', ssh: 'dev' }]);
    act(() => d.machines(sets(d)[0]!.machines));
    expect(await screen.findByRole('article', { name: 'Dev box' })).toBeVisible();
    expect(saved()).toEqual(['Setting saved · Dev box edited']);
  });

  it('the local daemon offline: the page opens with the offline message, and a save says offline with the list unchanged (Review Focus 2)', async () => {
    const { user } = await open(undefined, async ({ d, client }) => {
      await d.close();
      await waitFor(() => expect(client.fleet!.machines().find(m => m.id === 'local')?.ready).toBe(false));
    });
    expect(await screen.findByText('The local daemon is offline.')).toBeVisible();
    expect(names()).toEqual(['Local', 'Dev SSH']);
    await fill(user, 'Nas', 'nas');
    await user.click(form().getByRole('button', { name: 'Save' }));
    expect(await form().findByRole('alert')).toHaveTextContent('The local daemon is not connected: try again in a moment.');
    expect(form().getByRole('textbox', { name: 'Machine name' })).toHaveValue('Nas');
    expect(form().getByRole('textbox', { name: 'SSH alias' })).toHaveValue('nas');
    expect(form().getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(names()).toEqual(['Local', 'Dev SSH']);
    expect(saved()).toEqual([]);
  });

  it('a test run on « nas » shows its result under « nas » only (Review Focus 2)', async () => {
    const { client, user } = await open(THREE);
    const answers: ((r: ProbeResult) => void)[] = [];
    const probe = vi.spyOn(client.fleet!, 'probe').mockImplementation(() => new Promise<ProbeResult>(r => { answers.push(r); }));
    await user.click(entry('NAS').getByRole('button', { name: 'Test' }));
    expect(probe).toHaveBeenCalledWith('nas');
    expect(entry('NAS').getByRole('status')).toHaveTextContent('Connecting to nas…');
    expect(entry('Dev SSH').queryByRole('status')).toBeNull();
    expect(entry('Dev SSH').getByRole('button', { name: 'Test' })).toBeDisabled();   // one test at a time
    await act(async () => answers[0]!({ ok: true, version: '0.5.4', sessions: 2 }));
    expect(entry('NAS').getByRole('status')).toHaveTextContent('Ledge 0.5.4 answers · 2 sessions');
    expect(entry('Dev SSH').queryByRole('status')).toBeNull();
    // Testing Dev SSH next: its result shows under it, and NAS's goes.
    await user.click(entry('Dev SSH').getByRole('button', { name: 'Test' }));
    await act(async () => answers[1]!({ ok: false, error: 'ssh: Could not resolve hostname dev: Name or service not known' }));
    expect(entry('Dev SSH').getByRole('status')).toHaveTextContent('Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.');
    expect(entry('NAS').queryByRole('status')).toBeNull();
    expect(saved()).toEqual([]);
  });

  it('« Remove », then confirm: the list without « NAS » once the daemon’s list comes back', async () => {
    const { d, user } = await open(THREE);
    await user.click(entry('NAS').getByRole('button', { name: 'Remove' }));
    const confirm = within(entry('NAS').getByRole('alert'));
    expect(entry('NAS').getByRole('alert')).toHaveTextContent('Remove NAS? Its sessions leave the list, in the island as here. Nothing is stopped or deleted on the server.');
    await user.click(confirm.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(sets(d)).toHaveLength(1));
    expect(sets(d)[0]!.machines).toEqual(THREE.slice(0, 2));
    expect(names()).toEqual(['Local', 'Dev SSH', 'NAS']);
    expect(saved()).toEqual([]);
    act(() => d.machines(sets(d)[0]!.machines));
    await waitFor(() => expect(names()).toEqual(['Local', 'Dev SSH']));
    expect(saved()).toEqual(['Setting saved · NAS removed']);
  });

  it('a save the daemon never confirms times out: the values stay in the form, the list is unchanged, nothing is said saved', async () => {
    const { d, user } = await open();
    await fill(user, 'Nas', 'nas');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(form().getByRole('button', { name: 'Save' }));
    expect(form().getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(SAVE_TIMEOUT_MS); });
    vi.useRealTimers();
    expect(form().getByRole('alert')).toHaveTextContent('The local daemon did not answer. Nothing changed.');
    expect(form().getByRole('textbox', { name: 'Machine name' })).toHaveValue('Nas');
    expect(form().getByRole('textbox', { name: 'SSH alias' })).toHaveValue('nas');
    expect(form().getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(names()).toEqual(['Local', 'Dev SSH']);
    await waitFor(() => expect(sets(d)).toHaveLength(1));
    expect(saved()).toEqual([]);
  });

  it('an errored machine: « Reconnect » asks the fleet again, and the entry says « Connecting… » until its answer, not « Offline »', async () => {
    const { client } = await open(THREE);
    await waitFor(() => expect(client.fleet!.machines().find(m => m.id === 'nas')?.error).toBeTruthy());
    expect(entry('NAS').getByText('Offline')).toBeVisible();
    const retry = vi.spyOn(client.fleet!, 'retry');
    fireEvent.click(entry('NAS').getByRole('button', { name: 'Reconnect' }));
    expect(retry).toHaveBeenCalledWith('nas');
    expect(entry('NAS').getByText('Connecting…')).toBeVisible();
    expect(entry('NAS').queryByText('Offline')).toBeNull();
    expect(entry('NAS').queryByRole('button', { name: 'Reconnect' })).toBeNull();
    // The mock's answer (a snapshot naming no SSH alias) is an error again: offline once it comes.
    await waitFor(() => expect(entry('NAS').getByText('Offline')).toBeVisible());
    expect(saved()).toEqual([]);
  });

  it('« Cancel » in the confirmation keeps the machine and sends nothing', async () => {
    const { client, user } = await open(THREE);
    const configure = vi.spyOn(client.fleet!, 'configure');
    await user.click(entry('NAS').getByRole('button', { name: 'Remove' }));
    await user.click(within(entry('NAS').getByRole('alert')).getByRole('button', { name: 'Cancel' }));
    expect(entry('NAS').queryByRole('alert')).toBeNull();
    expect(configure).not.toHaveBeenCalled();
  });
});
