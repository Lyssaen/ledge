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

  it('no role pill is drawn', () => {
    const t = setup();
    t.deliver(snapshot([{ ...session('a', { name: 'Kai', repo: 'ledge' }), role: 'build', roleLabel: 'Build', team: 'team-a1b2' } as never]));
    render(<Agents store={t.store} />);
    expect(screen.getByText('Kai')).toBeInTheDocument();
    expect(screen.queryByText(/build/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprendre' })).toBeNull();
    expect(screen.getByRole('region', { name: 'ledge' })).toBeInTheDocument();
  });

  describe('the progress of a checklist', () => {
    const withPlan = () => snapshot([
      session('a', { name: 'Kai', topic: 'Inbox', checklist: { done: 3, total: 7, current: 'Ajout du test' } }),
      session('b', { name: 'Ada', topic: 'Relais', checklist: { done: 7, total: 7 } }),
      session('c', { name: 'Zoé', topic: 'Tests' })
    ]);
    const deliver = (flag: boolean) => {
      const t = setup();
      const m = withPlan();
      if (m.type === 'snapshot' && flag) m.daemon = { ...m.daemon, checklist: true };
      t.deliver(m);
      render(<Agents store={t.store} />);
    };

    it('shows done/total, its label and the current task when the PC sends checklists', () => {
      deliver(true);
      expect(screen.getByText('3/7')).toBeInTheDocument();
      expect(screen.getByLabelText('3 sur 7 tâches faites')).toBeInTheDocument();
      expect(screen.getByText('Ajout du test')).toBeInTheDocument();
    });

    it('all done: 7/7 and no current line; no checklist: nothing', () => {
      deliver(true);
      expect(screen.getByText('7/7')).toBeInTheDocument();
      expect(screen.getAllByLabelText(/tâches faites/)).toHaveLength(2);
      expect(screen.getAllByText(/\d\/\d/)).toHaveLength(2);
    });

    it('shows nothing from a PC without the flag', () => {
      deliver(false);
      expect(screen.queryByText('3/7')).toBeNull();
      expect(screen.queryByLabelText(/tâches faites/)).toBeNull();
      expect(screen.queryByText('Ajout du test')).toBeNull();
    });
  });
});
