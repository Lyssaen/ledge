import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { connectRemote } from './connection/remoteClient';
import { registerSw } from './registerSw';
import { mobileStore } from './state/store';

const client = connectRemote({ store: mobileStore });
createRoot(document.getElementById('root')!).render(<App onPaired={() => client.connect()} onReconnect={() => client.connect()} />);
registerSw();
