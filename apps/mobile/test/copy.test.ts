import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFor } from '../src/copy';

/** Every plain string of a table, with its key path (the functions' outputs depend on their arguments, not swept here). */
function strings(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

afterEach(() => { localStorage.clear(); vi.resetModules(); });

describe('the languages (question Q2: French and English)', () => {
  it('shows French until a language is chosen', async () => {
    const m = await import('../src/copy');
    expect(m.lang).toBe('fr');
    expect(m.copy.nav.settings).toBe('Réglages');
    expect(m.locale).toBe('fr-FR');
  });

  it('shows the stored language, English with Desktop\'s locale', async () => {
    localStorage.setItem('ledge.lang', 'en');
    const m = await import('../src/copy');
    expect(m.lang).toBe('en');
    expect(m.copy).toBe(m.copyFor('en'));
    expect(m.locale).toBe('en-GB');
  });

  it('ignores a stored value that is no language of the app', async () => {
    localStorage.setItem('ledge.lang', 'de');
    expect((await import('../src/copy')).lang).toBe('fr');
  });

  it('says the MR/PR pane as the owner validated it', () => {
    expect(copyFor('fr').prs.pane).toEqual({ title: 'Rien à afficher', body: 'Une MR ou une PR et son pipeline s’ouvrent ici.' });
    // « À toi » is "For you" in English, as on Desktop (design-ux, 2026-11-10 19:53Z).
    expect(copyFor('en').nav.atoi).toBe('For you');
    expect(copyFor('en').prs.pane).toEqual({ title: 'Nothing to show', body: 'An MR or PR and its pipeline open here.' });
  });

  it('leaves no French in the English table', () => {
    const french = strings(copyFor('en')).filter(([, s]) => /[éèêàùçôîœ«»]|\b(le|la|les|des|une|est|pas|sur|avec)\b/i.test(s));
    expect(french).toEqual([]);
  });

  it('turns every English function into English too', () => {
    const en = copyFor('en');
    expect(en.inbox.subtitle(2)).not.toMatch(/demande/);
    expect(en.offline.title('WSL')).toContain('WSL');
    expect(en.host.offline('WSL')).toContain('WSL');
    expect(en.link.connecting('WSL')).toContain('WSL');
  });
});
