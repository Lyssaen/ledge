import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { connectRemote } from './connection/remoteClient';
import { startPushSync } from './push/sync';
import { registerSw } from './registerSw';
import { mobileStore } from './state/store';

startPushSync(mobileStore);
const client = connectRemote({ store: mobileStore });
createRoot(document.getElementById('root')!).render(<App onPaired={() => client.connect()} onReconnect={() => client.connect()} />);
registerSw();
