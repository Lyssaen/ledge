import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MachineSettings } from '../src/surface/MachineSettings';
import { LOCAL_MACHINE, parseMachines, type MachineConfig, type MachineState, type ProbeResult } from '../src/daemon/machines';
import { LangProvider } from '../src/i18n/lang';

const state = (m: MachineConfig, extra: Partial<MachineState> = {}): MachineState => ({ ...m, status: 'connecting', ready: false, recents: [], sessions: [], launcher: null, ...extra });
const LOCAL = state(LOCAL_MACHINE, { status: 'open', ready: true, version: '0.4.0' });
const AGENTS = state({ id: 'remote-a', label: 'Agents', ssh: 'dev-server' }, { status: 'open', ready: true, version: '0.4.0' });

function Harness({ initial = [LOCAL], onProbe, onRetry, onChange }: { initial?: MachineState[]; onProbe?: (ssh: string) => Promise<ProbeResult>; onRetry?: (id: string) => void; onChange?: (c: MachineConfig[]) => void }) {
  const [machines, setMachines] = useState<MachineState[]>(initial);
  return <LangProvider lang="en"><MachineSettings machines={machines} onProbe={onProbe} onRetry={onRetry} onChange={next => { onChange?.(next); setMachines(parseMachines(next).map(m => machines.find(x => x.id === m.id && x.ssh === m.ssh) ? { ...machines.find(x => x.id === m.id)!, label: m.label } : state(m))); }} /></LangProvider>;
}
const fill = (name: string, alias: string) => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('SSH alias'), { target: { value: alias } });
};

describe('Machines settings', () => {
  it('adds arbitrary SSH aliases independently, without requiring tunnels or prefilled names', () => {
    render(<Harness />);
    expect(screen.getByText('No servers yet. Your local sessions do not change.')).toBeInTheDocument();
    for (const [name, alias] of [['Build server', 'build-box'], ['Test server', 'test-box']]) {
      fireEvent.click(screen.getByRole('button', { name: 'Add a machine' }));
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('SSH alias')).toHaveValue('');
      fill(name!, alias!);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText(name!)).toBeInTheDocument();
      expect(screen.getByText(`SSH · ${alias}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(screen.getByText('Local · WSL · Ledge 0.4.0 · 0 sessions')).toBeInTheDocument();
  });

  it('refuses an alias that is already added and an invalid one', () => {
    render(<Harness initial={[LOCAL, AGENTS]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a machine' }));
    fill('Again', 'dev-server');
    expect(screen.getByRole('alert')).toHaveTextContent('This alias is already added.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fill('Again', 'bad alias');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits the name and alias in place, keeping the machine id', () => {
    const onChange = vi.fn();
    render(<Harness initial={[LOCAL, AGENTS]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Agents');
    fill('Agents 2', 'agents-2');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'local', label: 'Local', url: LOCAL_MACHINE.url }, { id: 'remote-a', label: 'Agents 2', ssh: 'agents-2' }]);
    expect(screen.getByText('Agents 2')).toBeInTheDocument();
  });

  it('removes a server only after confirmation; this machine cannot be removed', () => {
    const onChange = vi.fn();
    render(<Harness initial={[LOCAL, AGENTS]} onChange={onChange} />);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = screen.getByRole('alert');
    expect(ask).toHaveTextContent('Remove Agents ? Its sessions leave the list. Nothing is stopped or deleted on the server.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith([{ id: 'local', label: 'Local', url: LOCAL_MACHINE.url }]);
    expect(screen.queryByText('Agents')).not.toBeInTheDocument();
  });

  it('tests an alias before saving: success, then a failure explained in plain words', async () => {
    let answer!: (r: ProbeResult) => void;
    const onProbe = vi.fn(() => new Promise<ProbeResult>(r => { answer = r; }));
    render(<Harness onProbe={onProbe} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a machine' }));
    fill('Agents', 'dev-server');
    fireEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    expect(onProbe).toHaveBeenCalledWith('dev-server');
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to dev-server…');
    expect(screen.getByRole('button', { name: 'Test the connection' })).toBeDisabled();
    await act(async () => answer({ ok: true, version: '0.4.0', sessions: 12 }));
    expect(screen.getByRole('status')).toHaveTextContent('Ledge 0.4.0 answers · 12 sessions');
    fill('Agents', 'unknown-box');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    await act(async () => answer({ ok: false, error: 'SSH connection closed (255). ssh: Could not resolve hostname unknown-box: Name or service not known' }));
    expect(screen.getByRole('status')).toHaveTextContent('Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.');
    expect(screen.getByRole('status')).toHaveTextContent('Could not resolve hostname unknown-box');
    // The test is optional: an unreachable machine can still be saved.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('SSH · unknown-box')).toBeInTheDocument();
  });

  it('drops a test answer that arrives after the alias changed', async () => {
    let answer!: (r: ProbeResult) => void;
    render(<Harness onProbe={() => new Promise<ProbeResult>(r => { answer = r; })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a machine' }));
    fill('Agents', 'dev-server');
    fireEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    fill('Agents', 'other-box');
    await act(async () => answer({ ok: true, version: '0.4.0', sessions: 12 }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an offline server with its translated error, and a successful retry reconnects it now', async () => {
    const onRetry = vi.fn();
    const offline = state({ id: 'remote-b', label: 'Build box', ssh: 'build-box' }, { status: 'unreachable', error: 'SSH connection closed (255). ssh: connect to host build-box port 22: Connection timed out' });
    render(<Harness initial={[LOCAL, offline]} onRetry={onRetry} onProbe={async () => ({ ok: true, version: '0.4.0', sessions: 2 })} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The server does not answer. It may be off, or out of the network.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    expect(onRetry).toHaveBeenCalledWith('remote-b');
    expect(screen.getByRole('status')).toHaveTextContent('Ledge 0.4.0 answers · 2 sessions');
  });
});
