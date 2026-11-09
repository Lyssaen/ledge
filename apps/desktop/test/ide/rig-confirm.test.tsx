import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { OpenRigState, Rig, RigSeat } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { RigConfirm } from '../../src/ide/rigs/RigConfirm';

afterEach(() => cleanup());

const seat = (logicalId: string, rig: string, working: boolean): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: working ? 'running' : 'idle', stopped: false, work: 0 });
const rig: Rig = { id: 'ledge-dev', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: null, snapshot: null, nodes: [seat('dev.build', 'ledge-dev', true), seat('dev.review', 'ledge-dev', false)] };
const state: OpenRigState = { installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z', rigs: [rig] };

function box(over: Partial<Parameters<typeof RigConfirm>[0]> = {}) {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<LangProvider lang="fr"><RigConfirm action={{ kind: 'rig.stop', rig: 'ledge-dev' }} state={state} sessions={[]} machine="local" label="Laptop" onConfirm={onConfirm} onCancel={onCancel} {...over} /></LangProvider>);
  return { onConfirm, onCancel };
}

describe('RigConfirm', () => {
  it('names the rig and the command, and focuses Cancel', () => {
    box();
    expect(screen.getByRole('group').getAttribute('aria-label')).toContain('ledge-dev');
    expect(screen.getByText('rig down ledge-dev')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  });
  it('keeps Escape local: it cancels and does not reach window', () => {
    const { onCancel } = box();
    const seen = vi.fn(); window.addEventListener('keydown', seen);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Annuler' }), { key: 'Escape' });
    window.removeEventListener('keydown', seen);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(seen).not.toHaveBeenCalled();
  });
  it('confirms the stop', () => {
    const { onConfirm } = box();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’arrêt' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
