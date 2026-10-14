import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { registerSw } from './registerSw';

createRoot(document.getElementById('root')!).render(<App />);
registerSw();
