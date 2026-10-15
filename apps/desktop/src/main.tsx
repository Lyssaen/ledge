import { createRoot } from 'react-dom/client';
import { App } from './App';
import './motionPreferences';
import './styles/app.css';
import { applyUiScale, loadUiScale } from './settings/scale';
import { updater } from './update/store';

createRoot(document.getElementById('root')!).render(<App />);
void updater.start();
void applyUiScale(loadUiScale());
