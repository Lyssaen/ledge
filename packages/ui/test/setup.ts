import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

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
