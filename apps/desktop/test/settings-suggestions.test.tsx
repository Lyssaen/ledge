import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, FoundRepo, Projects } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, PROJECTS, type MockDaemon } from './helpers';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); cleanup(); await closeDaemons(); });

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const scansOf = (d: MockDaemon) => d.received.filter(m => m.type === 'repos.scan');

/** Three proposals: « Paper » (three paper-* repositories), « Complete Ledge » (a clone with Ledge's remote), « Notes » (Kit's folder). */
const FOUND: FoundRepo[] = [
  { path: '/home/me/dev/paper-fonts', branch: 'main' },
  { path: '/home/me/dev/paper-templates', branch: 'next' },
  { path: '/home/me/dev/paper-tools', branch: 'main' },
  { path: '/w/ledge', branch: 'main', remote: 'github.com/me/ledge' },
  { path: '/home/me/site', branch: 'gh-pages', remote: 'github.com/me/ledge' }
];
const SESSIONS = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }),
  fakeSession('kit', { name: 'Kit', cwd: '/srv/lab/notes', state: 'waiting_input' })
];

const cards = () => screen.queryAllByRole('article').filter(a => a.classList.contains('suggest-card')).map(a => a.getAttribute('aria-label'));
const card = (name: string) => within(screen.getByRole('article', { name }));

async function open(found: FoundRepo[] = FOUND, sessions = SESSIONS) {
  const env = await boot({ sessions });
  env.d.found.push(...found);
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: /^Projects/ }));
  await screen.findByRole('heading', { level: 2, name: 'Projects' });
  return env;
}
const ask = (user: Awaited<ReturnType<typeof boot>>['user']) => user.click(screen.getByRole('button', { name: 'Ledge, suggest projects' }));

describe('Settings › Projects: Ledge proposes', () => {
  it('shows the offer, scans step by step, then a card per proposal with its repositories (reason as title) and agents', async () => {
    const { d, user } = await open();
    expect(screen.getByRole('heading', { level: 2, name: 'Let Ledge organise' })).toBeVisible();
    expect(cards()).toEqual([]);
    await ask(user);
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(cards().sort()).toEqual(['Proposal Ledge', 'Proposal Notes', 'Proposal Paper']);
    expect(scansOf(d)).toHaveLength(1);
    const paper = card('Proposal Paper');
    expect(paper.getByText('Paper')).toBeVisible();
    expect(paper.getByText('paper-fonts · Local').getAttribute('title')).toBe('Named paper-*');
    expect(paper.getByRole('button', { name: 'Review and create…' })).toBeVisible();
    expect(card('Proposal Ledge').getByRole('button', { name: 'Review and add…' })).toBeVisible();
    expect(card('Proposal Ledge').getByText('site · Local').getAttribute('title')).toBe('Same remote github.com/me/ledge');
    expect(card('Proposal Notes').getByText('Kit')).toBeVisible();
    // The button now says « Run again »; Dev is offline and the line says it.
    expect(screen.getByRole('button', { name: 'Run again' })).toBeVisible();
    expect(screen.getByText('Dev SSH offline, skipped')).toBeVisible();
    expect(setsOf(d)).toEqual([]);
  });

  it('« Ignore » removes a card until « Run again »', async () => {
    const { user } = await open();
    await ask(user);
    await waitFor(() => expect(cards()).toHaveLength(3));
    await user.click(card('Proposal Paper').getByRole('button', { name: 'Ignore' }));
    expect(cards().sort()).toEqual(['Proposal Ledge', 'Proposal Notes']);
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(cards()).toHaveLength(3));
  });

  it('« Review and create… » opens the editor on the proposal and writes nothing', async () => {
    const { d, user } = await open();
    await ask(user);
    await waitFor(() => expect(cards()).toHaveLength(3));
    await user.click(card('Proposal Paper').getByRole('button', { name: 'Review and create…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Paper');
    expect(dialog.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' })).toBeChecked();
    expect(setsOf(d)).toEqual([]);
    expect(savedNotices(log)).toEqual([]);
  });

  it('after a creation the proposals are recomputed without scanning again: the card goes, a taken repository leaves the other', async () => {
    const { d, user } = await open();
    await ask(user);
    await waitFor(() => expect(cards()).toHaveLength(3));
    const created: Projects = { ...PROJECTS, projects: [...PROJECTS.projects, { id: 'notes', name: 'Notes', color: 'violet', description: '', repos: [{ machine: 'local', path: '/srv/lab/notes' }, { machine: 'local', path: '/home/me/dev/paper-fonts' }] }] };
    act(() => d.projects(created));
    await waitFor(() => expect(cards()).toEqual(['Proposal Ledge', 'Proposal Paper']));
    expect(card('Proposal Paper').queryByText('paper-fonts · Local')).toBeNull();
    expect(card('Proposal Paper').getByText('paper-templates · Local')).toBeVisible();
    expect(scansOf(d)).toHaveLength(1);
  });

  it('says so when everything is already filed', async () => {
    const { user } = await open([], SESSIONS.slice(0, 1));
    await ask(user);
    expect(await screen.findByText('Everything is already filed: no free repository or agent without a project to group.')).toBeVisible();
  });
});
