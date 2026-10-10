import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NAMES } from '@ledge/protocol';
import { LaunchView, projectOf, rollName } from '../src/surface/LaunchView';
import { fakeSession } from './mockDaemon';

const recents = [
  { cwd: '/w/api-gateway', project: 'api-gateway', lastAt: '2026-10-10T10:00:00.000Z' },
  { cwd: '/w/harness-assistant', project: 'harness-assistant', lastAt: '2026-10-10T09:00:00.000Z' }
];
const sessions = [fakeSession('a'), fakeSession('b', { name: 'Pim', state: 'exited' })];
const mount = (extra: Partial<React.ComponentProps<typeof LaunchView>> = {}) => {
  const onLaunch = vi.fn(), onBack = vi.fn(), onClose = vi.fn();
  render(<LaunchView visible recents={recents} sessions={sessions} onLaunch={onLaunch} onBack={onBack} onClose={onClose} {...extra} />);
  return { onLaunch, onBack, onClose };
};
beforeEach(() => { localStorage.clear(); });

describe('<LaunchView>', () => {
  it('starts on the most recent folder, Claude Code, a free name, the terminal tab on; Start sends the request', () => {
    const { onLaunch } = mount();
    expect(screen.getByLabelText('Folder')).toHaveValue('/w/api-gateway');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    // Otto is live, Pim has exited: Pim is free again.
    expect(screen.getByLabelText('Companion')).toHaveValue('Pim');
    expect(screen.getByText('Its name titles the terminal tab: Pim · api-gateway.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Open the terminal tab/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Resume the last conversation/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    expect(onLaunch).toHaveBeenCalledWith({ tool: 'claude', cwd: '/w/api-gateway', name: 'Pim', prompt: undefined, continue: false, openTab: true });
  });
  it('a recent folder fills the field and shows who works there; typing a path, a tool, a prompt and the options go in the request', () => {
    const { onLaunch } = mount();
    const recent = screen.getByRole('listitem', { name: 'Choose harness-assistant (/w/harness-assistant)' });
    expect(within(recent).getByText('· Otto works there')).toBeInTheDocument();
    fireEvent.click(recent);
    expect(screen.getByLabelText('Folder')).toHaveValue('/w/harness-assistant');
    expect(recent).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: ' ~/Workspace/new-thing ' } });
    expect(screen.getByText('Its name titles the terminal tab: Pim · new-thing.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    fireEvent.change(screen.getByLabelText('Companion'), { target: { value: ' juno ' } });
    fireEvent.change(screen.getByLabelText(/First instruction/), { target: { value: ' fix the build ' } });
    fireEvent.click(screen.getByRole('switch', { name: /Resume the last conversation/ }));
    fireEvent.click(screen.getByRole('switch', { name: /Open the terminal tab/ }));
    fireEvent.keyDown(screen.getByLabelText(/First instruction/), { key: 'Enter' });
    expect(onLaunch).toHaveBeenCalledWith({ tool: 'codex', cwd: '~/Workspace/new-thing', name: 'juno', prompt: 'fix the build', continue: true, openTab: false });
    // The terminal-tab choice is remembered for the next form.
    expect(localStorage.getItem('ledge.launch.openTab')).toBe('0');
  });
  it('the die gives another free name; an empty name leaves the choice to the daemon', () => {
    const { onLaunch } = mount();
    const name = screen.getByLabelText('Companion');
    const before = (name as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Another name' }));
    const after = (name as HTMLInputElement).value;
    expect(after).not.toBe(before); expect(after).not.toBe('Otto'); expect(NAMES).toContain(after);
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByText(/Its name titles the terminal tab: Pim · /)).toBeInTheDocument(); // the preview shows the daemon's pick
    fireEvent.submit(document.querySelector('[data-launch-form]')!);
    expect(onLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ name: undefined }));
  });
  it('without a folder, offline, or while starting, nothing is sent and the reason shows; a failure is shown in red', () => {
    const { onLaunch } = mount({ recents: [] });
    expect(screen.getByText('The folders of your sessions will show up here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Start/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Give a folder to start in.');
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: '/w/x' } });
    expect(screen.getByRole('button', { name: /^Start/ })).toBeEnabled();
    fireEvent.submit(document.querySelector('[data-launch-form]')!);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });
  it('offline and busy states', () => {
    mount({ offline: 'Offline: reconnecting to the daemon' });
    expect(screen.getByRole('button', { name: /^Start/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Offline: reconnecting to the daemon');
  });
  it('busy shows Starting… and a failure its reason', () => {
    mount({ busy: true, failure: 'no such folder: /w/api-gateway' });
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Could not start: no such folder: /w/api-gateway');
  });
  it('Cancel goes back, the header closes', () => {
    const { onBack, onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(onClose).toHaveBeenCalled();
  });
});

describe('projectOf and rollName', () => {
  it('names the project after the last path segment', () => {
    expect(projectOf('/w/api-gateway')).toBe('api-gateway');
    expect(projectOf('~/Workspace/x/')).toBe('x');
    expect(projectOf('  ')).toBe('');
  });
  it('rolls a free name other than the current one, deterministic under a fixed random', () => {
    expect(rollName(['Otto'], 'Pim', () => 0)).toBe('Nova');
    expect(rollName(NAMES.slice(0, 63), NAMES[63]!, () => 0.5)).toBe('Otto-2');
  });
});
