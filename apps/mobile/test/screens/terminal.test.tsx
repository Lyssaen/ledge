import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Terminal } from '../../src/screens/Terminal';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

function opened(extra: Parameters<typeof session>[1] = {}) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', state: 'working', ...extra })]));
  const view = render(<Terminal store={t.store} sessionId="a" storage={t.storage} />);
  return { ...t, view };
}

describe('the terminal', () => {
  it('watches the session on open, and stops watching on leaving', () => {
    const t = opened();
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }]);
    t.view.unmount();
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }, { type: 'session.watch', id: null }]);
  });

  it('shows the lines the PC pushes, read-only', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.preview', id: 'a', lines: ['$ pnpm test', '✓ 12 tests'] }));
    expect(screen.getByLabelText('Sortie du terminal, défilement horizontal').textContent).toContain('✓ 12 tests');
    expect(screen.getByText('Lecture seule · en direct')).toBeInTheDocument();
  });

  it('« Interrompre » sends an interrupt, once', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: /Interrompre Kai/ }));
    expect(t.of('session.interrupt')).toMatchObject([{ type: 'session.interrupt', id: 'a' }]);
    expect(screen.getByRole('button', { name: /Interruption en cours…/ })).toBeDisabled();
  });

  it('shows the refusal of a session started outside Ledge', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: /Interrompre Kai/ }));
    const op = t.of('session.interrupt')[0]!.op;
    act(() => t.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'read_only' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Session démarrée hors de Ledge : interrompez-la dans le terminal du PC.');
  });

  it('cannot interrupt an idle agent, and says why', () => {
    opened({ state: 'idle' });
    expect(screen.getByRole('button', { name: /Interrompre Kai/ })).toBeDisabled();
    expect(screen.getByText('L’agent ne travaille pas.')).toBeInTheDocument();
  });

  it('cannot interrupt offline, and shows the last known lines', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.preview', id: 'a', lines: ['$ pnpm test'] }));
    act(() => t.set('pc_offline'));
    expect(screen.getByText('Lecture seule · dernier état connu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Interrompre Kai/ })).toBeDisabled();
  });

  it('keeps the text size between visits', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Agrandir le texte' }));
    act(() => t.deliver({ type: 'session.preview', id: 'a', lines: ['x'] }));
    expect(screen.getByText('x')).toHaveAttribute('data-size', '13');
  });
});
