import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { RigTopology } from '../../src/ide/rig/RigTopology';
import { RIG_7A } from '../../e2e/openrig-fixtures';

afterEach(() => cleanup());
const graph = RIG_7A.rigGraphs['ledge-survey'];
const build = fakeSession('b1', { name: 'Bix', machineId: 'local', rig: { seat: 'dev-build@ledge-survey', name: 'ledge-survey' } });
const ui = (o: Partial<Parameters<typeof RigTopology>[0]> = {}) => (
  <LangProvider lang="fr"><RigTopology graph={graph} status="ready" sessions={[build] as Session[]} machine="local" running dispatch={() => {}} {...o} /></LangProvider>
);

describe('RigTopology', () => {
  it('draws the seats, the typed link with its arrow, and the legend', () => {
    const { container } = render(ui());
    expect(container.querySelectorAll('.ide-rig-node')).toHaveLength(2);
    const paths = container.querySelectorAll('.ide-rig-canvas path.ide-rig-link');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('marker-end')).toMatch(/^url\(#/);
    expect(container.querySelector('marker')).not.toBeNull();
    expect(container.querySelector('.ide-rig-legend')!.textContent).toMatch(/delegates_to.*escalates_to.*collaborates_with/);
    expect(screen.getByText('clic sur un siège : son fil')).toBeTruthy();
  });
  it('opens the thread on click, to the right on Ctrl+click; a seat without session is no button', () => {
    const dispatch = vi.fn();
    render(ui({ dispatch }));
    const btn = screen.getByRole('button', { name: /Bix.*implementer/ });
    fireEvent.click(btn);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'open', id: 'b1' });
    fireEvent.click(btn, { ctrlKey: true });
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'open', id: 'b1', where: 'right' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.querySelector('div.ide-rig-node')!.textContent).toMatch(/dev\.review/);
  });
  it('a stopped rig greys every node', () => {
    const { container } = render(ui({ running: false }));
    expect(container.querySelectorAll('.ide-rig-node.off')).toHaveLength(2);
    expect(screen.getByText('les sièges démarrent avec le rig')).toBeTruthy();
  });
  it('says it is reading, and why it failed', () => {
    render(ui({ graph: null, status: 'loading' }));
    expect(screen.getByText('Lecture…')).toBeTruthy();
    cleanup();
    render(ui({ graph: null, status: 'idle', error: 'offline' }));
    expect(screen.getByText('Cette machine est hors ligne.')).toBeTruthy();
    cleanup();
    render(ui({ graph: null, status: 'idle', error: 'daemon_stopped' }));
    expect(screen.getByText('Le daemon OpenRig est arrêté.')).toBeTruthy();
    expect(screen.queryByText(/daemon_stopped/)).toBeNull();
  });
});
