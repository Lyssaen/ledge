import { createRoot } from 'react-dom/client';
import './styles.css';
import { start } from './start';
import { initMotion } from './motion';
import { initTheme } from './theme';
import { lang } from './copy';

// The page's language follows the table shown: screen readers and hyphenation read it.
document.documentElement.lang = lang;
initTheme();
initMotion();
const root = createRoot(document.getElementById('root')!);
void start((n) => root.render(n), window.isSecureContext);
