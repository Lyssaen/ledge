import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { boot, closeDaemons, listSessions } from './helpers';
import { App } from '../src/App';
import { loadSessionPrefs, SESSION_KEY } from '../src/session/prefs';
import { OBSOLETE_KEYS } from '../src/state/obsolete';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const rail = () => within(screen.getByRole('navigation', { name: 'Agents of the project Ledge' }));
const banner = () => within(screen.getByRole('banner'));
async function openOtto() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByRole('navigation', { name: 'Agents of the project Ledge' });
  return env;
}

describe('the agents rail, the subagent page, the terminal', () => {
  it("the project's agents, the open one marked; its subagents grouped under it; a click switches agent", async () => {
    const { user } = await openOtto();
    expect(rail().getAllByRole('button').filter(b => b.classList.contains('rail-agent') && !b.classList.contains('child')).map(b => b.querySelector('strong')!.textContent)).toEqual(['Bix', 'Otto', 'Rio']);   // mainOrder
    expect(rail().getByRole('button', { name: /^Otto/ })).toHaveAttribute('aria-current', 'page');
    const kids = within(rail().getByRole('group', { name: 'Subagents of Otto' }));
    expect(kids.getByText('Subagents · 1')).toBeVisible();
    expect(rail().getByRole('button', { name: /^Rio/ }).querySelector('.rail-dot')).toHaveClass('off');
    await user.click(rail().getByRole('button', { name: /^Bix/ }));
    expect(banner().getByText('Bix')).toBeVisible();
  });

  it('switching agent from the rail with Enter keeps the rail and the focus on its newly current row', async () => {
    const { user } = await openOtto();
    const nav = screen.getByRole('navigation', { name: 'Agents of the project Ledge' });
    const list = nav.querySelector<HTMLElement>('.rail-list')!;
    list.scrollTop = 40;
    rail().getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('{Enter}');
    expect(banner().getByText('Bix')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Agents of the project Ledge' })).toBe(nav);   // the same rail, not a new one
    expect(nav.querySelector('.rail-list')!.scrollTop).toBe(40);
    const bix = rail().getByRole('button', { name: /^Bix/ });
    expect(bix).toHaveAttribute('aria-current', 'page');
    expect(bix).toHaveFocus();
    // Within the same agent: its subagent's page, then back, the rail stays too.
    await user.click(within(rail().getByRole('group', { name: 'Subagents of Otto' })).getByRole('button', { name: /^Explore/ }));
    expect(screen.getByRole('navigation', { name: 'Agents of the project Ledge' })).toBe(nav);
  });

  it("a subagent's page: the parent in the breadcrumb, which opens it back", async () => {
    const { user } = await openOtto();
    await user.click(within(rail().getByRole('group', { name: 'Subagents of Otto' })).getByRole('button', { name: /^Explore/ }));
    expect(banner().getByText('Explore')).toBeVisible();
    expect(banner().getByText('Lire le code')).toHaveClass('crumb-task');
    await user.click(banner().getByRole('button', { name: /Otto/ }));
    expect(banner().queryByText('Explore')).toBeNull();
    expect(rail().getByRole('button', { name: /^Otto/ })).toHaveAttribute('aria-current', 'page');
  });

  it("a subagent's page: its own badge, its parent's title on the crumb, the parent's terminal", async () => {
    const { d, user } = await openOtto();
    d.preview('otto', ['$ npm test', 'PASS']);
    await user.click(within(rail().getByRole('group', { name: 'Subagents of Otto' })).getByRole('button', { name: /^Explore/ }));
    // Otto waits for an approval, its Explore works: the badge is the subagent's.
    expect(screen.getByRole('banner').querySelectorAll('[data-badge]')).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('[data-badge]')).toHaveAttribute('data-badge', 'working');
    expect(banner().getByRole('button', { name: /Otto/ })).toHaveAttribute('title', 'Open Otto’s conversation');
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(await term.findByText('PASS')).toBeVisible();
  });

  it('« 1 subagent » shows the hidden subagents and lights their group', async () => {
    const { user } = await openOtto();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
    await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
    expect(screen.queryByRole('group', { name: 'Subagents of Otto' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '1 subagent' }));
    expect(await screen.findByRole('group', { name: 'Subagents of Otto' })).toHaveClass('rail-flash');
  });

  it('New session here starts one in this project; a session without project has its own rail', async () => {
    const { user } = await openOtto();
    await user.click(rail().getByRole('button', { name: 'New session here' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.keyboard('{Escape}{Escape}');
    await user.click(screen.getByRole('listitem', { name: /^Kit,/ }));
    expect(screen.getByRole('navigation', { name: 'Agents of the project No project' })).toBeVisible();
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
    await user.click(await screen.findByRole('listitem', { name: /^Otto,/ }));     // only the prefs survive, never the place
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

  it('the rail hides under 1000 px', () => {
    expect(readFileSync(resolve(__dirname, '../src/styles/session.css'), 'utf8')).toMatch(/@media\(max-width:1000px\)\{[^}]*\.project-rail\{display:none\}/);
  });
});
