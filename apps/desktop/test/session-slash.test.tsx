import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ClientMessage, SlashCommand } from '@ledge/protocol';
import { forgetSlashCommands } from '@ledge/fleet/slashCommands';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); forgetSlashCommands(); await closeDaemons(); });

const field = () => screen.getByRole('textbox', { name: 'Reply to the agent' });
const COMMANDS: SlashCommand[] = [
  { name: 'compact', source: 'builtin', description: 'Free up context by summarizing the conversation so far', argumentHint: '<optional custom summarization instructions>' },
  { name: 'context', source: 'builtin', description: 'Show current context usage' },
  { name: 'commit-push', source: 'project', description: 'Commit staged changes and push the branch' },
  { name: 'config', source: 'builtin', description: 'Set a setting by key', argumentHint: 'key=value', bare: 'panel' },
  { name: 'usage', aliases: ['cost'], source: 'builtin', description: 'Show session cost', blocked: 'panel' }
];
const asks = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'session.commands' }> => m.type === 'session.commands');

async function openNova() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
  await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
  return env;
}

describe('the « / » list of a Claude Code session', () => {
  it('asks the commands at the first « / », filters them while typing, completes with Enter, then Enter sends', async () => {
    const { d, user } = await openNova();
    await user.click(field()); await user.keyboard('/');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    expect(asks(d)[0]).toMatchObject({ id: 'nova' });
    expect(document.querySelector('.slash-menu')).toHaveTextContent('reading the commands…');
    d.push({ type: 'session.commands.listing', requestId: asks(d)[0]!.requestId, id: 'nova', tool: 'claude', commands: COMMANDS });
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Claude Code commands' })).toBeVisible());
    await user.keyboard('co');
    const names = () => screen.getAllByRole('option').map(o => o.querySelector('.slash-name')!.textContent);
    expect(names()).toEqual(['/commit-push', '/compact <optional custom summarization instructions>', '/config key=value', '/context', '/cost · /usage']);
    expect(screen.getAllByRole('option')[4]).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByRole('option')[4]).toHaveTextContent('Opens a terminal panel: run it in the terminal');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    // The blocked one is skipped: ↑ from the first goes round to the last that can be picked.
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field()).toHaveValue('/compact ');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.querySelector('.slash-ghost')).toHaveTextContent('<optional custom summarization instructions>');
    expect(screen.getByText('sends the command to Nova')).toBeVisible();
    expect(d.received.filter(m => m.type === 'session.reply')).toEqual([]);
    await user.keyboard('keep the plan{Enter}');
    await waitFor(() => expect(d.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'nova', text: '/compact keep the plan' }]));
    expect(asks(d)).toHaveLength(1);
  });

  it('Tab completes, a click completes, Escape closes the list and keeps the draft; a bare panel command says why', async () => {
    const { d, user } = await openNova();
    await user.click(field()); await user.keyboard('/commi');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    d.push({ type: 'session.commands.listing', requestId: asks(d)[0]!.requestId, id: 'nova', tool: 'claude', commands: COMMANDS });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await user.keyboard('{Tab}');
    expect(field()).toHaveValue('/commit-push ');
    await user.clear(field()); await user.keyboard('/conf');
    await user.click(screen.getByRole('option'));
    expect(field()).toHaveValue('/config ');
    expect(screen.getByText('Without arguments, /config opens a terminal panel: give it one.')).toBeVisible();
    await user.clear(field()); await user.keyboard('/co{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveValue('/co'); expect(field()).toHaveFocus();
    await user.keyboard('m');
    expect(screen.getByRole('listbox')).toBeVisible();
  });

  it('a list that could not be read says so, and the command still goes as typed', async () => {
    const { d, user } = await openNova();
    await user.click(field()); await user.keyboard('/compa');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    d.push({ type: 'session.commands.listing', requestId: asks(d)[0]!.requestId, id: 'nova', commands: [], error: 'timed out' });
    await waitFor(() => expect(screen.getByText('Command list unavailable.')).toBeVisible());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(d.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'nova', text: '/compa' }]));
  });

  it('no list while a request waits for an answer, nor for an agent Ledge does not list yet', async () => {
    const sessions = listSessions().map(s => (s.id === 'nova' ? { ...s, tool: 'codex' as const } : s));
    const { d, user } = await boot({ sessions, list: true });
    await user.click(screen.getByRole('button', { name: /^Nova,/ }));
    await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
    await user.click(field()); await user.keyboard('/co');
    await new Promise(r => setTimeout(r, 50));
    expect(asks(d)).toEqual([]); expect(screen.queryByRole('listbox')).toBeNull();
  });
});
