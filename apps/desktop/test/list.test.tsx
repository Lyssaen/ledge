import { readFileSync } from 'node:fs';
import type { Filing } from '../src/atelier/filing';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { projectOf } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { LangProvider } from '../src/i18n/lang';
import type { Decisions } from '../src/fleet/decisions';
import { List } from '../src/list/List';
import { mainOrder } from '../src/nav/agents';
import { initialNav } from '../src/nav/state';
import { LIST_KEY, loadListPrefs } from '../src/list/prefs';
import { OBSOLETE_KEYS } from '../src/state/obsolete';
import { boot, closeDaemons, declarations, listSessions, PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const rowsOf = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('listitem').map(r => r.getAttribute('aria-label')!.split(',')[0]);
const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const head = (name: string) => within(document.querySelector<HTMLElement>(`.lgroup[aria-label="${name}"] .lgroup-head`)!);
const decisions: Decisions = { busy: () => false, landed: null, decide: () => false };
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Filter by state' })).getByRole('button', { name });

/** A filing that never drags. */
const idle: Filing = { dragging: null, over: null, seated: null, dragProps: () => ({ draggable: true, onDragStart() {}, onDragEnd() {} }), dropProps: () => ({ onDragOver() {}, onDragLeave() {}, onDrop() {} }), file() {} };

describe('the List', () => {
  it('groups by project, Sans projet last, what waits first in its group, with its stripe', async () => {
    await boot({ sessions: listSessions(), list: true });
    expect([...document.querySelectorAll('.lgroup')].map(g => g.getAttribute('aria-label'))).toEqual(['Ledge', 'Payment Service Platform Migration Europe', 'No project']);
    expect(rowsOf('Ledge')).toEqual(['Otto', 'Bix', 'Rio']);
    expect(row('Otto')).toHaveClass('b-decide', 's-approval');
    expect(row('Kit')).toHaveClass('b-decide', 's-question');
    expect(screen.queryByText('This screen is coming soon.')).toBeNull();
  });
  it('a row: task with its repo, badge, machine, activity; never the harness', async () => {
    await boot({ sessions: listSessions(), list: true });
    const otto = row('Otto');
    expect(otto.querySelector('.r-repo')).toHaveTextContent('ledge');
    expect(within(otto).getByText('Approval')).toHaveAttribute('data-badge', 'approval');
    expect(otto.querySelector('.r-ctx')).toHaveTextContent('Local');
    expect(otto.querySelector('.r-when')).toHaveTextContent('for 12 min');
    expect(otto.querySelector('.r-when')).toHaveClass('waiting');
    expect(row('Nova').querySelector('.r-when')).toHaveTextContent('3 min ago');
    expect(row('Bix').querySelector('.r-when')).toHaveTextContent('1 h ago');
    expect(row('Rio').querySelector('.r-when')).toHaveAttribute('title', 'Last seen 3 d ago');
    expect(within(row('Rio')).getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
    expect(row('Kit').querySelector('.r-when')).toHaveTextContent('just now');
    expect(document.querySelector('.list-view')).not.toHaveTextContent(/Codex|Claude Code|Cursor Agent/);
  });
  it('a group header: count, what waits, branch; collapsed it stays collapsed through updates; its name filters', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    expect(head('Ledge').getByText('3')).toHaveClass('g-count');
    expect(head('Ledge').getByText('1 to decide')).toHaveClass('g-alert');
    expect(head('Ledge').getByText('1 done · 1 offline')).toBeVisible();
    expect(head('Ledge').getByText('⎇ desktop')).toBeVisible();
    await user.click(head('Ledge').getByRole('button', { name: 'Collapse Ledge' }));
    expect(screen.queryByRole('listitem', { name: /^Otto,/ })).toBeNull();
    d.upsert(fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'working' }));
    await waitFor(() => expect(head('Ledge').getByText('1 running · 1 offline')).toBeVisible());
    expect(head('Ledge').getByRole('button', { name: 'Expand Ledge' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem', { name: /^Otto,/ })).toBeNull();
    await user.click(head('Ledge').getByRole('button', { name: 'Ledge' }));
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });
  it('subagents: a quiet count beside the parent, folded unless one waits, a click folds them back; the top bar toggle hides them', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    expect(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem', { name: /subagent of Otto/ })).toBeNull();
    d.upsert({ ...listSessions()[0]!, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'waiting_permission' }] });
    const kid = await screen.findByRole('listitem', { name: 'Explore, subagent of Otto: Lire le code' });
    expect(kid).toHaveClass('child', 'last', 'b-decide');
    await user.click(within(row('Otto')).getByRole('button', { name: 'Hide 1 subagent' }));
    expect(screen.queryByRole('listitem', { name: /subagent of Otto/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
    expect(within(row('Otto')).queryByRole('button', { name: /subagent/ })).toBeNull();
  });
  it('the text filter marks its match; chips count under it and narrow the rows; n/total in the header', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    expect(chip(/^All/)).toHaveTextContent('All5');
    expect(chip(/^To decide/)).toHaveTextContent('To decide2');
    expect(chip(/^Offline/)).toHaveTextContent('Offline1');
    await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'nov');
    expect(within(row('Nova')).getByText('Nov', { selector: 'mark' })).toBeVisible();
    expect(chip(/^All/)).toHaveTextContent('All1');
    expect(chip(/^To decide/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear the filter' }));
    await user.click(chip(/^To decide/));
    expect(chip(/^To decide/)).toHaveAttribute('aria-pressed', 'true');
    expect(rowsOf('Ledge')).toEqual(['Otto']);
    expect(head('Ledge').getByText('1/3')).toHaveClass('g-count');
  });
  it('filters combined down to nothing: the empty state names them, Clear keeps the project filter, the chosen chip stays', async () => {
    const { side, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'zzz');
    expect(screen.getByRole('heading', { name: 'No session matches' })).toBeVisible();
    expect(screen.getByText('Nothing for “zzz”.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(rowsOf('Ledge')).toEqual(['Otto', 'Bix', 'Rio']);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    await user.click(chip(/^To decide/));
    await user.click(side.getByRole('button', { name: /^Payment/ }));
    expect(screen.getByText('Nothing among the “to decide” sessions.')).toBeVisible();
    expect(chip(/^To decide/)).toBeEnabled();
    expect(chip(/^To decide/)).toHaveTextContent('To decide0');
  });
  it('an empty project offers a session there; no session at all offers one too', async () => {
    const { side, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(side.getByRole('button', { name: /^Docs/ }));
    expect(screen.getByRole('heading', { name: 'No session in Docs' })).toBeVisible();
    expect(screen.getByText('The project will fill as soon as a session starts in docs.')).toBeVisible();
    await user.click(within(document.querySelector<HTMLElement>('.list-empty')!).getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    cleanup(); await closeDaemons();
    await boot({ sessions: [], list: true });
    expect(screen.getByRole('heading', { name: 'No session' })).toBeVisible();
    expect(screen.getByText('Start a session to see it here.')).toBeVisible();
  });
  it('+ New session on a project group only', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    expect(head('No project').queryByRole('button', { name: /^New session in/ })).toBeNull();
    await user.click(head('Ledge').getByRole('button', { name: 'New session in Ledge' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Machine' }));
    expect(screen.queryAllByRole('button', { name: /^New session in/ })).toHaveLength(0);
  });
  it('grouping and density are remembered; the filter and the chip are not', async () => {
    const { view, client, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(screen.getByRole('radio', { name: 'State' }));
    expect([...document.querySelectorAll('.lgroup')].map(g => g.getAttribute('aria-label'))).toEqual(['To decide', 'Running', 'Done', 'Offline']);
    await user.click(screen.getByRole('button', { name: 'Compact rows' }));
    await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'otto');
    expect(JSON.parse(localStorage.getItem('desktop.list')!)).toEqual({ group: 'state', density: 'tight' });
    view.unmount();
    render(<App client={client} />);
    expect(await screen.findByRole('radio', { name: 'State' })).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('.list-view')).toHaveClass('density-tight');
    expect(screen.getByRole('textbox', { name: 'Filter the sessions' })).toHaveValue('');
  });
  it('prefs are read field by field, and the key is new', () => {
    expect(loadListPrefs()).toEqual({ group: 'project', density: 'comfy' });
    localStorage.setItem(LIST_KEY, JSON.stringify({ group: 'state', density: 'dense' }));
    expect(loadListPrefs()).toEqual({ group: 'state', density: 'comfy' });
    localStorage.setItem(LIST_KEY, '{oops');
    expect(loadListPrefs()).toEqual({ group: 'project', density: 'comfy' });
    expect(OBSOLETE_KEYS).not.toContain(LIST_KEY);
  });
  it('the styles port the mockup: a sticky toolbar, sticky headers under it, a narrow layout under 780 px', () => {
    expect(declarations('list.css', '.list-toolbar')).toContain('position:sticky;top:0;z-index:6');
    expect(declarations('list.css', '.lgroup-head')).toContain('position:sticky;top:var(--toolbar-h);z-index:4');
    expect(declarations('list.css', '.list-view')).toContain('container-type:inline-size');
    expect(readFileSync(resolve(__dirname, '../src/styles/list.css'), 'utf8')).toMatch(/@container \(max-width:780px\)\{/);
  });

  // Beyond the brief: the review ledger's carried items and the brief's other rules.
  it('a chosen chip stays pressed at 0, a second click on it goes back to All; Offline shows only when it counts or is chosen', async () => {
    const { side, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(chip(/^To decide/));
    await user.click(side.getByRole('button', { name: /^Payment/ }));
    expect(chip(/^To decide/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByRole('group', { name: 'Filter by state' })).queryByRole('button', { name: /^Offline/ })).toBeNull();   // Nova only: no offline
    await user.click(chip(/^To decide/));
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^To decide/)).toBeDisabled();
    expect(rowsOf('Payment Service Platform Migration Europe')).toEqual(['Nova']);
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await user.click(chip(/^Offline/));
    await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'otto');
    expect(chip(/^Offline/)).toHaveAttribute('aria-pressed', 'true');                // chosen at 0: still there, still pressed
    expect(chip(/^Offline/)).toHaveTextContent('Offline0');
    expect(screen.getByText('Nothing for “otto” among the “offline” sessions.')).toBeVisible();
  });
  it('a wait keeps its start when the session refreshes its activity during the same request', async () => {
    const { d } = await boot({ sessions: listSessions(), list: true });
    const otto = listSessions()[0]!;
    d.upsert({ ...otto, lastActivityAt: new Date().toISOString(), topic: 'Câbler la liste encore' });
    await waitFor(() => expect(row('Otto').querySelector('.r-title')).toHaveTextContent('Câbler la liste encore'));
    expect(row('Otto').querySelector('.r-when')).toHaveTextContent('for 12 min');
    expect(row('Otto').querySelector('.r-when')).toHaveAttribute('title', 'Waiting for 12 min');
  });
  it('a click on a row opens its session; a subagent opens its parent; the kids chip does not open', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('listitem', { name: 'Explore, subagent of Otto: Lire le code' }));
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
    cleanup(); await closeDaemons();
    const again = await boot({ sessions: listSessions(), list: true });
    await again.user.click(row('Nova').querySelector<HTMLElement>('.r-title')!);
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
  });
  it('by state: the project before the repo, the subagents still under their parent; by machine: the project in the context column', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(screen.getByRole('radio', { name: 'State' }));
    expect(row('Otto').querySelector('.r-repo')).toHaveTextContent('Ledge·ledge');
    expect(row('Kit').querySelector('.r-repo')).toHaveTextContent('No project·tmp');
    expect(head('To decide').queryByText(/to decide/)).toBeNull();                    // no summary by state
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    expect(rowsOf('To decide')).toEqual(['Otto', 'Explore', 'Kit']);
    await user.click(screen.getByRole('radio', { name: 'Machine' }));
    expect(screen.getByRole('radio', { name: 'Machine' })).toHaveAttribute('aria-checked', 'true');
    expect(row('Nova').querySelector('.r-ctx')).toHaveTextContent('Payment Service Platform Migration Europe');
    expect(row('Kit').querySelector('.r-ctx')).toHaveTextContent('No project');
    expect([...document.querySelectorAll('.lgroup')].map(g => g.getAttribute('aria-label'))).toEqual(['Local']);
  });
  it('the density toggle names the density it would give, and is pressed when compact', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    const toggle = screen.getByRole('button', { name: 'Compact rows' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('title', 'Compact rows');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Comfortable rows' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.list-view')).toHaveClass('density-tight', 'group-project');
  });
  it('the toolbar height follows a ResizeObserver into --toolbar-h', async () => {
    const watched: [ResizeObserverCallback, Element][] = [];
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) { watched.push([this.cb, el]); }
      unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      await boot({ sessions: listSessions(), list: true });
      const bar = document.querySelector<HTMLElement>('.list-toolbar')!;
      Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 88 });
      const mine = watched.filter(([, el]) => el === bar);
      expect(mine).toHaveLength(1);
      for (const [cb] of mine) cb([], {} as ResizeObserver);
      expect(document.querySelector<HTMLElement>('.list-view')!.style.getPropertyValue('--toolbar-h')).toBe('88px');
    } finally { globalThis.ResizeObserver = Real; }
  });
  it('in French: the footnote, the « Sans projet » help, the tallies, the row label; the header buttons dispatch', async () => {
    const dispatch = vi.fn();
    const order = mainOrder(listSessions().map(x => ({ ...x, machineId: 'local', machineName: 'Local' })), PROJECTS);
    const user = userEvent.setup();
    render(
      <LangProvider lang="fr">
        <List nav={initialNav({ view: 'list', helpers: true, paused: false })} dispatch={dispatch} order={order} projects={PROJECTS}
          projectIdOf={x => projectOf(x, PROJECTS)} machines={[]} decisions={decisions} filing={idle} />
      </LangProvider>
    );
    expect(document.querySelector('.list-foot')).toHaveTextContent('JK parcourir · Entrée ouvrir · F filtrer · les demandes en attente passent en tête de chaque groupe.');
    expect(head('Sans projet').getByText('Glissez vers un projet, ou « Ranger dans… ».')).toHaveClass('g-help');
    expect(head('Ledge').getByText('1 terminé · 1 hors ligne')).toBeVisible();
    expect(head('Ledge').getByText('1 à décider')).toHaveClass('g-alert');
    expect(head('Ledge').getByText('⎇ desktop')).toHaveAttribute('title', 'Branche desktop');
    expect(row('Otto')).toHaveAttribute('aria-label', 'Otto, Câbler la liste, à décider, Local');
    expect(within(row('Otto')).getByRole('button', { name: 'Afficher 1 sous-agent' })).toHaveAttribute('title', '1 sous-agent');
    expect(screen.getByRole('textbox', { name: 'Filtrer les sessions' })).toHaveAttribute('placeholder', 'Agent, tâche, machine, dépôt…');
    expect(within(row('Otto')).getByRole('button', { name: 'Autoriser' })).toBeEnabled();
    expect(within(row('Otto')).getByRole('button', { name: 'Refuser' })).toBeEnabled();
    expect(within(row('Kit')).getByRole('button', { name: 'Répondre' })).toBeEnabled();
    expect(within(row('Nova')).getByRole('button', { name: 'Ouvrir Entrée' })).toHaveAttribute('title', 'Ouvrir la session (Entrée)');
    await user.click(head('Ledge').getByRole('button', { name: 'Ledge' }));
    expect(head('Ledge').getByRole('button', { name: 'Ledge' })).toHaveAttribute('title', 'Voir seulement Ledge');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'home', project: 'ledge' });
    await user.click(head('Ledge').getByRole('button', { name: 'Nouvelle session dans Ledge' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'modal', modal: { kind: 'launch', project: 'ledge' } });
    await user.click(row('Nova'));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'open', id: 'nova' });
  });
  it('no session at all: New session launches without a project', async () => {
    const dispatch = vi.fn();
    render(<List nav={initialNav({ view: 'list', helpers: true, paused: false })} dispatch={dispatch} order={[]} projects={PROJECTS} projectIdOf={x => projectOf(x, PROJECTS)} machines={[]} decisions={decisions} filing={idle} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'New session' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'modal', modal: { kind: 'launch' } });
  });
});
