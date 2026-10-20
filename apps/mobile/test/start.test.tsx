import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { start } from '../src/start';

const show = () => {
  const shown: ReactNode[] = [];
  return { shown, render: (n: ReactNode) => { shown.push(n); } };
};

describe('start', () => {
  it('without a secure context: the insecure screen, and nothing loaded', async () => {
    const r = show();
    const load = vi.fn();
    await start(r.render, false, load);
    expect(load).not.toHaveBeenCalled();
    render(<>{r.shown[0]}</>);
    expect(screen.getByRole('alert')).toHaveTextContent('Connexion non sécurisée');
  });

  it('the app or its boot failing to load → said on screen, not a blank page', async () => {
    const r = show();
    await start(r.render, true, () => Promise.reject(new Error('chunk')));
    expect(r.shown).toHaveLength(1);
    render(<>{r.shown[0]}</>);
    expect(screen.getByRole('alert')).toHaveTextContent('Ledge n’a pas pu démarrer');
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeInTheDocument();
  });
});
