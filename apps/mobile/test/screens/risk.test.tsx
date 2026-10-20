import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequestDetail } from '../../src/screens/RequestDetail';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

function opened(p = pending()) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Publication', repo: 'ledge-site', branch: 'main', state: 'waiting_permission', pending: p })]));
  render(<RequestDetail store={t.store} sessionId="a" requestKey={p.key} />);
  return t;
}

describe('a high-impact request', () => {
  it('is accepted on the PC only: the accept button gives way, refusing stays possible', () => {
    const t = opened(pending({ text: 'git push --force origin main', risk: 'high', riskReason: 'pushes' }));
    expect(screen.getByText('Peut remplacer l’historique distant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autoriser/ })).not.toBeInTheDocument();
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(t.of('session.decide')).toMatchObject([{ decision: 'deny' }]);
  });

  it('a PC asking for its own confirmation says the same', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.decide')[0]!.op, status: 'rejected', reason: 'confirm_required' }));
    expect(screen.getByText('À accepter sur le PC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autoriser/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeEnabled();
  });
});
