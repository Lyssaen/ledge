import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, declarations, listSessions } from './helpers';
import { App } from '../src/App';
import { loadSessionPrefs, SESSION_KEY } from '../src/session/prefs';
import { OBSOLETE_KEYS } from '../src/state/obsolete';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));
const tree = () => within(screen.getByRole('tree', { name: 'Projects, branches and sessions' }));
async function openOtto() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
  await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
  return env;
}
/** Otto's subagent, from the sidebar tree: it unfolds Otto, then opens Explore. */
async function openExplore(user: Awaited<ReturnType<typeof openOtto>>['user']) {
  await user.click(tree().getByRole('button', { name: /Show Otto.s subagents/ }));
  await user.click(await tree().findByRole('button', { name: /^Explore/ }));
}

describe('the session place, the subagent page, the terminal', () => {
  it("no rail of the project's agents beside the thread: the sidebar tree switches agent", async () => {
    const { user } = await openOtto();
    expect(screen.queryByRole('navigation', { name: /^Agents of the project/ })).toBeNull();
    expect(document.querySelector('.project-rail')).toBeNull();
    await user.click(tree().getByRole('button', { name: /^Nova/ }));
    expect(banner().getByText('Nova')).toBeVisible();
  });

  it('an empty task leaves no lone « · » in the crumb', async () => {
    const sessions = listSessions().map(s => (s.name === 'Otto' ? { ...s, topic: '', title: '' } : s));
    const { user } = await boot({ sessions, list: true });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
    expect(screen.getByRole('banner').querySelector('.crumb-task')).toBeNull();
  });

  it("a subagent's page: the parent in the breadcrumb, which opens it back", async () => {
    const { user } = await openOtto();
    await openExplore(user);
    expect(banner().getByText('Explore')).toBeVisible();
    expect(banner().getByText('Lire le code')).toHaveClass('crumb-task');
    await user.click(banner().getByRole('button', { name: /Otto/ }));
    expect(banner().queryByText('Explore')).toBeNull();
    expect(banner().getByText('Otto')).toBeVisible();
  });

  it("a subagent's page: its own badge, its parent's title on the crumb, the parent's terminal", async () => {
    const { d, user } = await openOtto();
    await openExplore(user);
    d.preview('otto', ['$ npm test', 'PASS']);
    // Otto waits for an approval, its Explore works: the badge is the subagent's.
    expect(screen.getByRole('banner').querySelectorAll('[data-badge]')).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('[data-badge]')).toHaveAttribute('data-badge', 'working');
    expect(banner().getByRole('button', { name: /Otto/ })).toHaveAttribute('title', 'Open Otto’s conversation');
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(await term.findByText('PASS')).toBeVisible();
  });

  it('O shows the terminal with the preview; it follows to the next agent and is remembered; typing o in the reply does not toggle it', async () => {
    const { d, view, client, user } = await openOtto();
    d.preview('otto', ['$ npm test', 'PASS']); d.preview('bix', ['$ git log']);
    expect(banner().getByRole('button', { name: 'Show the terminal' })).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(await term.findByText('PASS')).toBeVisible();
    expect(term.getByText('Read-only preview')).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.session')!)).toEqual({ terminal: true, split: 0.5 });
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');                                  // Bix
    expect(within(screen.getByRole('region', { name: 'Terminal' })).getByText('$ git log')).toBeVisible();
    await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
    await user.keyboard('o');
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible();
    view.unmount();
    render(<App client={client} />);
    await user.click(await screen.findByRole('button', { name: /^Otto,/ }));     // only the prefs survive, never the place
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
  });

  it('session prefs are read field by field, and the key is new', () => {
    expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: 'yes', split: 0.9 }));
    expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: true, split: 0.65 }));
    expect(loadSessionPrefs()).toEqual({ terminal: true, split: 0.65 });
    expect(OBSOLETE_KEYS).not.toContain(SESSION_KEY);
  });

  it('the thread takes the whole width the sidebar leaves; with the terminal, the two share it', () => {
    expect(declarations('session.css', '.conversation-workspace')).toContain('grid-template-columns:minmax(0,1fr)');
    expect(declarations('session.css', '.conversation-workspace.with-terminal')).toBe('grid-template-columns:minmax(0,1.15fr)minmax(0,1fr)');
  });
});
