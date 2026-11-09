import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import { LangProvider } from '../../src/i18n/lang';
import { WorkspaceSection } from '../../src/settings/WorkspaceSection';
import type { SettingsContext } from '../../src/settings/SettingsPage';
import { loadShowUsage, saveShowUsage, useShowUsage } from '../../src/workspace/prefs';

// Settings › Workspace › Status bar (docs/ide-workspace.md « Réglages », mockup settingsPage() l. 1056): the usage limits shown or
// not at the status bar's right, and the alert threshold the daemons keep (the same one General sets).
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); saveShowUsage(true); localStorage.clear(); });

const usageAt = (alert: number) => new Map([['local', { type: 'usage.state', harnesses: [], alerts: [], prefs: { alert } }]]);
function view(usage: ReadonlyMap<string, unknown>, setUsageAlert = vi.fn()) {
  const saved = vi.fn(); const notify = vi.fn();
  const client = { fleet: { subscribe: () => () => {}, usage: () => usage } } as unknown as DaemonClient;
  const ctx = { saved, notify, client, fleet: { setUsageAlert } } as unknown as SettingsContext;
  render(<LangProvider lang="fr"><WorkspaceSection ctx={ctx} /></LangProvider>);
  return { saved, notify, setUsageAlert, user: userEvent.setup() };
}

describe('the showUsage preference', () => {
  it('is on unless a stored false', () => {
    expect(loadShowUsage()).toBe(true);
    for (const raw of ['"no"', '0', 'null', 'not json']) { localStorage.setItem('ledge.ide.showUsage', raw); expect(loadShowUsage()).toBe(true); }
    saveShowUsage(false);
    expect(loadShowUsage()).toBe(false);
  });

  it('useShowUsage: setting it in one consumer re-renders the others', () => {
    const a = renderHook(() => useShowUsage());
    const b = renderHook(() => useShowUsage());
    act(() => a.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);
  });
});

describe('Settings › Workspace › Status bar', () => {
  it('comes between « Ouvrir une session » and « Terminaux »', () => {
    view(usageAt(0.8));
    const heads = screen.getAllByRole('heading').map(h => h.textContent);
    expect(heads).toEqual(['Barre d’état', 'Terminaux']);
  });

  it('the usage limits box: checked by default, unchecking it hides them and says so', async () => {
    const { saved, user } = view(usageAt(0.8));
    const box = screen.getByRole('checkbox', { name: 'Limites d’usage des comptes' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(loadShowUsage()).toBe(false);
    expect(saved).toHaveBeenLastCalledWith('Limites d’usage masquées de la barre d’état');
    await user.click(box);
    expect(saved).toHaveBeenLastCalledWith('Limites d’usage affichées dans la barre d’état');
  });

  it('the alert steps by 5 % on the daemons’ threshold, and says it saved as General does', async () => {
    const { saved, setUsageAlert, user } = view(usageAt(0.8));
    expect(screen.getByRole('group', { name: 'Alerte à' })).toHaveTextContent('80');
    await user.click(screen.getByRole('button', { name: 'Monter le seuil d’alerte de 5 %' }));
    expect(setUsageAlert).toHaveBeenCalledWith(0.85);
    expect(saved).toHaveBeenLastCalledWith('Alerte de limite d’usage : 85 %');
  });

  it('never steps past the bounds', async () => {
    const { setUsageAlert, user } = view(usageAt(0.95));
    const more = screen.getByRole('button', { name: 'Monter le seuil d’alerte de 5 %' });
    expect(more).toHaveAttribute('aria-disabled', 'true');
    await user.click(more);
    expect(setUsageAlert).not.toHaveBeenCalled();
    cleanup();
    const low = view(usageAt(0.5));
    await low.user.click(screen.getByRole('button', { name: 'Baisser le seuil d’alerte de 5 %' }));
    expect(low.setUsageAlert).not.toHaveBeenCalled();
  });

  it('no machine gives its limits yet: the steps are off and the row says why', async () => {
    const { setUsageAlert, user } = view(new Map());
    const less = screen.getByRole('button', { name: 'Baisser le seuil d’alerte de 5 %' });
    expect(less).toHaveAttribute('aria-disabled', 'true');
    await user.click(less);
    expect(setUsageAlert).not.toHaveBeenCalled();
    expect(screen.getByText(/Aucune machine ne donne encore les limites de ses harnais/)).toBeInTheDocument();
  });

  it('a refused threshold is said in the toast', async () => {
    const { notify, user } = view(usageAt(0.8), vi.fn(() => { throw new Error('Le daemon local est hors ligne.'); }));
    await user.click(screen.getByRole('button', { name: 'Monter le seuil d’alerte de 5 %' }));
    expect(notify).toHaveBeenCalledWith('Le daemon local est hors ligne.');
  });
});
