import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineConfig, MachineState } from '@ledge/fleet';
import { MachinesPanel } from '../src/settings/MachinesPanel';
import { checkDraft, configsOf, newMachineId, withDraft, without } from '../src/settings/machines';
import { machine } from './launch-helpers';
import { fakeMachineFleet, statesOf, type FakeMachineFleet } from './settings-helpers';

const info = { version: '0.5.2', install: 'npm' as const, systemd: true };
const local = machine('local', { daemon: info });
const devbox = machine('devbox', { daemon: info });
const list: MachineConfig[] = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];

function show(ms: MachineState[] = [local, devbox], f: FakeMachineFleet = fakeMachineFleet(), o: { localDown?: boolean; saveTimeoutMs?: number } = {}) {
  const ui = (next: MachineState[]) => <MachinesPanel machines={next} fleet={f} localDown={o.localDown ?? false} saveTimeoutMs={o.saveTimeoutMs} />;
  const view = render(ui(ms));
  return { f, rerender: (next: MachineState[]) => act(() => view.rerender(ui(next))) };
}
const nameBox = () => screen.getByRole('textbox', { name: 'Machine name' });
const aliasBox = () => screen.getByRole('textbox', { name: 'SSH alias' });
async function fill(label: string, alias: string) {
  await userEvent.click(screen.getByRole('button', { name: '＋ Add a machine' }));
  if (label) await userEvent.type(nameBox(), label);
  if (alias) await userEvent.type(aliasBox(), alias);
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('the list rules', () => {
  it('a name of 1 to 80 characters, an SSH alias without spaces, at most once (Review Focus 3)', () => {
    expect(checkDraft(list, { label: 'Nas', ssh: 'nas' }, null)).toBeNull();
    expect(checkDraft(list, { label: '   ', ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'x'.repeat(81), ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'my box' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: '-nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(65) }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(64) }, null)).toBeNull();
    expect(checkDraft(list, { label: 'Other', ssh: 'devbox' }, null)).toBe('duplicate');
    expect(checkDraft(list, { label: 'Devbox 2', ssh: 'devbox' }, 'devbox')).toBeNull();
    const full = [list[0]!, ...Array.from({ length: 19 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, ssh: `m${i}` }))];
    expect(checkDraft(full, { label: 'Nas', ssh: 'nas' }, null)).toBe('full');
    expect(checkDraft(full, { label: 'M0 bis', ssh: 'm0' }, 'm0')).toBeNull();
  });

  it('builds the next list without touching the local machine', () => {
    expect(newMachineId(list, () => 0)).toBe('remote-0');
    expect(newMachineId([...list, { id: 'remote-0', label: 'X', ssh: 'x' }], () => 0)).toBe('remote-0-2');
    expect(withDraft(list, { label: ' Nas ', ssh: ' nas ' }, null, () => 0)).toEqual([...list, { id: 'remote-0', label: 'Nas', ssh: 'nas' }]);
    expect(withDraft(list, { label: 'Dev', ssh: 'dev2' }, 'devbox')).toEqual([list[0], { id: 'devbox', label: 'Dev', ssh: 'dev2' }]);
    expect(without(list, 'devbox')).toEqual([list[0]]);
    expect(without(list, 'local')).toEqual(list);
    expect(configsOf([local, devbox])).toEqual(list);
  });
});

describe('the Machines section', () => {
  it('lists the daemon’s machines, the local one first and without actions', () => {
    show([local, machine('devbox', { daemon: info, status: 'unreachable', ready: false })]);
    const [first, second] = screen.getAllByRole('article');
    expect(first).toHaveAccessibleName('Local');
    expect(first).toHaveTextContent('Local · WSL');
    expect(within(first!).queryAllByRole('button')).toHaveLength(0);
    expect(second).toHaveTextContent('SSH · devbox');
    expect(second).toHaveTextContent('Ledge 0.5.2');
    expect(second).toHaveTextContent('Disconnected');
    expect(within(second!).getAllByRole('button').map(b => b.textContent)).toEqual(['Test', 'Retry', 'Edit', 'Remove']);
  });

  it('adds a machine: machines.set, then the form closes once the daemon’s list comes back', async () => {
    const { f, rerender } = show();
    await fill('Nas', 'nas');
    await save();
    expect(f.configured).toEqual([[...list, { id: expect.stringMatching(/^remote-[a-z0-9]+$/), label: 'Nas', ssh: 'nas' }]]);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(nameBox()).toHaveValue('Nas');
    rerender(statesOf(f.configured[0]!));
    expect(await screen.findByRole('status')).toHaveTextContent('Nas is saved.');
    expect(screen.queryByRole('textbox', { name: 'Machine name' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Nas' })).toBeInTheDocument();
  });

  it.each([['Nas', 'my box', 'Check the name'], ['Nas', '-nas', 'Check the name'], ['   ', 'nas', 'Check the name'], ['Other', 'devbox', 'This alias is already added.']])(
    'refuses « %s » / « %s » before sending anything (Review Focus 3)', async (label, alias, message) => {
      const { f } = show();
      await fill(label, alias);
      await save();
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(f.configured).toEqual([]);
    });

  it('edits a machine and keeps its own alias', async () => {
    const { f } = show();
    await userEvent.click(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Devbox' })).toBeInTheDocument();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), 'Dev server');
    await save();
    expect(f.configured).toEqual([[list[0], { id: 'devbox', label: 'Dev server', ssh: 'devbox' }]]);
  });

  describe('a save that cannot finish (Review Focus 2)', () => {
    it('a double click sends one machines.set', async () => {
      const { f } = show();
      await fill('Nas', 'nas');
      await userEvent.dblClick(screen.getByRole('button', { name: 'Save' }));
      expect(f.configured).toHaveLength(1);
    });

    it('the local daemon closed: a message, the values kept, nothing sent', async () => {
      const f = fakeMachineFleet(); f.state.down = true;
      show(undefined, f);
      await fill('Nas', 'nas');
      await save();
      expect(screen.getByRole('alert')).toHaveTextContent('The local daemon is not connected: try again in a moment.');
      expect(nameBox()).toHaveValue('Nas');
      expect(aliasBox()).toHaveValue('nas');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('an error of the local daemon refuses the list; an error answering something else does not', async () => {
      const { f } = show();
      await fill('Nas', 'nas');
      await save();
      act(() => f.emit('local', { type: 'error', message: 'Unknown session', id: 'q1' }));
      act(() => f.emit('devbox', { type: 'error', message: 'Busy' }));
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      act(() => f.emit('local', { type: 'error', message: 'Invalid machines' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The local daemon refused this list. Nothing changed.');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('a silent daemon: the save gives up and says so', async () => {
      show(undefined, undefined, { saveTimeoutMs: 30 });
      await fill('Nas', 'nas');
      await save();
      expect(await screen.findByRole('alert')).toHaveTextContent('The local daemon did not answer. Nothing changed.');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('removes a machine after a confirmation', async () => {
    const { f, rerender } = show();
    const card = screen.getByRole('article', { name: 'Devbox' });
    await userEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    const confirm = within(card).getByRole('alert');
    expect(confirm).toHaveTextContent('Remove Devbox? Its sessions will leave the view; the work on the server goes on.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(f.configured).toEqual([[list[0]]]);
    rerender([local]);
    expect(await screen.findByRole('status')).toHaveTextContent('Devbox was removed from the list.');
  });

  it('tests a machine and the draft, one at a time, and explains a failure', async () => {
    const { f } = show();
    await userEvent.click(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Test' }));
    expect(f.probes.map(p => p.ssh)).toEqual(['devbox']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to devbox…');
    expect(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Test' })).toBeDisabled();
    await act(async () => f.probes[0]!.answer({ ok: false, error: 'ssh: Could not resolve hostname devbox' }));
    expect(screen.getByRole('status')).toHaveTextContent('Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.');
    await fill('Nas', 'nas');
    await userEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    await act(async () => f.probes[1]!.answer({ ok: true, version: '0.5.2', sessions: 2 }));
    expect(screen.getByRole('status')).toHaveTextContent('Ledge 0.5.2 answers · 2 sessions');
    expect(f.configured).toEqual([]);
  });

  it('reconnects a disconnected machine now', async () => {
    const { f } = show([local, machine('devbox', { status: 'unreachable', ready: false })]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(f.retried).toEqual(['devbox']);
  });

  it('is read-only while the local daemon is unreachable', () => {
    show(undefined, undefined, { localDown: true });
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
