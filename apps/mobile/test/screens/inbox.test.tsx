import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Inbox } from '../../src/screens/Inbox';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const at = (min: number) => new Date(Date.parse('2026-10-14T10:00:00.000Z') + min * 60_000).toISOString();

describe('the inbox', () => {
  it('lists the waiting sessions only, the oldest request first', () => {
    const t = setup();
    t.deliver(snapshot([
      session('a', { name: 'Kai', topic: 'Récente', state: 'waiting_permission', lastActivityAt: at(5), pending: pending({ key: 'ka', text: 'pnpm build' }) }),
      session('b', { name: 'Ada', topic: 'Ancienne', state: 'waiting_input', lastActivityAt: at(0), pending: pending({ key: 'kb', kind: 'question', text: 'Quelle base ?' }) }),
      session('c', { name: 'Idle', topic: 'Calme' })
    ]));
    render(<Inbox store={t.store} />);
    const rows = screen.getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('#/request/'));
    expect(rows.map(r => r.getAttribute('href'))).toEqual(['#/request/b/kb', '#/request/a/ka']);
    expect(within(rows[0]!).getByText('Quelle base ?')).toBeInTheDocument();
    expect(screen.queryByText(/Calme/)).not.toBeInTheDocument();
    expect(screen.getByText('2 demandes. Choisissez par où commencer.')).toBeInTheDocument();
  });

  it('filters by kind', () => {
    const t = setup();
    t.deliver(snapshot([
      session('a', { state: 'waiting_permission', pending: pending({ key: 'ka', text: 'pnpm build' }) }),
      session('b', { state: 'waiting_input', pending: pending({ key: 'kb', kind: 'question', text: 'Quelle base ?' }) })
    ]));
    render(<Inbox store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByText('Quelle base ?')).toBeInTheDocument();
    expect(screen.queryByText('pnpm build')).not.toBeInTheDocument();
  });

  it('says « Tout est calme » when nothing waits', () => {
    const t = setup();
    t.deliver(snapshot([session('c')]));
    render(<Inbox store={t.store} />);
    expect(screen.getByText('Tout est calme')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vous êtes à jour' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir les agents/ })).toHaveAttribute('href', '#/agents');
  });

  it('shows « PC hors ligne » once the state is no longer fresh, and the requests as last known', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { state: 'waiting_permission', pending: pending({ key: 'ka', text: 'pnpm build' }) })]));
    render(<Inbox store={t.store} />);
    expect(screen.queryByText('PC hors ligne')).not.toBeInTheDocument();
    act(() => t.set('pc_offline'));
    expect(screen.getByText('PC hors ligne')).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(screen.getAllByText('Dernier état connu').length).toBeGreaterThan(0);
    expect(screen.getByText('Vous pouvez consulter les demandes. Aucune décision ne sera envoyée hors connexion.')).toBeInTheDocument();
  });

  it('offers to reconnect only when told how', () => {
    const t = setup('pc_offline');
    let asked = 0;
    render(<Inbox store={t.store} onReconnect={() => { asked++; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnecter et actualiser' }));
    expect(asked).toBe(1);
  });

  it('counts the waiting requests in the tab bar', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { state: 'waiting_permission', pending: pending({ key: 'ka' }) })]));
    render(<Inbox store={t.store} />);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByRole('link', { name: /À traiter/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('1')).toBeInTheDocument();
  });
});
