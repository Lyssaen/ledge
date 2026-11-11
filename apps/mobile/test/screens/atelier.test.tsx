// The Atelier on iPad (docs/mockups/ledge-ipad-atelier.html): its fit, its route, what the store keeps of the PC's projects,
// its tab (a wide screen and a PC that offers it), its rooms and what a tap opens.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PhoneProject, PhoneServerMessage, PhoneSession } from '@ledge/protocol';
import { AtelierScreen } from '../../src/atelier/AtelierScreen';
import { IPAD_READ, ipadFit, phoneBotState } from '../../src/atelier/fit';
import { resetIpadView } from '../../src/atelier/useIpadView';
import { copy } from '../../src/copy';
import { href, parseRoute } from '../../src/router';
import { App } from '../../src/App';
import { ShellProvider } from '../../src/shell/Shell';
import { meStub } from './app-setup';
import { createStore } from '../../src/state/store';
import { pending, session } from '../model/fixtures';
import { fakeLink, MemoryStorage, snapshot } from '../state/helpers';
import { setup } from './setup';

const projects: PhoneProject[] = [{ id: 'ledge', name: 'Ledge', color: 'blue' }, { id: 'website', name: 'Website', color: 'green' }];
/** A PC with the Atelier: `daemon.atelier` and its projects. */
const atelier = (sessions: PhoneSession[], list: PhoneProject[] = projects): PhoneServerMessage => {
  const m = snapshot(sessions);
  return m.type === 'snapshot' ? { ...m, daemon: { ...m.daemon, atelier: true, broadcast: true }, projects: list } : m;
};
const sessions = [
  session('otto', { name: 'Otto', projectId: 'ledge', project: 'ledge', topic: 'Préparer la 0.42', state: 'waiting_permission', pending: pending() }),
  session('nova', { name: 'Nova', projectId: 'ledge', project: 'ledge', topic: 'Reconnexion SSH', state: 'working', helpers: [{ id: 'n1', kind: 'Explore', task: 'Lire le code SSH', state: 'working' }] as PhoneSession['helpers'] }),
  session('luna', { name: 'Luna', projectId: 'website', project: 'website', topic: 'Page d’accueil', state: 'waiting_input' }),
  session('mia', { name: 'Mia', tool: 'omp', project: 'ledge', projectId: 'ledge', state: 'idle', rig: { name: 'dev-omp', role: 'design.maquettiste' } }),
  session('kit', { name: 'Kit', project: 'proxy-essais', topic: 'Essais du proxy' }),
  // An id the PC no longer lists (a project just removed): « Sans projet ».
  session('old', { name: 'Old', project: 'gone', projectId: 'removed', topic: 'Ancien projet' })
];

const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
beforeEach(() => { resetIpadView(); globalThis.location.hash = '#/atelier'; });
afterEach(() => { wide(false); });

describe('the iPad fit', () => {
  it('shows a whole room across the short side, never above 100 % nor under 11/12', () => {
    // Landscape: the room's height decides; the rooms run in a row.
    expect(ipadFit([{ w: 900, h: 700 }], { width: 1100, height: 760 }, 'land')).toEqual({ zoom: (760 - 4) / (700 + 56 + 34), along: 'row' });
    // Portrait: its width; a column.
    expect(ipadFit([{ w: 700, h: 700 }, { w: 760, h: 600 }], { width: 740, height: 1100 }, 'port')).toEqual({ zoom: (740 - 4) / (760 + 24), along: 'column' });
    expect(ipadFit([{ w: 400, h: 300 }], { width: 1100, height: 760 }, 'land').zoom).toBe(1);
    expect(ipadFit([{ w: 900, h: 1400 }], { width: 1100, height: 760 }, 'land').zoom).toBe(IPAD_READ);
    expect(ipadFit([], { width: 1100, height: 760 }, 'land').zoom).toBe(1);
  });

  it('draws a resting parent whose sub-agent works as working, as Desktop does', () => {
    expect(phoneBotState({ state: 'idle', helpers: [{ id: 'h', kind: 'Explore', task: 't', state: 'working' }] as PhoneSession['helpers'] })).toBe('working');
    expect(phoneBotState({ state: 'idle', helpers: [] })).toBe('idle');
    expect(phoneBotState({ state: 'waiting_input', helpers: [] })).toBe('question');
  });
});

