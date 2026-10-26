import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ClientMessage, Role, ServerMessage } from '@ledge/protocol';
import { LaunchComposer } from '../src/launch/LaunchComposer';
import { LangProvider } from '../src/i18n/lang';

vi.mock('../src/launch/useModels', () => ({ useModels: () => ({ status: 'ready', models: [] }) }));
vi.mock('../src/launch/useRepoInfo', () => { const infos = new Map(); return { useRepoInfo: () => infos }; });

// #106: the role the form shows and sends is the one the daemon will read, in the first folder on its machine (findRole: the
// repository's wins over the home's of the same id). A role read elsewhere is read again, or let go, when the folder changes.
const role = (id: string, label: string, source: 'repo' | 'home', extra: Partial<Role> = {}): Role =>
  ({ id, label, prompt: '', source, path: `/${source}/.ledge/roles/${id}.md`, ...extra });
const PROJECTS = [
  { id: 'a', name: 'Project A', color: 'blue', repos: [{ machine: 'local', path: '/w/a' }, { machine: 'dev', path: '/srv/a' }] },
  { id: 'b', name: 'Project B', color: 'green', repos: [{ machine: 'local', path: '/w/b' }] }
];
const MACHINES = [
  { id: 'local', label: 'Local', ready: true, daemon: { version: '0.19.1', models: true } },
  { id: 'dev', label: 'dev-server', ready: true, daemon: { version: '0.19.1', models: true } }
];

/** A daemon whose roles.list answers from `roles[machine:cwd]`, once `answer()` is called. */
function daemon(roles: Record<string, Role[]>) {
  const listeners = new Set<(m: ServerMessage) => void>();
  const asked: Array<Extract<ClientMessage, { type: 'roles.list' }>> = [];
  const client = {
    send: vi.fn((m: ClientMessage) => { if (m.type === 'roles.list') asked.push(m); }),
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => listeners.delete(f); }
  };
  const answer = () => act(async () => {
    for (const m of asked.splice(0)) {
      const list = roles[`${m.machineId ?? 'local'}:${m.cwd ?? ''}`] ?? [];
      for (const f of [...listeners]) f({ type: 'roles.listing', requestId: m.requestId, roles: list, templates: [], problems: [] });
    }
  });
  return { client, asked, answer };
}

function open(d: ReturnType<typeof daemon>, wanted: Parameters<typeof LaunchComposer>[0]['wanted']) {
  const onLaunch = vi.fn();
  render(<LangProvider lang="en"><LaunchComposer client={d.client as never} projects={PROJECTS as never} machines={MACHINES as never}
    sessions={[]} projectIdOf={() => null} wanted={wanted} onEditProject={() => {}} onNewProject={() => {}} launch={{ status: 'idle' } as never}
    onLaunch={onLaunch} onCancel={() => {}} paused /></LangProvider>);
  fireEvent.change(screen.getByRole('textbox', { name: /instruction/i }), { target: { value: 'Review the change' } });
  return onLaunch;
}
const launch = () => fireEvent.click(screen.getByRole('button', { name: /^Launch/ }));

describe('the launch form reads its role again where it will run (#106)', () => {
  it('another project: the role of B is read, shown and sent; nothing goes before it is read', async () => {
    const d = daemon({ 'local:/w/b': [role('review', 'Repo B reviewer', 'repo')] });
    const onLaunch = open(d, { project: 'a', cwd: '/w/a', role: { id: 'review', label: 'Repo A reviewer', tool: 'claude' } });
    expect(d.asked).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Project B' }));
    expect(d.asked).toEqual([expect.objectContaining({ type: 'roles.list', cwd: '/w/b' })]);
    launch();
    expect(onLaunch).not.toHaveBeenCalled();
    await d.answer();
    expect(screen.getByRole('note')).toHaveTextContent('Repo B reviewer');
    expect(screen.getByRole('note')).not.toHaveTextContent('Repo A reviewer');
    launch();
    expect(onLaunch.mock.calls[0]?.[0]).toMatchObject({ type: 'session.launch', cwd: '/w/b', role: 'review' });
  });

  it('a folder without that role: the role is let go, and said so; the session launches without it', async () => {
    const d = daemon({});
    const onLaunch = open(d, { project: 'a', cwd: '/w/a', role: { id: 'review', label: 'Repo A reviewer', tool: 'claude' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Project B' }));
    await d.answer();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('@review does not exist in /w/b: the role was removed.');
    launch();
    expect(onLaunch.mock.calls[0]?.[0]).toMatchObject({ cwd: '/w/b' });
    expect(onLaunch.mock.calls[0]?.[0]).not.toHaveProperty('role');
  });

  it('a home role, read without a folder, launched in a repository that has its own: the repository\'s is shown, as the daemon runs it', async () => {
    const d = daemon({ 'local:/w/a': [role('review', 'Repo reviewer', 'repo', { autonomy: 'auto', shadows: '/home/.ledge/roles/review.md' })] });
    const onLaunch = open(d, { project: 'a', role: { id: 'review', label: 'Home reviewer', tool: 'claude' } });
    expect(d.asked).toEqual([expect.objectContaining({ type: 'roles.list', cwd: '/w/a' })]);
    await d.answer();
    expect(screen.getByRole('note')).toHaveTextContent('Repo reviewer');
    expect(screen.getByRole('note')).not.toHaveTextContent('Home reviewer');
    launch();
    expect(onLaunch.mock.calls[0]?.[0]).toMatchObject({ cwd: '/w/a', role: 'review' });
  });

  it('another machine: the role is read on that machine\'s daemon, and its defaults follow', async () => {
    const d = daemon({ 'dev:/srv/a': [role('review', 'Dev reviewer', 'repo', { tool: 'codex' })] });
    const onLaunch = open(d, { project: 'a', cwd: '/w/a', role: { id: 'review', label: 'Repo A reviewer', tool: 'claude' } });
    fireEvent.click(screen.getByRole('radio', { name: /dev-server/ }));
    expect(d.asked).toEqual([expect.objectContaining({ type: 'roles.list', cwd: '/srv/a', machineId: 'dev' })]);
    await d.answer();
    expect(screen.getByRole('note')).toHaveTextContent('Dev reviewer');
    launch();
    expect(onLaunch.mock.calls[0]?.[0]).toMatchObject({ cwd: '/srv/a', machineId: 'dev', role: 'review', tool: 'codex' });
  });
});
