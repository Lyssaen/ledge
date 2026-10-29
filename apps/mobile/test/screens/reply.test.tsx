import { act, fireEvent, render, screen } from '@testing-library/react';
import { MESSAGE_MAX, type PhoneServerMessage } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

function opened() {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile' })]));
  render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
  return t;
}

describe('an instruction from the phone', () => {
  it('longer than a message can be is stopped before sending', () => {
    const t = opened();
    fireEvent.change(screen.getByLabelText('Message pour Kai'), { target: { value: 'x'.repeat(MESSAGE_MAX + 1) } });
    expect(screen.getByText(`Le message est trop long : ${MESSAGE_MAX} caractères au plus.`)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Envoyer à Kai' });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(t.of('session.reply')).toEqual([]);
  });

  it('with a character the terminal cannot type is flagged, and not sent', () => {
    const t = opened();
    fireEvent.change(screen.getByLabelText('Message pour Kai'), { target: { value: 'Relance\nles tests' } });
    expect(screen.getByText('Le message doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Envoyer à Kai' });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(t.of('session.reply')).toEqual([]);
  });

  it('a trailing line break is not counted against it', () => {
    const t = opened();
    fireEvent.change(screen.getByLabelText('Message pour Kai'), { target: { value: 'Lance les tests\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Kai' }));
    expect(t.of('session.reply')).toMatchObject([{ text: 'Lance les tests' }]);
  });

  it('takes Enter as send, never as a line break', () => {
    const t = opened();
    const field = screen.getByLabelText('Message pour Kai');
    expect(field).toHaveAttribute('enterkeyhint', 'send');
    fireEvent.change(field, { target: { value: 'Lance les tests' } });
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false);
    expect(t.of('session.reply')).toMatchObject([{ text: 'Lance les tests' }]);
  });
});

describe('the model chip in the quick row', () => {
  it('no empty quick row when the composer is off and there is no chip', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Kai', state: 'working', canSwitch: true })]));
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect(screen.queryByRole('group', { name: 'Consignes rapides' })).toBeNull();
  });

  it('sits before the first quick reply', () => {
    const t = setup();
    const sn = snapshot([session('a', { name: 'Kai', model: 'opus', canSwitch: true })]) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...sn, daemon: { ...sn.daemon!, models: true } });
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    const row = screen.getByRole('group', { name: 'Consignes rapides' });
    expect(row.firstElementChild).toBe(screen.getByRole('button', { name: /Modèle et effort :/ }));
    expect(row.children.length).toBeGreaterThan(1);
  });
});
