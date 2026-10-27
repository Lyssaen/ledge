import { createRoot } from 'react-dom/client';
import './styles.css';
import { start } from './start';
import { initTheme } from './theme';

initTheme();
const root = createRoot(document.getElementById('root')!);
void start((n) => root.render(n), window.isSecureContext);
