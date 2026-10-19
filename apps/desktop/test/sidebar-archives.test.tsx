import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, PROJECTS, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const ARCHIVED_AT = '2026-10-18T10:00:00.000Z';
const otto = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });

/** An archive the fleet keeps out of the live list. `exited` so boot's active count matches, and so Resume is allowed. */
const archived = (id: string, name: string, extra: { topic?: string; agentSessionId?: string } = {}) =>
  fakeSession(id, { name, cwd: '/w/pay', state: 'exited', archivedAt: ARCHIVED_AT, topic: extra.topic ?? 'Prepare the migration', agentSessionId: extra.agentSessionId ?? 'u-1' });

const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
const banner = () => within(screen.getByRole('banner'));
const archivesOf = (side: ReturnType<typeof within>) => within(side.getByRole('region', { name: 'Archives' }));

describe('archives in the sidebar', () => {
  it('archives fold away; opening one reads it and unfolds the section', async () => {
    const { d, side, user } = await boot({ sessions: [otto] });
    act(() => d.upsert(archived('old', 'Nova')));
    await waitFor(() => expect(archivesOf(side).getByRole('button', { name: /Archives/ })).toHaveTextContent('1'));
    const toggle = archivesOf(side).getByRole('button', { name: /Archives/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(archivesOf(side).queryByRole('button', { name: /Reread Nova/ })).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(archivesOf(side).getByRole('button', { name: /Reread Nova/ }));
    expect(await screen.findByText('Archived session')).toBeVisible();
    expect(banner().getByText('Nova')).toBeVisible();
  });

  it('Restore, Resume and Delete go through SessionActions', async () => {
    const { d, side, user } = await boot({ sessions: [otto, archived('old', 'Nova')], daemon: CAN });
    const archives = archivesOf(side);
    await user.click(archives.getByRole('button', { name: /Archives/ }));
    await user.click(archives.getByRole('button', { name: 'Put Nova back at the table' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.restore', id: 'old' }));
    await user.click(archives.getByRole('button', { name: 'Resume Nova' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.resume', id: 'old' }));
    await user.click(archives.getByRole('button', { name: 'Delete Nova' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete Nova?' })).toBeVisible();
  });

  it('the Archived crumb unfolds the section', async () => {
    const { side, user } = await boot({ sessions: [otto, archived('old', 'Nova')], daemon: CAN });
    const archives = archivesOf(side);
    await user.click(archives.getByRole('button', { name: /Archives/ }));
    await user.click(archives.getByRole('button', { name: /Reread Nova/ }));
    expect(await screen.findByText('Archived session')).toBeVisible();
    const toggle = archives.getByRole('button', { name: /Archives/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(banner().getByRole('button', { name: 'Archived' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('a filter appears past four archives', async () => {
    const four = ['Nia', 'Ned', 'Noa', 'Nim'].map((name, i) => archived(`a${i}`, name, { topic: name }));
    const { d, side, user } = await boot({ sessions: [otto, ...four] });
    const archives = archivesOf(side);
    await user.click(archives.getByRole('button', { name: /Archives/ }));
    expect(archives.queryByRole('searchbox', { name: 'Filter the archives' })).toBeNull();
    expect(side.getByRole('region', { name: 'Archives' }).querySelector('.st-auto')).toBeNull();
    expect(archives.queryByRole('combobox')).toBeNull();
    act(() => d.upsert(archived('a4', 'Nox', { topic: 'Nox' })));
    const filter = await archives.findByRole('searchbox', { name: 'Filter the archives' });
    await user.type(filter, 'nox');
    expect(archives.getByRole('button', { name: /Reread Nox/ })).toBeVisible();
    expect(archives.queryByRole('button', { name: /Reread Nia/ })).toBeNull();
  });

  it('archiving the session being read leaves the section folded; the Archived crumb still unfolds it', async () => {
    const sessions = listSessions();
    const bix = sessions.find(s => s.id === 'bix')!;
    const { d, side, user } = await boot({ projects: PROJECTS, sessions, daemon: CAN });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    await user.click(tree.getByRole('button', { name: /^Bix/ }));
    expect(banner().getByText('Bix')).toBeVisible();
    tree.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('e');
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.archive', id: 'bix' }));
    act(() => d.upsert({ ...bix, archivedAt: ARCHIVED_AT }));
    const toggle = archivesOf(side).getByRole('button', { name: /Archives/ });
    await waitFor(() => expect(toggle).toHaveTextContent('1'));
    expect(await screen.findByText('Archived session')).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(banner().getByRole('button', { name: 'Archived' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(archivesOf(side).getByRole('button', { name: /Reread Bix/ })).toHaveAttribute('aria-current', 'page');
  });
});
