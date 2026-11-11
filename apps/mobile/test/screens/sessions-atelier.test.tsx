import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneServerMessage } from '@ledge/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { helperDot, islandDot, islands } from '../../src/model/sessions';
import { LONG_PRESS_MS } from '../../src/screens/longPress';
import { Sessions } from '../../src/screens/Sessions';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

// jsdom has no PointerEvent: without one the finger's position would be lost.
if (!('PointerEvent' in globalThis)) (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {};

const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
afterEach(() => { localStorage.clear(); wide(false); vi.useRealTimers(); location.hash = ''; });

const all = [
  session('nova', { name: 'Nova', tool: 'codex', project: 'ledge', state: 'working' }),
  session('pim', { name: 'Pim', project: 'ledge', state: 'waiting_permission', pending: pending({ key: 'kp' }),
    helpers: [{ id: 'h1', kind: 'Explore', task: 'lit le code', state: 'working' }, { id: 'h2', kind: 'Review', task: 'relit', state: 'exited', finishedAt: '2026-10-14T10:00:00.000Z' }] }),
  session('lou', { name: 'Lou', project: 'synapse', state: 'exited' }),
  session('tom', { name: 'Tom', tool: 'omp', project: 'synapse' }),
  session('front', { name: 'dev-front', project: 'ledge', state: 'waiting_input', rig: { name: 'ledge-dev', role: 'dev.front' } }),
  session('lead', { name: 'lead', project: 'ledge', state: 'working', rig: { name: 'ledge-dev', role: 'pilot.lead' } }),
  session('op', { name: 'operator', project: 'kernel', rig: { name: 'kernel', role: 'operator' } })
];

function page(daemon: Record<string, true> = {}) {
  const t = setup();
  const snap = snapshot(all);
  t.deliver({ ...snap, ...(snap.type === 'snapshot' ? { daemon: { ...snap.daemon, ...daemon } } : {}) } as PhoneServerMessage);
  render(<Sessions store={t.store} storage={t.storage} />);
  return t;
}
const toAtelier = () => fireEvent.click(within(screen.getByRole('group', { name: 'Affichage des sessions' })).getByRole('button', { name: 'Atelier' }));
const regions = () => screen.getAllByRole('region').map(r => r.getAttribute('aria-label'));

describe('the islands (m2-sessions.html §7)', () => {
  it('by project: the projects, then the rigs, as the list; by rig: the rigs, then « Hors rig »', () => {
    expect(islands(all, 'projects').map(i => [i.name, i.sessions.map(s => s.id)])).toEqual([
      ['ledge', ['pim', 'nova']], ['synapse', ['tom', 'lou']], ['ledge-dev', ['front', 'lead']], ['kernel', ['op']]
    ]);
    expect(islands(all, 'rigs').map(i => [i.kind, i.name, i.sessions.map(s => s.id)])).toEqual([
      ['rig', 'ledge-dev', ['front', 'lead']], ['rig', 'kernel', ['op']], ['outside', 'Hors rig', ['pim', 'nova', 'tom', 'lou']]
    ]);
  });

  it('a project\'s island has its most pressing request\'s dot, a rig\'s none; a sub-agent its own state\'s', () => {
    const [ledge, synapse, rig] = islands(all, 'projects');
    expect([islandDot(ledge!), islandDot(synapse!), islandDot(rig!)]).toEqual(['perm', null, null]);
    expect(islandDot({ id: 'p', kind: 'project', name: 'p', sessions: [all[4]!, all[0]!] })).toBe('ask');
    expect(all[1]!.helpers.map(helperDot)).toEqual(['work', 'done']);
  });
});

describe('the Atelier on a phone (§7)', () => {
  it('« Liste · Atelier » on the title\'s line, kept on this device', () => {
    const t = page();
    expect(within(screen.getByRole('group', { name: 'Affichage des sessions' })).getByRole('button', { name: 'Liste' })).toHaveAttribute('aria-pressed', 'true');
    toAtelier();
    expect(screen.getByRole('group', { name: 'Regrouper par' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtrer les sessions' })).toBeNull();
    expect(regions()).toEqual(['ledge', 'synapse', 'Rig ledge-dev', 'Rig kernel']);
    expect(t.storage.getItem('ledge.mobile.sessions.mode')).toBe('atelier');
  });

  it('a seat opens its thread, a sub-agent its agent\'s; a rig\'s seats have no runtime tag; an island counts its sessions', () => {
    page();
    toAtelier();
    const ledge = screen.getByRole('region', { name: 'ledge' });
    expect(ledge).toHaveTextContent(/^ledge2 sessions/);
    expect(within(ledge).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['CCPim', '#/thread/pim'], ['Explore', '#/thread/pim'], ['Review', '#/thread/pim'], ['CXNova', '#/thread/nova']
    ]);
    expect(within(ledge).getByRole('link', { name: 'Explore, sous-agent de Pim : lit le code' })).toBeInTheDocument();
    const rig = screen.getByRole('region', { name: 'Rig ledge-dev' });
    expect(rig).toHaveTextContent(/^ledge-devrig2 sièges/);
    expect(within(rig).getAllByRole('link').map(a => a.textContent)).toEqual(['dev-front', 'lead']);
  });

  it('by rig: the rigs, then « Hors rig »; the eye hides the sub-agents, their count back on their agent; both kept', () => {
    const t = page();
    toAtelier();
    fireEvent.click(screen.getByRole('button', { name: 'Rigs' }));
    expect(regions()).toEqual(['Rig ledge-dev', 'Rig kernel', 'Hors rig']);
    fireEvent.click(screen.getByRole('button', { name: 'Masquer les sous-agents' }));
    const out = screen.getByRole('region', { name: 'Hors rig' });
    expect(within(out).queryByRole('link', { name: /sous-agent de Pim/ })).toBeNull();
    expect(within(out).getByLabelText('2 sous-agents au travail')).toHaveTextContent('+2');
    expect(screen.getByRole('button', { name: 'Afficher les sous-agents' })).toBeInTheDocument();
    expect([t.storage.getItem('ledge.mobile.sessions.groupBy'), t.storage.getItem('ledge.mobile.sessions.helpers')]).toEqual(['rigs', 'hidden']);
  });

  it('with the PC\'s rigs, « 2 sièges » leads to them and the kernel says « OpenRig »', () => {
    page({ rigs: true });
    toAtelier();
    expect(within(screen.getByRole('region', { name: 'Rig ledge-dev' })).getByRole('link', { name: '2 sièges' })).toHaveAttribute('href', '#/rigs');
    expect(screen.getByRole('region', { name: 'Rig kernel' })).toHaveTextContent(/^kernelOpenRigoperator/);
  });

  it('Ledge\'s desk opens the Ledge tab and says how many agents it watches over', () => {
    page();
    toAtelier();
    const desk = screen.getByRole('link', { name: /Bureau de Ledge/ });
    expect(desk).toHaveAttribute('href', '#/chat');
    expect(desk).toHaveTextContent('Parler à Ledge · Je veille sur 6 agents.');
  });

  it('a tablet keeps its drawn Atelier: no « Liste · Atelier » in the list', () => {
    wide(true);
    page();
    expect(screen.queryByRole('group', { name: 'Affichage des sessions' })).toBeNull();
  });
});

describe('the long press (§8)', () => {
  const press = (el: HTMLElement) => {
    fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(el);
    // The click the lift sends is cancelled: the seat's link does not also open the thread.
    expect(fireEvent.click(el)).toBe(false);
  };

  it('on a rig\'s seat: its actions, led by « Ouvrir le fil » and « Ouvrir le terminal », its seat named; the tap that ends it opens nothing', () => {
    vi.useFakeTimers();
    location.hash = '#/sessions';
    page();
    toAtelier();
    const seat = within(screen.getByRole('region', { name: 'Rig ledge-dev' })).getByRole('link', { name: 'Session de dev-front' });
    press(seat);
    expect(location.hash).toBe('#/sessions');
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('dev-frontsiège dev.front · ledge-dev');
    expect(within(sheet).getAllByRole('button').slice(0, 3).map(b => b.textContent)).toEqual(['Ouvrir le fil', 'Ouvrir le terminal de dev-front', expect.stringContaining('Modèle et effort')]);
    expect(within(sheet).queryByText(/Redémarrer/)).toBeNull();
    expect(seat.className).toContain('shadow-');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ouvrir le terminal de dev-front' }));
    expect(location.hash).toBe('#/terminal/front');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on a row of the list too, a session out of a rig named by its project; a short tap still opens the thread', () => {
    vi.useFakeTimers();
    page();
    const row = within(screen.getByRole('region', { name: 'synapse' })).getAllByRole('link')[0]!;
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 100); });
    fireEvent.pointerUp(row);
    expect(fireEvent.click(row)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    press(row);
    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent(/^OMTomsynapse$/);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le fil' }));
    expect(location.hash).toBe('#/thread/tom');
  });

  it('a finger that moves scrolls, and opens nothing', () => {
    vi.useFakeTimers();
    page();
    const row = within(screen.getByRole('region', { name: 'synapse' })).getAllByRole('link')[0]!;
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 10, clientY: 40 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
