import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/i18n/lang';
import { DockHost } from '../../src/ide/DockHost';
import { activate, empty, open, type Tab } from '../../src/workspace/model';
import { createWorkspaceStore, useWorkspace, type WorkspaceStore } from '../../src/workspace/store';
import { useTabPlace } from '../../src/workspace/tabPlace';

afterEach(() => { cleanup(); localStorage.clear(); });

const A: Tab = { kind: 'session', ref: 'local:a' };
const B: Tab = { kind: 'session', ref: 'local:b' };

function Place({ tab }: { tab: Tab }) {
  const p = useTabPlace();
  return <p data-testid={tab.ref}>{p ? JSON.stringify(p) : 'none'}</p>;
}
function Host({ store }: { store: WorkspaceStore }) {
  const ws = useWorkspace(store);
  return <LangProvider lang="fr"><DockHost ws={ws} store={store} title={t => t.ref} body={tab => <Place tab={tab} />} /></LangProvider>;
}
const read = (ref: string) => JSON.parse(screen.getByTestId(ref).textContent!) as { key: string; group: string; visible: boolean; active: boolean };

describe('the dock host gives each tab its place', () => {
  it('the front tab is visible and active; activating the other swaps them, the first staying mounted but hidden', async () => {
    const both = open(open(empty(), A), B);
    const gid = both.focus;
    const store = createWorkspaceStore(activate(both, gid, 0));
    render(<Host store={store} />);
    await waitFor(() => expect(read('local:a')).toEqual({ key: 'session:local:a', group: gid, visible: true, active: true }));
    const a = screen.getByTestId('local:a');   // kept after it hides: its DOM is detached, its React tree is not
    // dockview renders a panel on its first showing only: the other tab has no content yet.
    expect(screen.queryByTestId('local:b')).toBeNull();
    act(() => store.update(w => activate(w, gid, 1)));
    await waitFor(() => expect(read('local:b')).toMatchObject({ visible: true, active: true }));
    await waitFor(() => expect(JSON.parse(a.textContent!)).toMatchObject({ visible: false, active: false }));
  });
});