describe('the Atelier route', () => {
  it('is `#/atelier`, and `#/atelier/<id>` with a session open in its panel', () => {
    expect(parseRoute('#/atelier')).toEqual({ name: 'atelier' });
    expect(parseRoute('#/atelier/a%2Fb')).toEqual({ name: 'atelier', sessionId: 'a/b' });
    expect(href({ name: 'atelier' })).toBe('#/atelier');
    expect(href({ name: 'atelier', sessionId: 'a/b' })).toBe('#/atelier/a%2Fb');
    expect(parseRoute('#/atelier/otto/request/p%201')).toEqual({ name: 'atelier', sessionId: 'otto', requestKey: 'p 1' });
    expect(href({ name: 'atelier', sessionId: 'otto', requestKey: 'p 1' })).toBe('#/atelier/otto/request/p%201');
  });
});

describe('the store and the PC’s projects', () => {
  it('keeps the projects of the snapshot, then each `projects` list whole; an older PC has none', () => {
    const t = setup();
    t.deliver(atelier(sessions));
    expect(t.store.getState().daemon?.atelier).toBe(true);
    expect(t.store.getState().projects).toEqual(projects);
    act(() => t.deliver({ type: 'projects', projects: [projects[1]!] }));
    expect(t.store.getState().projects).toEqual([projects[1]]);
    t.deliver(snapshot(sessions));
    expect(t.store.getState().projects).toEqual([]);
    expect(t.store.getState().daemon?.atelier).toBeUndefined();
  });

  it('keeps them for a cold start offline, the Atelier with them', () => {
    const storage = new MemoryStorage();
    const f = fakeLink('ready');
    const first = createStore(f.link, storage);
    f.deliver(atelier(sessions));
    first.close();
    const again = createStore(fakeLink('pc_offline').link, storage);
    expect(again.getState()).toMatchObject({ fresh: false, projects, daemon: { atelier: true } });
    expect(again.getState().sessions.get('mia')?.rig).toEqual({ name: 'dev-omp', role: 'design.maquettiste' });
    again.close();
  });
});

describe('the Atelier tab', () => {
  it('follows Rigs in the rail on a wide screen with a PC that offers it, never on a phone nor with an older PC', () => {
    globalThis.history.replaceState(null, '', '/#/sessions');
    const t = setup();
    t.deliver(atelier(sessions));
    wide(true);
    const { unmount } = render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
    const nav = () => screen.getByRole('navigation', { name: copy.nav.label });
    expect(within(nav()).getAllByRole('link').map(a => a.textContent?.replace(/\d+$/, ''))).toEqual([copy.nav.atoi, copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.atelier, copy.nav.chat, copy.nav.settings]);
    expect(within(nav()).getByRole('link', { name: copy.nav.atelier })).toHaveAttribute('href', '#/atelier');
    unmount();
    wide(false);
    const phone = render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
    expect(within(nav()).queryByRole('link', { name: copy.nav.atelier })).toBeNull();
    phone.unmount();
    wide(true);
    act(() => t.deliver(snapshot(sessions)));
    render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
    expect(within(nav()).queryByRole('link', { name: copy.nav.atelier })).toBeNull();
  });
});

