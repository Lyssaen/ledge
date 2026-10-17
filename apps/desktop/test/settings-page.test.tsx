import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, TWO_PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const tab = (name: string) => nav().getByRole('button', { name: new RegExp(`^${name}`) });
const title = () => screen.getByRole('heading', { level: 1 });

describe('the Settings page', () => {
  it('Ctrl , opens General: its title, its hint, its tab marked as the current page', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>},{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'General' })).toHaveTextContent('Language, start-up, default harness and updates.');
    expect(tab('General')).toHaveAttribute('aria-current', 'page');
    expect(nav().getAllByRole('button', { current: 'page' })).toHaveLength(1);
    expect(nav().getAllByRole('button').map(b => b.textContent)).toEqual([
      'Back to the atelierEsc', 'General', 'Appearance', 'Notifications', 'Sounds', 'Machines', 'Projects', 'Keyboard shortcuts', 'About'
    ]);
  });

  it('a tab changes the section: its title, aria-current, the crumb, and the scroll back at the top', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const scroller = document.querySelector('.settings-scroll')!;
    scroller.scrollTop = 240;
    await user.click(tab('Machines'));
    expect(title()).toHaveTextContent('Machines');
    expect(tab('Machines')).toHaveAttribute('aria-current', 'page');
    expect(tab('General')).not.toHaveAttribute('aria-current');
    expect(banner().getByText('Machines')).toBeVisible();
    expect(document.querySelector('.settings-scroll')!.scrollTop).toBe(0);
  });

  it('Ctrl , in Settings keeps the current section', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    await user.click(tab('Machines'));
    expect(title()).toHaveTextContent('Machines');
    await user.keyboard('{Control>},{/Control}');
    expect(title()).toHaveTextContent('Machines');
    expect(tab('Machines')).toHaveAttribute('aria-current', 'page');
  });

  it('Escape goes back to the place it came from (the List), whichever section was open', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS, list: true });
    await user.keyboard('{Control>},{/Control}');
    await user.click(tab('Sounds'));
    expect(title()).toHaveTextContent('Sounds');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    expect(banner().getByText('List')).toBeVisible();
    expect(screen.getByRole('listitem', { name: /^Otto,/ })).toBeVisible();
  });

  it('« Back to the atelier » does as Escape', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS, list: true });
    await user.keyboard('{Control>},{/Control}');
    await user.click(tab('About'));
    await user.click(nav().getByRole('button', { name: /^Back to the atelier/ }));
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    expect(banner().getByText('List')).toBeVisible();
  });

  it('a dot on Machines while a machine is offline, none while every machine is online', async () => {
    const { d, user } = await boot({ projects: TWO_PROJECTS, machines: [{ id: 'local', label: 'Local' }] });
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(tab('Machines').querySelector('.side-alert')).toBeNull();
    expect(nav().queryByRole('img', { name: 'A machine is offline' })).toBeNull();
    d.machines([{ id: 'local', label: 'Local' }, { id: 'nas', label: 'NAS', ssh: 'nas' }]);   // NAS never connects on the mock
    await waitFor(() => expect(within(tab('Machines')).getByRole('img', { name: 'A machine is offline' })).toHaveClass('side-alert'));
    expect(tab('About').querySelector('.side-alert')).toBeNull();
  });
});
