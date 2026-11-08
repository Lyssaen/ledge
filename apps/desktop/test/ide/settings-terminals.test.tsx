import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../../src/i18n/lang';
import { WorkspaceSection } from '../../src/settings/WorkspaceSection';
import type { SettingsContext } from '../../src/settings/SettingsPage';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

// The WebGL stepper's value (the status bar's alert has its own).
const webgl = () => within(screen.getByRole('group', { name: 'Rendu rapide (WebGL) pour' })).getByRole('status');
const view = (saved = vi.fn()) => render(<LangProvider lang="fr"><WorkspaceSection ctx={{ saved, client: {} } as unknown as SettingsContext} /></LangProvider>);

describe('Settings › Workspace › Terminals', () => {
  it('steps the WebGL budget, never past 16 or below 1, and says it saved', async () => {
    const saved = vi.fn();
    view(saved);
    expect(screen.getByRole('heading', { name: 'Terminaux' })).toBeTruthy();
    expect(webgl().textContent).toBe('12');
    const more = screen.getByRole('button', { name: /de plus en WebGL/ });
    for (let i = 0; i < 6; i++) await userEvent.click(more);
    expect(webgl().textContent).toBe('16');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    // The focused button stays focused at the bound.
    more.focus();
    await userEvent.click(more);
    expect(document.activeElement).toBe(more);
    expect(webgl().textContent).toBe('16');
    expect(saved).toHaveBeenLastCalledWith('Rendu rapide (WebGL) : 16 terminaux visibles au plus');
    expect(saved).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem('ledge.ide.webgl')).toBe('16');
  });

  it('reads the value back after a remount', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: /de moins en WebGL/ }));
    cleanup();
    view();
    expect(webgl().textContent).toBe('11');
  });
});
