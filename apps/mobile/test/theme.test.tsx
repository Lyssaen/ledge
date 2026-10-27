import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTheme, readChoice, setTheme } from '../src/theme';
import { MemoryStorage, snapshot } from './state/helpers';
import { app } from './screens/app-setup';

vi.mock('../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

/** The phone's setting, as matchMedia says it; `flip` changes it as the system would. */
function phone(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = { matches: dark, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: () => undefined };
  vi.stubGlobal('matchMedia', () => query);
  return { flip: (next: boolean) => { query.matches = next; listeners.forEach(l => l()); } };
}

const root = () => document.documentElement;
const meta = () => document.querySelector('meta[name="theme-color"]');

beforeEach(() => {
  const m = document.createElement('meta');
  m.name = 'theme-color';
  document.head.append(m);
});
afterEach(() => { vi.unstubAllGlobals(); meta()?.remove(); delete root().dataset.theme; });

describe('theme', () => {
  it('« Système » by default: the phone\'s setting, followed as it changes', () => {
    const p = phone(false);
    initTheme(new MemoryStorage());
    expect(root().dataset.theme).toBe('light');
    expect(meta()).toHaveAttribute('content', '#ffffff');
    p.flip(true);
    expect(root().dataset.theme).toBe('dark');
    expect(meta()).toHaveAttribute('content', '#0a0a0a');
  });

  it('a chosen theme holds over the phone\'s setting, and is kept for the next start', () => {
    const p = phone(true);
    const storage = new MemoryStorage();
    initTheme(storage);
    setTheme('light', storage);
    expect(root().dataset.theme).toBe('light');
    p.flip(true);
    expect(root().dataset.theme).toBe('light');
    expect(readChoice(storage)).toBe('light');
    initTheme(storage);
    expect(root().dataset.theme).toBe('light');
  });

  it('an unknown or unreadable stored value is « Système »', () => {
    const storage = new MemoryStorage();
    storage.setItem('ledge.theme', 'sepia');
    expect(readChoice(storage)).toBe('system');
  });

  it('Connection offers Système, Clair and Sombre; a tap changes the theme at once', () => {
    phone(true);
    initTheme(new MemoryStorage());
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snapshot([], 'PC-Desan')));
    const group = screen.getByRole('group', { name: 'Apparence' });
    expect(screen.getAllByRole('radio').map(r => r.parentElement?.textContent)).toEqual(['Système', 'Clair', 'Sombre']);
    expect(screen.getByRole('radio', { name: 'Système' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    expect(screen.getByRole('radio', { name: 'Clair' })).toBeChecked();
    expect(root().dataset.theme).toBe('light');
    expect(group).toBeInTheDocument();
  });
});
