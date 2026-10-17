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

purgeObsolete();

// The e2e build only (VITE_LEDGE_E2E, dropped from the release build): every notice is recorded where Playwright can read it,
// since a notice replaces the previous one on screen and the DOM cannot count them.
if (import.meta.env.VITE_LEDGE_E2E) (window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts = recordToastsForTests();

// The chosen language's strings and French (the fallback) come first, each in its own chunk, read locally: the window
// stays empty only for that instant. The other language loads when it is asked for. If no table loads, a bilingual line says so.
void bootLanguages(loadMessages, loadLang()).then(boot => {
  const root = document.getElementById('root')!;
  if (boot.ok) { createRoot(root).render(<App lang={boot.lang} />); return; }
  root.setAttribute('role', 'alert');
  root.replaceChildren(...BOOT_FAILURE.map(line => Object.assign(document.createElement('p'), { textContent: line })));
});
void updater.start();
void applyUiScale(loadUiScale());
