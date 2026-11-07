import { createRoot } from 'react-dom/client';
import { App } from './App';
import './motionPreferences';
import './styles/app.css';
import { applyUiScale, loadUiScale } from './settings/scale';
import { updater } from './update/store';
import { purgeObsolete } from './state/obsolete';
import { loadLang } from './i18n/lang';
import { loadMessages } from './i18n/messages';
import { bootLanguages, BOOT_FAILURE } from './i18n/boot';
import { recordToastsForTests } from './shell/Toast';
import type { PtyBackend } from './term/backend';
import type { ShellsAvailable } from './term/shells';
import { isAtelierWindow } from './atelier/detach';

purgeObsolete();

// The e2e build only (VITE_LEDGE_E2E, dropped from the release build): every notice is recorded where Playwright can read it,
// since a notice replaces the previous one on screen and the DOM cannot count them.
if (import.meta.env.VITE_LEDGE_E2E) (window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts = recordToastsForTests();

// The e2e build only: a stand-in shell that prints a `$ ` prompt and echoes what is typed, and records each write for Playwright.
if (import.meta.env.VITE_LEDGE_E2E) {
  const w = window as unknown as { __ledgePtyWrites?: string[]; __ledgePtyOpens?: { argv: string[]; native?: string }[]; __ledgeFakePty?: PtyBackend; __ledgePtyEmit?: (text: string) => void; __ledgeShells?: ShellsAvailable };
  const writes: string[] = w.__ledgePtyWrites = [];
  const opens: { argv: string[]; native?: string }[] = w.__ledgePtyOpens = [];
  w.__ledgeShells ??= { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
  const enc = new TextEncoder();
  w.__ledgeFakePty = {
    open: async (argv, _size, on, native) => {
      opens.push({ argv, native });
      let closed = false;
      // What the program prints, from Playwright: the last opened screen's.
      w.__ledgePtyEmit = text => { if (!closed) on.data(enc.encode(text)); };
      queueMicrotask(() => { if (!closed) on.data(enc.encode('$ ')); });
      return {
        write: data => { writes.push(data); if (!closed) on.data(enc.encode(data)); },
        resize: () => {},
        close: () => { closed = true; },
      };
    },
  };
}

// The chosen language's strings and French (the fallback) come first, each in its own chunk, read locally: the window
// stays empty only for that instant. The other language loads when it is asked for. If no table loads, a bilingual line says so.
// The detached Atelier's window (#21) loads the same page: it shows the Atelier alone, and leaves the updates to the main window.
const atelier = isAtelierWindow();
void Promise.all([bootLanguages(loadMessages, loadLang()), atelier]).then(async ([boot, alone]) => {
  const root = document.getElementById('root')!;
  if (boot.ok && alone) { const { AtelierApp } = await import('./atelier/AtelierWindow'); createRoot(root).render(<AtelierApp lang={boot.lang} />); return; }
  if (boot.ok) { createRoot(root).render(<App lang={boot.lang} />); return; }
  root.setAttribute('role', 'alert');
  root.replaceChildren(...BOOT_FAILURE.map(line => Object.assign(document.createElement('p'), { textContent: line })));
});
void atelier.then(alone => { if (!alone) void updater.start(); });
void applyUiScale(loadUiScale());
