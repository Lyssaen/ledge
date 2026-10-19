import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { activeCount } from '../src/nav/agents';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));

describe('the sidebar shell', () => {
  it('has Ask Ledge and Atelier, and neither New session button, brand nor search', async () => {
    const sessions = listSessions();
    const { side } = await boot({ projects: TWO_PROJECTS, sessions });
    expect(side.queryByRole('button', { name: /^New session N/ })).toBeNull();
    expect(document.querySelector('.st-brand')).toBeNull();
    expect(side.getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
    expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions)));
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(side.queryByRole('button', { name: /Search/ })).toBeNull();
  });

  it('clicking the / hint focuses Ask Ledge and does not open the chat', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    await user.click(side.getByText('/', { selector: '.st-ask kbd' }));
    expect(side.getByRole('textbox', { name: 'Ask Ledge' })).toHaveFocus();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
  });

  it('/ focuses Ask Ledge; Enter with text opens the chat and sends chat.ask', async () => {
    // One machine: with two, the fleet sends chat.route instead of chat.ask (chat.test boots the same way).
    const { d, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions(), machines: [{ id: 'local', label: 'Local' }] });
    await user.keyboard('/');
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toHaveFocus();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    await user.keyboard('hello{Enter}');
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(d.received).toContainEqual({ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'hello', tool: 'claude' });
  });

  it('a ? beside Settings lists the shortcuts in its tooltip and opens their dialog', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const help = side.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
    expect(help.closest('.st-foot')).toBe(side.getByRole('button', { name: 'Settings' }).closest('.st-foot'));
    // The tooltip describes the button, for a mouse and for the keyboard alike: it is in the DOM, CSS shows it on hover and focus.
    const tip = document.getElementById(help.getAttribute('aria-describedby')!)!;
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(within(tip).getByText('Search and open a session')).toBeInTheDocument();
    expect(within(tip).getByText('Ctrl / ⌘ K')).toBeInTheDocument();
    expect(within(tip).getByText('Show these shortcuts')).toBeInTheDocument();
    await user.click(help);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  it('the shortcuts tooltip shows on hover and on keyboard focus', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/sidebar.css'), 'utf8');
    expect(css).toMatch(/\.st-keys:hover \.st-keys-tip/);
    expect(css).toMatch(/\.st-keys:focus-within \.st-keys-tip/);
  });

  it('shows the tree shortcuts at the foot of the sidebar', async () => {
    const { side } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const hint = side.getByText(/move/).closest('.st-hint');
    expect(hint).toBeVisible();
    expect(hint).toHaveTextContent(/↑/);
    expect(hint).toHaveTextContent(/↓/);
    expect(hint).toHaveTextContent(/←/);
    expect(hint).toHaveTextContent(/→/);
    expect(hint).toHaveTextContent(/E/);
    expect(hint).toHaveTextContent(/H/);
    expect(hint).toHaveTextContent(/Ctrl ⇧ E/);
  });

  it('the hint starts with N new session in the overview, and drops it inside a session', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const hint = () => document.querySelector('.st-hint')!;
    expect(hint().textContent).toMatch(/^Nnew session · /);
    await user.keyboard('n');
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    expect(banner().getByText('Nova')).toBeVisible();
    expect(hint().textContent).not.toMatch(/new session/);
    expect(hint()).toHaveTextContent(/move/);
  });

  it('the machine chips open Settings › Machines; the gear opens Settings', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /Local/ }));
    expect(banner().getByText('Machines')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Machines' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: /^Settings/ }));
    expect(banner().getByText('General')).toBeVisible();
  });
});
