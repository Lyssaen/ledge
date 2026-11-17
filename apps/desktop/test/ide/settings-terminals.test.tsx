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

  // docs/mockups/terminal-wheel: like Windows by default, the stepper greyed; a speed chosen, 1 to 20, said saved.
  it('chooses the wheel: like Windows, or a number of lines per notch kept between 1 and 20', async () => {
    const saved = vi.fn();
    view(saved);
    const system = screen.getByRole('radio', { name: 'Comme Windows' });
    const fixed = screen.getByRole('radio', { name: /lignes par cran/ });
    const lines = () => within(screen.getByRole('group', { name: 'Lignes par cran' })).getByRole('status');
    const more = screen.getByRole('button', { name: 'Une ligne de plus par cran' });
    expect((system as HTMLInputElement).checked).toBe(true);
    expect(lines().textContent).toBe('3');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(more);
    expect(lines().textContent).toBe('3');
    expect(saved).not.toHaveBeenCalled();
    await userEvent.click(fixed);
    expect(saved).toHaveBeenLastCalledWith('Défilement à la molette : 3 lignes par cran');
    for (let i = 0; i < 20; i++) await userEvent.click(more);
    expect(lines().textContent).toBe('20');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(saved).toHaveBeenLastCalledWith('Défilement à la molette : 20 lignes par cran');
    expect(JSON.parse(localStorage.getItem('ledge.ide.wheel')!)).toEqual({ mode: 'fixed', lines: 20 });
    await userEvent.click(system);
    expect(saved).toHaveBeenLastCalledWith('Défilement à la molette : comme Windows');
    // The number stays for the next time a speed is chosen.
    cleanup();
    view();
    expect((screen.getByRole('radio', { name: 'Comme Windows' }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole('group', { name: 'Lignes par cran' })).getByRole('status').textContent).toBe('20');
  });

  it('a single line per notch is the least', async () => {
    view();
    await userEvent.click(screen.getByRole('radio', { name: /lignes par cran/ }));
    const less = screen.getByRole('button', { name: 'Une ligne de moins par cran' });
    for (let i = 0; i < 4; i++) await userEvent.click(less);
    expect(within(screen.getByRole('group', { name: 'Lignes par cran' })).getByRole('status').textContent).toBe('1');
    expect(less.getAttribute('aria-disabled')).toBe('true');
  });
});
