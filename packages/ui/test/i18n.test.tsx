import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createI18n, useUiCopy, type UiCopy } from '../src/i18n/lang';

const copy = (name: string): UiCopy => ({ stateLabel: { starting: name, working: name, approval: name, question: name, idle: name, done: name, error: name, readonly: name }, botLabel: { starting: name, working: name, approval: name, question: name, idle: name, done: name, error: name, readonly: name }, botReadOnly: name, botNotLive: name, residentName: name, residentOffline: name });
const fr = { hello: 'Bonjour', ui: copy('fr') }; const en = { hello: 'Hello', ui: copy('en') };
const make = (prefix = 'ledge') => createI18n({ langs: ['fr', 'en'] as const, messages: { fr, en }, fallback: 'fr', prefix, uiCopy: m => m.ui });

beforeEach(() => localStorage.clear());

describe('createI18n', () => {
  it('reads the stored language under its prefix, falls back otherwise', () => {
    const i18n = make();
    expect(i18n.loadLang()).toBe('fr');
    localStorage.setItem('ledge.lang', 'en'); expect(i18n.loadLang()).toBe('en');
    localStorage.setItem('ledge.lang', 'de'); expect(i18n.loadLang()).toBe('fr');
    i18n.setFallbackLang('en'); expect(i18n.loadLang()).toBe('en');
    i18n.saveLang('fr'); expect(localStorage.getItem('ledge.lang')).toBe('fr');
    expect(make('desktop').loadLang()).toBe('fr'); // another prefix does not see ledge.lang
  });
  it('useI18n follows the provider, else the stored language', () => {
    const i18n = make();
    localStorage.setItem('ledge.lang', 'en');
    expect(renderHook(() => i18n.useI18n()).result.current.t.hello).toBe('Hello');
    const { result } = renderHook(() => i18n.useI18n(), { wrapper: ({ children }) => <i18n.LangProvider lang="fr">{children}</i18n.LangProvider> });
    expect(result.current.t.hello).toBe('Bonjour');
  });
  it('the UI copy follows the provider, and outside one the stored language of the last created i18n', () => {
    const i18n = make();
    localStorage.setItem('ledge.lang', 'en');
    expect(renderHook(() => useUiCopy()).result.current.botReadOnly).toBe('en');
    const { result } = renderHook(() => useUiCopy(), { wrapper: ({ children }) => <i18n.LangProvider lang="fr">{children}</i18n.LangProvider> });
    expect(result.current.botReadOnly).toBe('fr');
  });
});
