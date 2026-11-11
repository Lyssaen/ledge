import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sessions } from '../../src/screens/Sessions';
import { pending, session } from '../model/fixtures';
import { MemoryStorage, snapshot } from '../state/helpers';
import { setup } from './setup';

afterEach(() => { localStorage.clear(); });

const ctx = (pct: number) => ({ used: pct * 1000, window: 100_000, at: '2026-10-14T10:00:00.000Z' });
const fleet = () => snapshot([
  session('nova', { name: 'Nova', tool: 'codex', project: 'ledge', branch: 'fix/term-webgl', state: 'working', context: ctx(38), doing: { tool: 'Bash', label: 'pnpm --filter desktop test term', since: '2026-10-14T10:00:00.000Z' } }),
  session('pim', { name: 'Pim', project: 'ledge', branch: 'feat/ide-shell', state: 'waiting_permission', pending: pending({ key: 'kp' }),
    helpers: [{ id: 'h1', kind: 'Explore', task: 'a', state: 'working' }, { id: 'h2', kind: 'Explore', task: 'b', state: 'working' }, { id: 'h3', kind: 'Explore', task: 'c', state: 'exited', finishedAt: '2026-10-14T10:00:00.000Z' }] }),
  session('ida', { name: 'Ida', project: 'ledge', branch: 'mockup', context: ctx(21) }),
  session('lou', { name: 'Lou', project: 'synapse', state: 'exited', exitedAt: new Date().toISOString() }),
  session('tom', { name: 'Tom', tool: 'omp', project: 'synapse', branch: 'main', context: ctx(12) }),
  session('lead', { name: 'lead', project: 'ledge', state: 'working', rig: { name: 'ledge-dev', role: 'orchestrateur' }, context: ctx(44) })
]);
const rows = (region: string) => within(screen.getByRole('region', { name: region })).getAllByRole('link');

/** The sessions' rows, without « Nouvelle » in the head (§1). */
const rowLinks = () => screen.getAllByRole('link').filter(a => a.getAttribute('href') !== '#/new');

describe('Sessions (m2-sessions.html §1)', () => {
  it('groups by project then by rig, those waiting first and the ended last, each row opening its thread', () => {
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['ledge', 'synapse', 'Rig ledge-dev']);
    expect(rows('ledge').map(a => a.getAttribute('href'))).toEqual(['#/thread/pim', '#/thread/nova', '#/thread/ida']);
    expect(rows('synapse').map(a => a.getAttribute('href'))).toEqual(['#/thread/tom', '#/thread/lou']);
    expect(rows('Rig ledge-dev')).toHaveLength(1);
  });

  it('a row says the state and the context, the branch\'s last part or the seat\'s role, and the sub-agents at work', () => {
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    const [pim, nova, ida] = rows('ledge');
    expect(pim).toHaveTextContent('Pim+2autorisation demandéeide-shell');
    expect(within(pim!).getByLabelText('2 sous-agents au travail')).toBeInTheDocument();
    expect(nova).toHaveTextContent('au travail · 38 %term-webgl');
    expect(ida).toHaveTextContent('disponible · 21 %mockup');
    expect(rows('synapse')[1]).toHaveTextContent(/terminée à \d\d:\d\d/);
    expect(rows('Rig ledge-dev')[0]).toHaveTextContent('au travail · 44 %orchestrateur');
  });

  it('filters: « En attente », « Au travail » with what it does and its context; the counts on each', () => {
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    const bar = screen.getByRole('group', { name: 'Filtrer les sessions' });
    expect(within(bar).getAllByRole('button').map(b => b.textContent)).toEqual(['Toutes6', 'En attente1', 'Au travail2']);
    fireEvent.click(within(bar).getByRole('button', { name: /En attente/ }));
    expect(rowLinks().map(a => a.getAttribute('href'))).toEqual(['#/thread/pim']);
    fireEvent.click(within(bar).getByRole('button', { name: /Au travail/ }));
    expect(rows('ledge')[0]).toHaveTextContent('pnpm --filter desktop test term38 %');
    expect(screen.queryByText(/Lou|Tom/)).toBeNull();
  });

  it('keeps the filter on the device; « Voir les N autres » opens it on « Au travail »', () => {
    const storage = new MemoryStorage();
    const t = setup();
    t.deliver(fleet());
    const { unmount } = render(<Sessions store={t.store} storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: /En attente/ }));
    unmount();
    render(<Sessions store={t.store} storage={storage} />);
    expect(screen.getByRole('button', { name: /En attente/ })).toHaveAttribute('aria-pressed', 'true');
    document.body.innerHTML = '';
    render(<Sessions store={t.store} storage={storage} filter="working" />);
    expect(screen.getByRole('button', { name: /Au travail/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('an empty filter says so and leads on (§1, Q70)', () => {
    const t = setup();
    t.deliver(snapshot([session('w', { name: 'W', state: 'working' }), session('i', { name: 'I' })]));
    render(<Sessions store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: /En attente/ }));
    expect(screen.getByText('Rien ne t’attend.')).toBeInTheDocument();
    expect(screen.getByText('Aucune session ne demande ta décision. 1 est au travail.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir toutes' }));
    expect(rowLinks()).toHaveLength(2);

    act(() => t.deliver(snapshot([session('p', { name: 'P', state: 'waiting_permission', pending: pending() }), session('i', { name: 'I' })])));
    fireEvent.click(screen.getByRole('button', { name: /Au travail/ }));
    expect(screen.getByText('Aucune session n’est au travail.')).toBeInTheDocument();
    expect(screen.getByText('1 attend ta décision.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir en attente' }));
    expect(screen.getByRole('button', { name: /En attente/ })).toHaveAttribute('aria-pressed', 'true');

    act(() => t.deliver(snapshot([session('i', { name: 'I' })])));
    fireEvent.click(screen.getByRole('button', { name: /Au travail/ }));
    expect(screen.getByText('Elles sont toutes disponibles ou terminées.')).toBeInTheDocument();
  });

  it('no session at all: the empty tab', () => {
    const t = setup();
    t.deliver(snapshot([]));
    render(<Sessions store={t.store} />);
    expect(screen.getByRole('heading', { name: 'Aucune session sur ce PC' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtrer les sessions' })).toBeNull();
  });
});
