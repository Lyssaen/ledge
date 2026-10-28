import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Gone } from '../../src/screens/Gone';
import { requestsOf } from '../../src/model/requests';
import { pending, session } from '../model/fixtures';
import { setup } from './setup';

const item = requestsOf([session('a', { name: 'Kai', topic: 'Inbox', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) })])[0]!;

describe('a request that no longer waits', () => {
  it('says it was handled on the PC, with the way to its thread', () => {
    const t = setup();
    render(<Gone store={t.store} item={item} />);
    expect(screen.getByRole('heading', { name: 'Déjà traitée sur le PC' })).toBeInTheDocument();
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir le fil de Kai' })).toHaveAttribute('href', '#/thread/a');
  });

  it('offline, says only that it is no longer in the last known state', () => {
    const t = setup('pc_offline');
    render(<Gone store={t.store} stale item={item} />);
    expect(screen.getByRole('heading', { name: 'Cette demande ne figure plus dans le dernier état connu.' })).toBeInTheDocument();
    expect(screen.queryByText('Déjà traitée sur le PC')).not.toBeInTheDocument();
  });
});

describe('a team that is no longer on the PC', () => {
  it('says so, with the way back to Agents', () => {
    const t = setup();
    render(<Gone store={t.store} team />);
    expect(screen.getByRole('heading', { name: 'Cette équipe n’existe plus' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Retour aux agents' })).toHaveAttribute('href', '#/agents');
  });

  it('offline, says only that it is no longer in the last known state', () => {
    const t = setup('pc_offline');
    render(<Gone store={t.store} team stale />);
    expect(screen.getByRole('heading', { name: 'Cette équipe ne figure plus dans le dernier état connu.' })).toBeInTheDocument();
    expect(screen.queryByText('Cette équipe n’existe plus')).not.toBeInTheDocument();
  });
});
