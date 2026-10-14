import { createRoot } from 'react-dom/client';
import { App } from './App';
import './motionPreferences';
import './styles/app.css';
import { updateAtStartup } from './update/startup';

createRoot(document.getElementById('root')!).render(<App />);
void updateAtStartup();
