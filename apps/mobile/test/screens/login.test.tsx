import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { takeSignin } from '../../src/boot';
import { app } from './app-setup';

describe('signing in', () => {
  it('takes the relay’s ?signin= issue once, and leaves the rest of the address alone', () => {
    globalThis.history.replaceState(null, '', '/?signin=denied#/agents');
    expect(takeSignin()).toBe('denied');
    expect(globalThis.location.search).toBe('');
    expect(globalThis.location.hash).toBe('#/agents');
    expect(takeSignin()).toBeNull();
  });

  it('signed out → the login board, its notes in order, and GitHub at /auth/github/start', () => {
    app('signed_out');
    expect(screen.getByRole('heading', { name: 'Vos agents, dans la poche' })).toBeInTheDocument();
    expect(screen.getByText('Connectez-vous avec le même compte GitHub que dans Ledge sur votre PC.')).toBeInTheDocument();
    expect(screen.getByText(globalThis.location.host)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ce téléphone crée sa propre clé. Elle ne le quitte jamais.',
      'Rien n’est accessible avant que vous ayez confirmé un code sur votre PC.',
      'Le serveur relaie des messages chiffrés : il ne peut ni les lire, ni répondre à votre place.'
    ]);
    expect(screen.getByRole('link', { name: 'Continuer avec GitHub' })).toHaveAttribute('href', '/auth/github/start');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('?signin=denied → the login board says GitHub refused', () => {
    app('signed_out', { signin: 'denied' });
    expect(screen.getByRole('alert')).toHaveTextContent('La connexion a été refusée sur GitHub.');
    expect(screen.getByRole('link', { name: 'Continuer avec GitHub' })).toBeInTheDocument();
  });

  it.each(['bad_state', 'error'])('?signin=%s → the login board says the sign-in failed', (issue) => {
    app('signed_out', { signin: issue });
    expect(screen.getByRole('alert')).toHaveTextContent('La connexion à GitHub a échoué. Réessayez.');
  });

  it('a failed sign-in is said on the login board even before the link knows it is signed out', () => {
    app('handshaking', { signin: 'error' });
    expect(screen.getByRole('heading', { name: 'Vos agents, dans la poche' })).toBeInTheDocument();
  });

  it('?signin=not_allowed → « Ce compte n’a pas accès », then another account → the login board', () => {
    app('signed_out', { signin: 'not_allowed' });
    expect(screen.getByRole('heading', { name: 'Ce compte n’a pas accès' })).toBeInTheDocument();
    expect(screen.getByText('Ce compte GitHub n’est pas dans la liste de ce serveur. Demandez à son administrateur de vous ajouter.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser un autre compte' }));
    expect(screen.getByRole('heading', { name: 'Vos agents, dans la poche' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the login board in front: no pairing starts behind it', () => {
    const t = app('unpaired', { signin: 'error' });
    expect(screen.getByRole('heading', { name: 'Vos agents, dans la poche' })).toBeInTheDocument();
    expect(t.calls).toEqual([]);
  });
});
