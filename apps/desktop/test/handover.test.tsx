import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { nearLimit } from '../src/teams/useTeamsApi';

const AT = '2026-10-26T08:00:00.000Z';
const ctx = (used: number) => ({ used, window: 200_000, at: AT });

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('a session near its context limit (context handover spec §3.2)', () => {
  it('« Your turn » lists it with « Hand over » and « Later »; the session page shows the gauge and the button', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', role: 'build', context: ctx(170_000) }),
      fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', context: ctx(60_000) })
    ] });
    const yours = within(side.getByRole('region', { name: 'Your turn' }));
    expect(yours.getByText('Otto @build · context 85 %')).toBeVisible();
    expect(yours.queryByText(/Pim · context/)).toBeNull();
    d.onMessage(m => { if (m.type === 'session.handover') d.push({ type: 'session.handover.result', rid: m.rid, ok: true }); });
    await user.click(yours.getByRole('button', { name: 'Hand over' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'session.handover', rid: expect.any(String), id: 'otto' }));
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    expect(document.querySelector('.pane-meta')).toHaveTextContent('context 85 %');
    // « Hand over » is in the session's « … » menu, with its gauge; not in the page's heading.
    expect(document.querySelector('.pane-heading')!.textContent).not.toContain('Hand over');
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Manage Otto' }));
    const item = await screen.findByRole('menuitem', { name: 'Hand over' });
    expect(item).toHaveTextContent('context 85 %');
    await user.click(item);
    await waitFor(() => expect(d.received.filter(m => m.type === 'session.handover')).toHaveLength(2));
    // Under way: the page says so, « Your turn » lets it be.
    d.push({ type: 'session.updated', session: fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', role: 'build', context: ctx(170_000), handover: { state: 'briefing', at: AT } }) });
    expect(await screen.findByText('relief: brief asked')).toBeVisible();
    await waitFor(() => expect(side.queryByText(/Otto @build · context/)).toBeNull());
  });

  it('« Max context » in Settings › General: the daemon\'s threshold, set there; the lists follow it', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', context: ctx(150_000) })] });
    d.push({ type: 'context.prefs', prefs: { near: 0.8 } });
    expect(side.queryByText(/Otto · context/)).toBeNull();
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const select = screen.getByRole('combobox', { name: 'Max context' });
    expect(select).toHaveValue('80');
    await user.selectOptions(select, '70');
    await waitFor(() => expect(d.received).toContainEqual({ type: 'context.set', prefs: { near: 0.7 } }));
    d.push({ type: 'context.prefs', prefs: { near: 0.7 } });
    // 75 % is past 70 %: « Your turn » lists it.
    expect(await side.findByText('Otto · context 75 %')).toBeVisible();
  });

  it('« The point » lists it as « Your turn » does; « Later » in « Your turn » puts it away from both', async () => {
    const { side, user } = await boot({ home: true, projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', role: 'build', context: ctx(170_000) })] });
    const point = within(await screen.findByRole('region', { name: 'The point' }));
    const row = (await point.findByText('Otto · context 85 %')).closest('.lp-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Hand over' })).toBeVisible();
    expect(side.getByText('Otto @build · context 85 %')).toBeVisible();
    await user.click(within(side.getByText('Otto @build · context 85 %').closest('.st-card') as HTMLElement).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(side.queryByText(/Otto @build · context/)).toBeNull());
    expect(point.queryByText(/Otto · context/)).toBeNull();
  });

  it('« Later » puts it away until it grows by 5 points; a failed relief is listed with its reason', () => {
    const s = (id: string, used: number, extra = {}) => fakeSession(id, { name: id, context: ctx(used), ...extra });
    expect(nearLimit([s('a', 170_000), s('b', 100_000), s('c', 170_000, { handover: { state: 'briefing', at: AT } }), s('d', 170_000, { state: 'exited' })]).map(x => x.id)).toEqual(['a']);
    expect(nearLimit([s('a', 175_000)], new Map([['a', 0.85]]))).toEqual([]);
    expect(nearLimit([s('a', 182_000)], new Map([['a', 0.85]])).map(x => x.id)).toEqual(['a']);
    expect(nearLimit([s('e', 10_000, { handover: { state: 'failed', at: AT, reason: 'rôle inconnu' } })]).map(x => x.id)).toEqual(['e']);
  });
});
