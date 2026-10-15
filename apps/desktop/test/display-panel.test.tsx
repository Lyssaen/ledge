import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Launch at login only answers inside Tauri: the test plays Windows' answers.
const bridge = vi.hoisted(() => ({ get: vi.fn(async (): Promise<boolean | null> => false), set: vi.fn(async (_on: boolean): Promise<boolean | null> => null) }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  getAutostart: () => bridge.get(),
  setAutostart: (on: boolean) => bridge.set(on)
}));
import { LangProvider } from '../src/i18n/lang';
import { DisplayPanel } from '../src/settings/DisplayPanel';
import { resetAppearanceForTests } from '../src/shell/theme';

beforeEach(() => { localStorage.clear(); resetAppearanceForTests(); bridge.get.mockClear(); bridge.set.mockReset(); });
const toggle = () => screen.getByRole('switch', { name: /^(Launch at start-up|Lancer au démarrage)$/ });

describe('Display › launch at start-up (parked T8)', () => {
  it('a change Windows refused says so, keeps the previous state and can be retried', async () => {
    bridge.set.mockResolvedValueOnce(null).mockResolvedValueOnce(true);
    render(<DisplayPanel lang="en" onLang={() => {}} />);
    await waitFor(() => expect(toggle()).toBeEnabled());
    await userEvent.click(toggle());
    expect(await screen.findByText('Could not change launch at start-up.')).toBeInTheDocument();
    expect(screen.queryByText('Available in the installed app.')).toBeNull();
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeEnabled();
    await userEvent.click(toggle());
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(screen.queryByText('Could not change launch at start-up.')).toBeNull();
    expect(screen.getByText('With your Windows session.')).toBeInTheDocument();
  });
  it('speaks French', async () => {
    bridge.set.mockResolvedValueOnce(null);
    render(<LangProvider lang="fr"><DisplayPanel lang="fr" onLang={() => {}} /></LangProvider>);
    await waitFor(() => expect(toggle()).toBeEnabled());
    await userEvent.click(toggle());
    expect(await screen.findByText('Impossible de modifier le lancement au démarrage.')).toBeInTheDocument();
  });
});
