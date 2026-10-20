import { createRoot } from 'react-dom/client';
import './styles.css';
import { copy } from './copy';

const root = createRoot(document.getElementById('root')!);

// @ledge/seal reads crypto.subtle when it loads: without a secure context it is never imported.
if (!window.isSecureContext) {
  root.render(
    <main className="app" role="alert">
      <h1>{copy.insecure.title}</h1>
      <p>{copy.insecure.body}</p>
    </main>
  );
} else {
  void import('./App').then(({ App }) => root.render(<App />));
}
