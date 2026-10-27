import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Agents } from '../../src/screens/Agents';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

describe('the agents', () => {
  it('groups the sessions by repository, each row opening its thread', () => {
    const t = setup();
    t.deliver(snapshot([
      session('a', { name: 'Kai', topic: 'Inbox', repo: 'ledge', branch: 'feat/x', state: 'working' }),
      session('b', { name: 'Ada', topic: 'Relais', repo: 'relay', unread: true }),
      session('c', { name: 'Zoé', topic: 'Tests', repo: 'ledge', state: 'waiting_permission', pending: pending({ key: 'kc', text: 'pnpm test' }) })
    ]));
    render(<Agents store={t.store} />);
    expect(screen.getByText('3 sessions · 2 projets sur ce PC')).toBeInTheDocument();
    const ledge = screen.getByRole('region', { name: 'ledge' });
    expect(within(ledge).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['#/thread/a', '#/thread/c']);
    expect(within(ledge).getByText('Au travail')).toBeInTheDocument();
    expect(within(ledge).getByText('Votre accord')).toBeInTheDocument();
    const relay = screen.getByRole('region', { name: 'relay' });
    expect(within(relay).getByText('● Non lu')).toBeInTheDocument();
    expect(within(relay).getByText('Disponible')).toBeInTheDocument();
  });

  it('two groups with the same name (a repository and a project both « ledge ») are both drawn, each with its own key', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup();
    t.deliver(snapshot([
      session('a', { name: 'Kai', repo: 'ledge' }),
      session('b', { name: 'Ada', project: 'ledge' })
    ]));
    render(<Agents store={t.store} />);
    expect(screen.getAllByRole('region', { name: 'ledge' })).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();
  });

  it('says when no session runs', () => {
    const t = setup();
    t.deliver(snapshot([]));
    render(<Agents store={t.store} />);
    expect(screen.getByText('Aucune session sur ce PC')).toBeInTheDocument();
  });

  it('says the list is the last known state once the link is lost', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    render(<Agents store={t.store} />);
    act(() => t.set('pc_offline'));
    expect(screen.getByText('Dernier état connu · connexion perdue')).toBeInTheDocument();
    expect(screen.getByText('PC hors ligne')).toBeInTheDocument();
  });
});
