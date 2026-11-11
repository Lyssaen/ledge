import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneSlashCommand } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const COMMANDS: PhoneSlashCommand[] = [
  { name: 'compact', source: 'builtin', argumentHint: '<instructions>', description: 'Free up context by summarizing the conversation so far' },
  { name: 'context', source: 'builtin', description: 'Show current context usage' },
  { name: 'commit-push', source: 'project', description: 'Commit staged changes and push the branch' },
  { name: 'config', source: 'builtin', argumentHint: 'key=value', description: 'Set a setting by key', bare: 'panel' },
  { name: 'cost', source: 'builtin', description: 'Show session cost', blocked: 'panel' }
];

function opened(extra: Parameters<typeof session>[1] = {}, commands = true) {
  const t = setup();
  const s = snapshot([session('a', { name: 'Kai', ...extra })]);
  t.deliver(s.type === 'snapshot' && commands ? { ...s, daemon: { ...s.daemon, commands: true } } : s);
  render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  const field = screen.getByLabelText('Message pour Kai');
  const type = (value: string) => fireEvent.change(field, { target: { value } });
  return { ...t, field, type };
}

describe('the « / » list on the phone', () => {
  it('asks at the first « / », replaces the quick instructions, filters, and a tap completes the draft', () => {
    const t = opened();
    expect(screen.getByRole('group', { name: 'Consignes rapides' })).toBeInTheDocument();
    t.type('/');
    expect(t.of('session.commands')).toEqual([{ type: 'session.commands', id: 'a' }]);
    expect(screen.getByText('Claude Code · lecture des commandes…')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Consignes rapides' })).toBeNull();
    act(() => t.deliver({ type: 'session.commands.listing', id: 'a', commands: COMMANDS }));
    t.type('/co');
    const list = within(screen.getByRole('list', { name: 'Commandes de Claude Code' }));
    expect(list.getAllByRole('button').map(b => b.textContent)).toEqual([
      '/commit-push' + 'Projet' + 'Commit staged changes and push the branch',
      '/compact <instructions>Free up context by summarizing the conversation so far',
      '/config key=valueSet a setting by key',
      '/contextShow current context usage',
      '/costOuvre un panneau du terminal'
    ]);
    expect(list.getAllByRole('button')[4]).toBeDisabled();
    fireEvent.click(list.getAllByRole('button')[1]!);
    expect(t.field).toHaveValue('/compact ');
    expect(screen.queryByRole('list', { name: 'Commandes de Claude Code' })).toBeNull();
    expect(screen.getByText('/compact <instructions>')).toBeInTheDocument();
    t.type('/compact garde le plan');
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Kai' }));
    expect(t.of('session.reply')).toMatchObject([{ type: 'session.reply', id: 'a', text: '/compact garde le plan' }]);
    expect(t.of('session.commands')).toHaveLength(1);
  });

  it('says when a bare command would open a panel, when the list is unavailable, or when nothing matches', () => {
    const t = opened();
    t.type('/');
    act(() => t.deliver({ type: 'session.commands.listing', id: 'a', commands: COMMANDS }));
    t.type('/zzz');
    expect(screen.getByText('Aucune commande « /zzz ». Elle partira comme un message à Kai.')).toBeInTheDocument();
    t.type('/config');
    fireEvent.click(screen.getByRole('button', { name: /config key=value/ }));
    expect(screen.getByText('Sans argument, /config ouvre un panneau du terminal : donne-lui un argument.')).toBeInTheDocument();
    act(() => t.deliver({ type: 'session.commands.listing', id: 'a', commands: [], error: true }));
    t.type('/co');
    expect(screen.getByText(/^Liste des commandes indisponible\./)).toBeInTheDocument();
  });

  it('no list for a PC that does not list commands, another agent, or while a request waits', () => {
    for (const [extra, commands] of [[{}, false], [{ tool: 'codex' as const }, true], [{ state: 'waiting_permission' as const, pending: pending() }, true]] as const) {
      const t = opened(extra, commands);
      if (!t.field.hasAttribute('disabled')) t.type('/co');
      expect(t.of('session.commands')).toEqual([]);
      expect(screen.queryByRole('list', { name: 'Commandes de Claude Code' })).toBeNull();
      document.body.innerHTML = '';
    }
  });
});
