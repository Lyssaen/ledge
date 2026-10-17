// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootLanguages, BOOT_FAILURE } from '../src/i18n/boot';
import type { Lang } from '../src/i18n/messages';

/** A loader whose languages fail their first `fails[lang]` calls, recording each call. */
function loader(fails: Partial<Record<Lang, number>>) {
  const calls: Lang[] = [];
  const load = (l: Lang) => { calls.push(l); const left = fails[l] ?? 0; fails[l] = left - 1; return left > 0 ? Promise.reject(new Error(`no ${l}`)) : Promise.resolve(); };
  return { load, calls };
}

describe('the boot sequence', () => {
  it('renders in the chosen language once it and French are loaded', async () => {
    const { load, calls } = loader({}), log = vi.fn();
    await expect(bootLanguages(load, 'en', log)).resolves.toEqual({ ok: true, lang: 'en' });
    expect(calls.sort()).toEqual(['en', 'fr']);
    expect(log).not.toHaveBeenCalled();
  });

  it('retries a failed chunk once, logging the failure', async () => {
    const { load, calls } = loader({ en: 1 }), log = vi.fn();
    await expect(bootLanguages(load, 'en', log)).resolves.toEqual({ ok: true, lang: 'en' });
    expect(calls.filter(l => l === 'en')).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('falls back to French when the chosen language fails twice', async () => {
    const { load, calls } = loader({ en: 2 }), log = vi.fn();
    await expect(bootLanguages(load, 'en', log)).resolves.toEqual({ ok: true, lang: 'fr' });
    expect(calls.filter(l => l === 'en')).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('fails when no language loads, French included', async () => {
    const { load } = loader({ en: 2, fr: 2 }), log = vi.fn();
    await expect(bootLanguages(load, 'en', log)).resolves.toEqual({ ok: false });
    await expect(bootLanguages(loader({ fr: 2 }).load, 'fr', log)).resolves.toEqual({ ok: false });
  });

  it('the failure message needs no strings table: it speaks both languages', () => {
    expect(BOOT_FAILURE).toEqual([
      'Ledge Desktop n’a pas pu charger ses textes. Relancez l’application.',
      'Ledge Desktop could not load its text. Restart the app.'
    ]);
  });

  it('the entry point renders what the boot sequence settles on', () => {
    const main = readFileSync(resolve(__dirname, '../src/main.tsx'), 'utf8');
    expect(main).toMatch(/bootLanguages\(loadMessages, loadLang\(\)\)/);
    expect(main).toMatch(/BOOT_FAILURE/);
  });
});
