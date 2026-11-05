import { createRoot } from 'react-dom/client';
import './styles.css';
import { start } from './start';
import { initMotion } from './motion';
import { initTheme } from './theme';

initTheme();
initMotion();
const root = createRoot(document.getElementById('root')!);
void start((n) => root.render(n), window.isSecureContext);
