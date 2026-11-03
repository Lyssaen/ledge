import { act, render, screen, within } from '@testing-library/react';
import { RIG_ROW_REFRESH_MS, type PhoneRigRow, type PhoneServerMessage, type ThreadItem } from '@ledge/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { at, rigHandoff } from '../model/rig-fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const QITEM = 'qitem-20261102190205-c0704682203041b9';
const row = (state: string, extra: Partial<PhoneRigRow> = {}): PhoneRigRow => ({
  id: QITEM, state, from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', createdAt: at(19, 2), updatedAt: at(19, 3), at: at(19, 5), ...extra
});
const rowState = (r?: PhoneRigRow, error?: 'not_found' | 'unavailable'): PhoneServerMessage =>
  ({ type: 'openrig.rowState', qitem: QITEM, ...(r ? { row: r } : {}), ...(error ? { error } : {}) });

function opened(items: ThreadItem[], rigRows = true) {
  const t = setup();
  const snap = snapshot([session('lu', { name: 'Lu', state: 'idle' }), session('bix', { name: 'Bix', state: 'idle' })]);
  if (snap.type === 'snapshot' && rigRows) snap.daemon = { ...snap.daemon, rigRows: true };
  t.deliver(snap);
  render(<Thread store={t.store} sessionId="lu" storage={t.storage} />);
  act(() => t.deliver({ type: 'session.thread', id: 'lu', items, cut: [], more: false }));
  return t;
}
const card = (name = 'Confiée par Bix') => screen.getByRole('region', { name });
const pill = (name?: string) => card(name).querySelector('[data-state]')!;
const handed = rigHandoff('h1', at(19, 2), 'Retouche maquette encoche', {}, { peer: 'bix' });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('a task card\'s live row state', () => {
  it('asks nothing when the PC does not read rows, and says « état non suivi »', () => {
    const t = opened([handed], false);
    expect(t.of('openrig.row')).toEqual([]);
    expect(pill()).toHaveTextContent('état non suivi');
  });

  it('asks the row once when the card shows, then follows it: pending → in-progress → done', () => {
    const t = opened([handed]);
    expect(t.of('openrig.row')).toEqual([{ type: 'openrig.row', qitem: QITEM }]);
    act(() => t.deliver(rowState(row('pending'))));
    expect(pill()).toHaveTextContent('en attente');
    expect(pill()).toHaveAttribute('data-state', 'pending');
    expect(within(card()).getByText('confiée 19:02 · pas encore prise')).toBeInTheDocument();
    act(() => t.deliver(rowState(row('in-progress', { claimedAt: at(19, 2) }))));
    expect(pill()).toHaveTextContent('prise');
    expect(pill()).toHaveClass('text-info');
    act(() => t.deliver(rowState(row('done', { claimedAt: at(19, 2), updatedAt: at(19, 3) }))));
    expect(pill()).toHaveTextContent('terminée');
    expect(pill()).toHaveClass('text-ok');
    expect(within(card()).getByText('confiée 19:02 · prise 19:02 · terminée 19:03')).toBeInTheDocument();
  });

  it('asks again every 30 s while visible, never twice while a read is in flight', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const t = opened([handed]);
    expect(t.of('openrig.row')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(RIG_ROW_REFRESH_MS); });
    expect(t.of('openrig.row')).toHaveLength(1); // the first is still unanswered
    act(() => t.deliver(rowState(row('pending'))));
    act(() => { vi.advanceTimersByTime(RIG_ROW_REFRESH_MS); });
    expect(t.of('openrig.row')).toHaveLength(2);
  });

  it('says passed, blocked and an unknown word as OpenRig wrote it; passed by this seat', () => {
    const t = opened([rigHandoff('h2', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2' }, { outgoing: true, peer: 'bix' })]);
    act(() => t.deliver(rowState(row('handed-off', { handedOffTo: 'dev-front@ledge-dev-2', claimedAt: at(19, 4) }))));
    expect(pill('Passée à Bix')).toHaveTextContent('passée à dev-front');
    expect(within(card('Passée à Bix')).getByText('passée 19:02 · prise 19:04')).toBeInTheDocument();
    act(() => t.deliver(rowState(row('blocked'))));
    expect(pill('Passée à Bix')).toHaveTextContent('bloquée');
    act(() => t.deliver(rowState(row('parked'))));
    expect(pill('Passée à Bix')).toHaveTextContent('parked');
    expect(pill('Passée à Bix')).toHaveAttribute('data-state', 'unknown');
  });

  it('keeps « état non suivi » on an error', () => {
    const t = opened([handed]);
    act(() => t.deliver(rowState(undefined, 'not_found')));
    expect(pill()).toHaveTextContent('état non suivi');
    expect(within(card()).queryByText(/confiée/)).not.toBeInTheDocument();
  });

  it('never asks for a handoff OpenRig refused', () => {
    const refused = { ...rigHandoff('h3', at(19, 4), 'x', { to: 'pilot-lead@ledge-dev-2', raw: 'rig queue handoff …\nError' }, { outgoing: true, peer: 'bix' }), status: 'refused' } as ThreadItem;
    const t = opened([refused]);
    expect(t.of('openrig.row')).toEqual([]);
    expect(pill('Passée à Bix')).toHaveTextContent('non transmise');
  });

  it('asks nothing for a card off screen, and asks once it shows', () => {
    const observers: { cb: IntersectionObserverCallback; el?: Element }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      o: { cb: IntersectionObserverCallback; el?: Element };
      constructor(cb: IntersectionObserverCallback) { this.o = { cb }; observers.push(this.o); }
      observe(el: Element) { this.o.el = el; }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    });
    const t = opened([handed]);
    expect(t.of('openrig.row')).toEqual([]);
    const o = observers.find(x => x.el === card())!;
    act(() => o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(t.of('openrig.row')).toEqual([{ type: 'openrig.row', qitem: QITEM }]);
  });
});
