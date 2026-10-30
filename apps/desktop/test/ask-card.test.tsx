import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetAsk } from '@ledge/fleet';
import { LangProvider } from '../src/i18n/lang';
import { AskCard } from '../src/shell/sidebar/AskCard';

afterEach(cleanup);

const NOW = '2026-10-30T08:00:00.000Z';
const ASK: FleetAsk = { id: 'a1b2c34', from: 's1', fromName: 'Nova', question: 'Quelle base ?', options: 'A ou B (je recommande B)', at: NOW, state: 'open', machine: 'local' };
const show = (onAnswer: Parameters<typeof AskCard>[0]['onAnswer']) => render(<LangProvider lang="fr"><AskCard ask={ASK} onAnswer={onAnswer} /></LangProvider>);

describe('the ask card', () => {
  it('shows « Décision · de Nova », the question, the options, and sends the trimmed answer', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn().mockResolvedValue({ ok: true });
    show(onAnswer);
    expect(screen.getByText('Décision')).toBeVisible();
    expect(screen.getByText('de Nova')).toBeVisible();
    expect(screen.getByText('Quelle base ?')).toBeVisible();
    expect(screen.getByText('A ou B (je recommande B)')).toBeVisible();
    await user.type(screen.getByPlaceholderText('Ta réponse…'), '  B  ');
    await user.click(screen.getByRole('button', { name: 'Répondre' }));
    expect(onAnswer).toHaveBeenCalledWith('B');
    expect(await screen.findByText('Réponse envoyée à Nova')).toBeVisible();
  });

  it('« Répondre » is disabled while the field is blank, and while sending', async () => {
    const user = userEvent.setup();
    let settle!: (r: { ok: true }) => void;
    const onAnswer = vi.fn(() => new Promise<{ ok: true }>(r => { settle = r; }));
    show(onAnswer);
    const send = () => screen.getByRole('button', { name: /Répondre|Envoi…/ });
    expect(send()).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Ta réponse…'), '   ');
    expect(send()).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Ta réponse…'), 'B');
    expect(send()).toBeEnabled();
    await user.click(send());
    expect(send()).toBeDisabled();
    expect(send()).toHaveTextContent('Envoi…');
    settle({ ok: true });
    await waitFor(() => expect(screen.getByText('Réponse envoyée à Nova')).toBeVisible());
  });

  it('a refusal shows « Refusé : déjà répondue » and keeps the text', async () => {
    const user = userEvent.setup();
    show(vi.fn().mockResolvedValue({ ok: false, reason: 'déjà répondue' }));
    await user.type(screen.getByPlaceholderText('Ta réponse…'), 'B');
    await user.click(screen.getByRole('button', { name: 'Répondre' }));
    expect(await screen.findByText('Refusé : déjà répondue')).toBeVisible();
    expect(screen.getByPlaceholderText('Ta réponse…')).toHaveValue('B');
    expect(screen.getByRole('button', { name: 'Répondre' })).toBeEnabled();
  });

  it('a rejected answer shows the refused state with the error message and keeps the text', async () => {
    const user = userEvent.setup();
    show(vi.fn().mockRejectedValue(new Error('daemon injoignable')));
    await user.type(screen.getByPlaceholderText('Ta réponse…'), 'B');
    await user.click(screen.getByRole('button', { name: 'Répondre' }));
    expect(await screen.findByText('Refusé : daemon injoignable')).toBeVisible();
    expect(screen.getByPlaceholderText('Ta réponse…')).toHaveValue('B');
    expect(screen.getByRole('button', { name: 'Répondre' })).toBeEnabled();
  });
});
