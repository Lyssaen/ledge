import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FreeShellView } from '../../src/session/FreeShellView';
import { TermStore } from '../../src/term/store';
import { TermStoreContext } from '../../src/term/useTerms';
import { fakeBackend, fakeSurface, type FakeSurface } from '../term-fakes';

function shell() {
  const surfaces: FakeSurface[] = [];
  const store = new TermStore({
    backend: fakeBackend(), freeLaunch: () => ({ argv: ['sh'] }),
    surface: () => { const s = fakeSurface(); surfaces.push(s); return s; },
    agentArgv: () => null, shellArgv: () => null, shellPlace: () => ({ dir: '~', remote: false })
  });
  return { store, id: store.openFree('wsl', ''), surfaces };
}

describe('a bottom-panel shell view', () => {
  it('a shell just opened takes the keyboard once its xterm is in; another does not', () => {
    const a = shell();
    render(<TermStoreContext.Provider value={a.store}><FreeShellView id={a.id} claimFocus={id => id === a.id} /></TermStoreContext.Provider>);
    expect(a.surfaces[0]!.focuses).toBe(1);
    expect(a.surfaces[0]!.host.parentElement).toHaveClass('terminal-screen');
    const b = shell();
    render(<TermStoreContext.Provider value={b.store}><FreeShellView id={b.id} claimFocus={() => false} /></TermStoreContext.Provider>);
    expect(b.surfaces[0]!.focuses).toBe(0);
  });
});
