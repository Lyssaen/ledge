import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy, copyFor, lang, locale, setLang } from '../src/copy';
import { snapshot } from './state/helpers';
import { app } from './screens/app-setup';

vi.mock('../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

/** Every plain string of a table, with its key path (the functions' outputs depend on their arguments, not swept here). */
function strings(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

afterEach(() => { setLang('fr'); localStorage.clear(); vi.resetModules(); });

describe('the languages (m0-langue.html: Français · English, French by default)', () => {
  it('shows French until English is chosen', async () => {
    const m = await import('../src/copy');
    expect(m.lang).toBe('fr');
    expect(m.copy.nav.settings).toBe('Réglages');
    expect(m.locale).toBe('fr-FR');
  });

  it('shows the language kept on this device under mobile.lang, English with Desktop\'s locale', async () => {
    localStorage.setItem('mobile.lang', 'en');
    const m = await import('../src/copy');
    expect(m.lang).toBe('en');
    expect(m.copy.nav.atoi).toBe('For you');
    expect(m.locale).toBe('en-GB');
  });

  it('ignores a stored value that is no language of the app', async () => {
    localStorage.setItem('mobile.lang', 'de');
    expect((await import('../src/copy')).lang).toBe('fr');
  });

  it('changes every word at once, those a module kept included, and keeps the choice', () => {
    const nav = copy.nav;
    setLang('en');
    expect(lang).toBe('en');
    expect(locale).toBe('en-GB');
    expect(nav.settings).toBe('Settings');
    expect(copy.percent(84)).toBe('84%');
    expect(Object.keys(copy.nav)).toEqual(Object.keys(copyFor('en').nav));
    expect(localStorage.getItem('mobile.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setLang('fr');
    expect(nav.settings).toBe('Réglages');
    expect(copy.percent(84)).toBe('84 %');
  });

  it('says the MR/PR pane as the owner validated it', () => {
    expect(copyFor('fr').prs.pane).toEqual({ title: 'Rien à afficher', body: 'Une MR ou une PR et son pipeline s’ouvrent ici.' });
    // « À toi » is "For you" in English, as on Desktop (m0-langue.html, §2).
    expect(copyFor('en').nav.atoi).toBe('For you');
    expect(copyFor('en').prs.pane).toEqual({ title: 'Nothing to show', body: 'An MR or PR and its pipeline open here.' });
  });

  it('says Rigs\' start choices are kept on this device, a tablet too (Q98 A)', () => {
    expect(copyFor('fr').rigs.stopped.note).toBe('Ces deux choix sont gardés sur cet appareil, comme Desktop garde les siens.');
    expect(copyFor('fr').rigs.kernelView.daemonNote).toBe('Arrêter le daemon arrête tous les rigs et le kernel. Ces deux choix vivent sur cet appareil ; Desktop garde les siens.');
    expect(copyFor('en').rigs.stopped.note).toBe('These two choices are kept on this device, like Desktop keeps its own.');
    expect(copyFor('en').rigs.kernelView.daemonNote).toBe('Stopping the daemon stops every rig and the kernel. These two choices live on this device; Desktop keeps its own.');
  });

  it('leaves no French in the English table, but the languages\' own names', () => {
    const french = strings(copyFor('en')).filter(([k]) => !k.startsWith('settings.langs.')).filter(([, s]) => /[éèêàùçôîœ«»]|\b(le|la|les|des|une|est|pas|sur|avec)\b/i.test(s));
    expect(french).toEqual([]);
  });

  it('Réglages › Apparence: Thème then Langue, each language in its own; a tap turns the app to English, still on Réglages', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snapshot([], 'PC-Desan')));
    const group = screen.getByRole('group', { name: 'Langue' });
    expect(within(group).getByLabelText('Français')).toBeChecked();
    expect(within(group).getByText('English').closest('label')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('group', { name: 'Thème' })).toBeInTheDocument();
    act(() => { fireEvent.click(within(group).getByLabelText('English')); });
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Language' })).getByLabelText('English')).toBeChecked();
    expect(location.hash).toBe('#/connection');
  });
});
