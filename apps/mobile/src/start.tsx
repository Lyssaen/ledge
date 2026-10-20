// What the page shows first: the insecure screen, the app once it and its start have loaded, or why it could not.
import type { ReactNode } from 'react';
import { BootFailed, Insecure } from './screens/Insecure';

type Load = () => Promise<[typeof import('./App'), typeof import('./boot')]>;

// Loaded on demand only: @ledge/seal reads crypto.subtle when it loads, and must stay out of this first chunk.
const loadApp: Load = () => Promise.all([import('./App'), import('./boot')]);

export async function start(render: (n: ReactNode) => void, secure: boolean, load: Load = loadApp): Promise<void> {
  // Without a secure context @ledge/seal is never imported.
  if (!secure) {
    render(<Insecure />);
    return;
  }
  try {
    const [{ App }, { boot }] = await load();
    const booted = await boot();
    render(<App {...booted} />);
  } catch {
    render(<BootFailed />);
  }
}
