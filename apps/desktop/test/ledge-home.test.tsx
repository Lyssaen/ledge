import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { mentionAt } from '../src/chat/LedgeHome';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
  ] });
  await screen.findByRole('region', { name: 'The point' });
  return env;
}

describe('Ledge’s home view (ledge home spec)', () => {
  it('is where the app opens: header, tabs, « The point » built from the daemon’s state, the composer and its reminder', async () => {
    await openHome();
    expect(home().getByText(/^Operator · sees 2 sessions, 1 machine · read only$/)).toBeVisible();
    expect(home().getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    // What waits for the user, answerable in place; no column of teams or of tasks.
    const yours = within(point().getByLabelText('Yours'));
    await yours.findByText('pnpm test');
    expect(yours.getByRole('button', { name: 'Yes' })).toBeVisible();
    expect(point().queryByLabelText('Teams')).toBeNull();
    expect(point().queryByLabelText('Given by Ledge')).toBeNull();
    expect(home().getByText('read only · nothing without your click')).toBeVisible();
    expect(home().getByRole('button', { name: 'Who needs me?' })).toBeVisible();
  });

  it('Ledge home has two tabs: Conversation and History', async () => {
    await openHome();
    expect(home().getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation', 'History']);
  });

  it('@ completes a session in the composer; # completes nothing', () => {
    expect(mentionAt('ask @ot')).toEqual({ sigil: '@', query: 'ot', start: 4 });
    expect(mentionAt('#led')).toBeNull();
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });
});
