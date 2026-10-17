import { createRoot } from 'react-dom/client';
import { App } from './App';
import './motionPreferences';
import './styles/app.css';
import { applyUiScale, loadUiScale } from './settings/scale';
import { updater } from './update/store';
import { purgeObsolete } from './state/obsolete';
import { loadLang } from './i18n/lang';
import { loadMessages } from './i18n/messages';

purgeObsolete();

// The chosen language's strings and French (the fallback) come first, each in its own chunk, read locally: the window
// stays empty only for that instant. The other language loads when it is asked for.
void Promise.all([loadMessages(loadLang()), loadMessages('fr')]).then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
void updater.start();
void applyUiScale(loadUiScale());
