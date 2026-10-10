import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setFallbackLang } from '../src/i18n/lang';

// The app defaults to French; the unit suite predates the French copy and reads English unless a test asks for French
// (`ledge.lang` = 'fr' or a <LangProvider lang="fr">).
setFallbackLang('en');

afterEach(cleanup);

// jsdom has no ResizeObserver; a silent one lets measured layouts fall back to their defaults. Tests stub their own to report sizes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
