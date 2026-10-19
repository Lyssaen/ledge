import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { activeCount } from '../src/nav/agents';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));

describe('the sidebar shell', () => {
  it('has New session, Ask Ledge and Atelier, and neither brand nor search', async () => {
    const sessions = listSessions();
    const { side } = await boot({ projects: TWO_PROJECTS, sessions });
    expect(side.getByRole('button', { name: /^New session N/ })).toBeVisible();
    expect(side.getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
    expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions)));
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(side.queryByRole('button', { name: /Search/ })).toBeNull();
  });

  it('clicking the / hint focuses Ask Ledge and does not open the chat', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    await user.click(side.getByText('/', { selector: 'kbd' }));
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
