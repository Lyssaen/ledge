import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BrainChoice, Task } from '@ledge/protocol';
import { NoteDecision } from '../src/tasks/NoteDecision';
import { LangProvider } from '../src/i18n/lang';

afterEach(() => cleanup());

const T0 = '2026-11-04T10:00:00.000Z';
const task = (brain: NonNullable<Task['brain']>): Task & { brain: NonNullable<Task['brain']> } => ({
  id: 't000001', title: 'x', giver: 'a', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [], brain
});
const show = (t: ReturnType<typeof task>, reason?: string) => {
  const answerNote = vi.fn(async (_task: string, _choice: BrainChoice) => reason);
  render(<LangProvider lang="fr"><NoteDecision task={t} api={{ answerNote }} /></LangProvider>);
  return answerNote;
};

describe('NoteDecision (docs/mockups/ledge-brain-notes.html, part 1)', () => {
  it('shows the fact and its source; « Ajouter » writes it as proposed, « Refuser » writes nothing', async () => {
    const answer = show(task({ kind: 'add', note: 'machines', fact: 'Le Pi a 906 Mo de RAM', source: 'free -h' }));
    expect(screen.getByText('Nova propose d’ajouter à la note machines')).toBeVisible();
    expect(screen.getByText('Le Pi a 906 Mo de RAM')).toBeVisible();
    expect(screen.getByText('Source : free -h')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('t000001', { yes: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(answer).toHaveBeenLastCalledWith('t000001', { yes: false }));
  });
  it('« Modifier » makes the fact a field; « Ajouter ce texte » sends the user\'s one line', async () => {
    const answer = show(task({ kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Le texte ajouté sous « Ajouts »'), { target: { value: 'Le Pi a\n906 Mo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce texte' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('t000001', { yes: true, text: 'Le Pi a 906 Mo' }));
  });
  it('a new note: its title and when are corrected before « Créer la note »; a flag has its own buttons; a refusal is said', async () => {
    const answer = show(task({ kind: 'add', note: 'bots', create: true, fact: 'x', title: 'Bots' }));
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Les bots de la tablette' } });
    fireEvent.change(screen.getByLabelText('Quand la lire'), { target: { value: 'un bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la note' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('t000001', { yes: true, title: 'Les bots de la tablette', when: 'un bot' }));
    cleanup();
    show(task({ kind: 'flag', note: 'reseau', fact: 'la box a changé' }), 'la tâche t000001 est déjà close (done)');
    expect(screen.getByText('Nova signale la note reseau comme fausse ou périmée')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Marquer à revoir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refusé : la tâche t000001 est déjà close (done)');
    expect(screen.getByRole('button', { name: 'Ignorer' })).toBeVisible();
  });
});
