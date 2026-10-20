import { createRoot } from 'react-dom/client';
import './styles.css';
import { Insecure } from './screens/Insecure';

const root = createRoot(document.getElementById('root')!);

// @ledge/seal reads crypto.subtle when it loads: without a secure context it is never imported.
if (!window.isSecureContext) {
  root.render(<Insecure />);
} else {
  void Promise.all([import('./App'), import('./boot')])
    .then(async ([{ App }, { boot }]) => {
      const booted = await boot();
      root.render(<App {...booted} />);
    });
}