describe('the Atelier screen', () => {
  const open = (sessionId?: string, requestKey?: string) => {
    const t = setup();
    t.deliver(atelier(sessions));
    wide(true);
    const r = render(<AtelierScreen store={t.store} {...(sessionId ? { sessionId } : {})} {...(requestKey ? { requestKey } : {})} />);
    return { ...t, ...r };
  };

  it('draws a room per project and per rig, « Sans projet » after them, and counts them in its head', () => {
    const { container } = open();
    expect([...container.querySelectorAll('.atelier-room')].map(r => r.getAttribute('data-room'))).toEqual(['ledge', 'website', 'rig:dev-omp']);
    expect(container.querySelector('.rig-room .plaque-where')?.textContent).toBe('rig · ledge · projet Ledge');
    expect([...container.querySelectorAll('.unassigned-zone [data-agent]')].map(a => a.getAttribute('data-agent'))).toEqual(['kit', 'old']);
    expect(container.querySelector('.unassigned-zone')?.textContent).toContain(copy.atelier.unassignedHint);
    // « Sans projet » is no room.
    expect(screen.getByText(copy.atelier.subtitle(6, 3, 2))).toBeInTheDocument();
    expect(container.querySelectorAll('.helper-seat')).toHaveLength(1);
    // No keyboard shortcut, no menu, no drag on iPad.
    expect(container.querySelector('.seat-shortcut, .seat-more, .plaque-btn, .zoom-hint, kbd, [draggable]')).toBeNull();
    expect(screen.getByRole('button', { name: copy.atelier.desk }).textContent).toContain('Je veille sur 6 agents.');
  });

  it('a seat opens its session in the panel; a sub-agent its parent’s; another seat changes the panel in place', () => {
    const { container } = open();
    fireEvent.click(container.querySelector('[data-agent="otto"]')!);
    expect(globalThis.location.hash).toBe('#/atelier/otto');
    fireEvent.click(container.querySelector('.helper-seat')!);
    expect(globalThis.location.hash).toBe('#/atelier/nova');
  });

  it('the panel is the thread, with « Plein écran » and ×, and an OMP seat’s terminal instead of a thread', () => {
    const t = open('otto');
    const panel = screen.getByRole('complementary', { name: copy.atelier.session('Otto') });
    expect(within(panel).getByText('Otto', { selector: 'b' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: copy.atelier.fullScreen })).toHaveAttribute('href', '#/thread/otto');
    expect(within(panel).queryByRole('link', { name: copy.nav.backTo.sessions! })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: copy.atelier.closePanel }));
    expect(globalThis.location.hash).toBe('#/atelier');
    t.unmount();
    open('mia');
    const omp = screen.getByRole('complementary', { name: copy.atelier.session('Mia') });
    expect(within(omp).getByRole('heading', { name: copy.atelier.ompNoThread })).toBeInTheDocument();
    expect(within(omp).getByRole('link', { name: copy.atelier.ompTerminal })).toHaveAttribute('href', '#/terminal/mia');
    expect(within(omp).queryByRole('button', { name: copy.sessionEnd.close('Mia') })).toBeNull();
  });

  it('the thread’s request opens in the panel; « Retour au fil » and a decision applied give the thread back', () => {
    const t = open('otto');
    const panel = () => screen.getByRole('complementary', { name: copy.atelier.session('Otto') });
    expect(within(panel()).getByText(copy.atelier.awaiting, { exact: true })).toBeInTheDocument();
    expect(within(panel()).getByRole('link', { name: copy.thread.examine })).toHaveAttribute('href', '#/atelier/otto/request/p1');
    t.unmount();
    const r = open('otto', 'p1');
    // The way back to the thread stays in the panel, the footer's too.
    expect(within(panel()).getByRole('link', { name: copy.result.thread('Otto') })).toHaveAttribute('href', '#/atelier/otto');
    fireEvent.click(within(panel()).getByRole('button', { name: copy.nav.backTo.thread! }));
    expect(globalThis.location.hash).toBe('#/atelier/otto');
    globalThis.location.hash = '#/atelier/otto/request/p1';
    fireEvent.click(within(panel()).getByRole('button', { name: copy.decide.allow }));
    const decide = r.of('session.decide').at(-1)!;
    expect(decide).toMatchObject({ id: 'otto', decision: 'accept' });
    // Sent, not applied yet: the request stays.
    expect(globalThis.location.hash).toBe('#/atelier/otto/request/p1');
    act(() => {
      r.deliver({ type: 'operation.result', op: decide.op, status: 'applied' });
      r.deliver({ type: 'session.updated', session: { ...sessions[0]!, pending: undefined, state: 'working' } });
    });
    expect(globalThis.location.hash).toBe('#/atelier/otto');
  });

  it('offline, a request gone is not said handled: the panel stays on it', () => {
    const t = setup();
    t.deliver(atelier(sessions));
    act(() => t.set('pc_offline'));
    wide(true);
    globalThis.location.hash = '#/atelier/luna/request/zz';
    render(<AtelierScreen store={t.store} sessionId="luna" requestKey="zz" />);
    expect(globalThis.location.hash).toBe('#/atelier/luna/request/zz');
    expect(screen.getByRole('button', { name: copy.nav.backTo.thread! })).toBeInTheDocument();
  });

  it('a room’s name opens its sheet: its agents, « Écrire au groupe » to the live ones', async () => {
    const t = open();
    fireEvent.click(screen.getAllByRole('button', { name: copy.atelier.roomMenu('Website') })[0]!);
    const sheet = screen.getByRole('complementary', { name: copy.atelier.room('Website') });
    expect(within(sheet).getByText(copy.atelier.roomAgents(1))).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: copy.agents.writeGroup }));
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Le point ?' } });
    fireEvent.click(within(sheet).getByRole('button', { name: copy.agents.send }));
    expect(t.sent.at(-1)).toMatchObject({ type: 'session.broadcast', sessions: ['luna'], text: 'Le point ?' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Luna/ }));
    expect(globalThis.location.hash).toBe('#/atelier/luna');
  });

  it('offline: the last known state, the bots frozen, a note above', () => {
    const t = setup();
    t.deliver(atelier(sessions));
    act(() => t.set('pc_offline'));
    wide(true);
    const { container } = render(<ShellProvider value={{ pc: 'WSL', look: 'offline', reach: 'pc_offline', since: '14:02', retry: () => {} }}><AtelierScreen store={t.store} /></ShellProvider>);
    expect(screen.getByText(new RegExp(`^${copy.agents.offline} · `))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(copy.offline.title('WSL'));
    expect(container.querySelector('.atelier-frozen .office-shell.office-paused')).not.toBeNull();
  });
});
