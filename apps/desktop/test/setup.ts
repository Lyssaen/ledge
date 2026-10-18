import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { preloaded } from '../src/shell/preload';
import { setFallbackLang } from '../src/i18n/lang';
import { loadMessages } from '../src/i18n/messages';
import '../src/motionPreferences';

// The app defaults to French; the unit suite predates the French copy and reads English unless a test asks for French
// (`ledge.lang` = 'fr' or a <LangProvider lang="fr">).
setFallbackLang('en');

// Each language's strings come in a chunk of their own (see i18n/messages.ts); the suite has both before any test, so
// renders and `MESSAGES.fr` / `.en` stay synchronous, as in the app once the entry point has loaded them.
await Promise.all([loadMessages('fr'), loadMessages('en')]);

afterEach(cleanup);
// The app fetches its places' chunks once mounted (shell/preload): those imports finish before the file's environment goes.
afterAll(preloaded);

// Node 25+ defines its own `localStorage` / `sessionStorage` globals (undefined without `--localstorage-file`), and
// the jsdom environment leaves a global that already exists alone, so the app finds no storage. A jsdom window of
// the same origin lends its two stores and their `Storage` class, so a spy on `Storage.prototype` still reaches them
// (one lender per test file, since every file runs its own setup).
if (typeof document !== 'undefined' && !globalThis.localStorage) {
  // @ts-expect-error jsdom ships no type declarations
  const { JSDOM } = await import('jsdom');
  const lender = new JSDOM('', { url: location.href }).window as Record<string, unknown>;
  for (const key of ['localStorage', 'sessionStorage', 'Storage'] as const) {
    Object.defineProperty(globalThis, key, { value: lender[key], configurable: true, writable: true });
  }
}

// jsdom has no ResizeObserver; a silent one lets measured layouts fall back to their defaults. Tests stub their own to report sizes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
