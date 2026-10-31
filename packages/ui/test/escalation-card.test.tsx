import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { Escalation } from '@ledge/protocol';
import { EscalationCard } from '../src/chat/ledge/EscalationCard';
import { CategoryChip } from '../src/chat/ledge/CategoryChip';
import { DecidedLine } from '../src/chat/ledge/DecidedLine';
import { BrainStopped, isBrainStopped, LedgeBubble, UserBubble } from '../src/chat/ledge/ThreadBubbles';
import { useLedgeThreadCopy } from '../src/chat/ledge/copy';
import { Fr } from './ledge-thread-copy-fixture';

const NOW = '2026-10-30T16:48:00.000Z';
const sqlite: Escalation = {
  id: 'qi-1', source: 'rig', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', intent: 'decision',
  summary: 'Sessions : passer du fichier JSON à SQLite ?', createdAt: '2026-10-30T16:44:00.000Z', state: 'pending', category: 'architecture',
  advice: 'SQLite. Tu as écarté deux fois les fichiers plats.',
  questions: [{ id: 'q1', question: 'JSON ou SQLite ?', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Garder le JSON' }] }]
};
type Props = Parameters<typeof EscalationCard>[0];
const card = (over: Partial<Props> = {}) => {
  const p: Props = { escalation: sqlite, answer: { state: 'idle' }, onAnswer: vi.fn(), onTalk: vi.fn(), now: NOW, ...over };
  render(<Fr><EscalationCard {...p} /></Fr>);
  return p;
};

describe('EscalationCard', () => {
  it('shows advice, recommended option first-class, and sends the option id', () => {
    const p = card();
    expect(screen.getByText(/Mon avis : SQLite/)).toBeVisible();
    expect(screen.getByText('Architecture')).toHaveAttribute('data-tone', 'amber');
    expect(screen.getByText('orch-lead@factory')).toBeVisible();
    expect(screen.getByText('il y a 4 min')).toBeVisible();
    expect(screen.getByText('Sessions : passer du fichier JSON à SQLite ?')).toBeVisible();
    expect(screen.getByRole('button', { name: 'SQLite' })).toHaveAttribute('data-recommended');
    expect(screen.getByRole('button', { name: 'Garder le JSON' })).not.toHaveAttribute('data-recommended');
    fireEvent.click(screen.getByRole('button', { name: 'SQLite' }));
    expect(p.onAnswer).toHaveBeenCalledWith({ q1: 'sqlite' });
    fireEvent.click(screen.getByRole('button', { name: 'En parler' }));
    expect(p.onTalk).toHaveBeenCalled();
  });

  it('has no advice line nor chip when the escalation carries none', () => {
    card({ escalation: { ...sqlite, advice: undefined, category: undefined } });
    expect(screen.queryByText(/Mon avis/)).toBeNull();
    expect(document.querySelector('.lt-chip')).toBeNull();
  });

  it('compact shows the bare age', () => {
    card({ compact: true });
    expect(screen.getByText('4 min')).toBeVisible();
  });

  it('grace shows « Ledge s\'en occupe… » and keeps the buttons', () => {
    const p = card({ escalation: { ...sqlite, state: 'grace' } });
    expect(screen.getByText("Ledge s'en occupe…")).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Garder le JSON' }));
    expect(p.onAnswer).toHaveBeenCalledWith({ q1: 'json' });
  });

  it('disables the options while sending', () => {
    card({ answer: { state: 'sending' } });
    expect(screen.getByRole('button', { name: 'SQLite' })).toBeDisabled();
  });

  it('already_answered on an escalation back to pending or grace keeps the note and the buttons', () => {
    card({ answer: { state: 'refused', code: 'already_answered' } });
    expect(screen.getByText('Déjà répondu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'SQLite' })).toBeEnabled();
    cleanup();
    card({ escalation: { ...sqlite, state: 'grace', graceUntil: NOW }, answer: { state: 'refused', code: 'already_answered' } });
    expect(screen.getByText('Déjà répondu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'SQLite' })).toBeEnabled();
  });

  it('already_answered on a closed escalation shows « Déjà répondu » without buttons', () => {
    card({ escalation: { ...sqlite, state: 'closed' }, answer: { state: 'refused', code: 'already_answered' } });
    expect(screen.getByText('Déjà répondu')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'SQLite' })).toBeNull();
  });

  it('already_answered stays said when the escalation arrives answered, then the winner line', () => {
    card({ escalation: { ...sqlite, state: 'answered', answer: { by: 'ledge', answers: { q1: 'json' }, at: NOW } }, answer: { state: 'refused', code: 'already_answered' } });
    const outcomes = [...document.querySelectorAll('.lt-card-outcome')].map(n => n.textContent);
    expect(outcomes).toEqual(['Déjà répondu', 'Tranché par Ledge : Garder le JSON']);
    expect(screen.queryByRole('button', { name: 'SQLite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Garder le JSON' })).toBeNull();
  });

  it('forgets the picks of a previous escalation', () => {
    const qs = [
      { id: 'a', question: 'Base ?', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'json', label: 'JSON' }] },
      { id: 'b', question: 'Quand ?', options: [{ id: 'now', label: 'Maintenant' }, { id: 'later', label: 'Plus tard' }] }];
    const onAnswer = vi.fn();
    const at = (id: string) => <Fr><EscalationCard escalation={{ ...sqlite, id, questions: qs }} answer={{ state: 'idle' }} onAnswer={onAnswer} onTalk={vi.fn()} now={NOW} /></Fr>;
    const { rerender } = render(at('one'));
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    rerender(at('two'));
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('another refusal shows the reason and gives the buttons back', () => {
    const p = card({ answer: { state: 'refused', code: 'openrig_down', reason: 'OpenRig ne répond pas' } });
    expect(screen.getByText('OpenRig ne répond pas')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'SQLite' }));
    expect(p.onAnswer).toHaveBeenCalledWith({ q1: 'sqlite' });
  });

  it('answered by the user names the option label; by Ledge too', () => {
    card({ escalation: { ...sqlite, state: 'answered', answer: { by: 'user', answers: { q1: 'json' }, at: NOW } } });
    expect(screen.getByText('Répondu par toi : Garder le JSON')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'SQLite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'En parler' })).toBeNull();
  });

  it('answered by Ledge quotes free text as is', () => {
    card({ escalation: { ...sqlite, state: 'answered', answer: { by: 'ledge', answers: { q1: 'les deux' }, at: NOW } } });
    expect(screen.getByText('Tranché par Ledge : les deux')).toBeVisible();
  });

  it('an update shows « Vu » and sends empty answers', () => {
    const p = card({ escalation: { ...sqlite, intent: 'update', questions: [], advice: undefined, summary: 'starter relancé' } });
    expect(screen.queryByRole('button', { name: 'SQLite' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vu' }));
    expect(p.onAnswer).toHaveBeenCalledWith({});
  });

  it('several questions send once each has its choice', () => {
    const two: Escalation = { ...sqlite, summary: 'Deux choix', questions: [
      { id: 'a', question: 'Base ?', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'json', label: 'JSON' }] },
      { id: 'b', question: 'Quand ?', options: [{ id: 'now', label: 'Maintenant' }, { id: 'later', label: 'Plus tard' }] }] };
    const p = card({ escalation: two });
    expect(screen.getByText('Base ?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(p.onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(p.onAnswer).toHaveBeenCalledWith({ a: 'json', b: 'later' });
  });

  it('an ask has a one-line field that sends { text }', () => {
    const ask: Escalation = { ...sqlite, id: 'ask-1', source: 'ask', from: 'Luna', summary: 'Quel port ?', questions: [], advice: undefined, category: undefined };
    const p = card({ escalation: ask });
    const send = screen.getByRole('button', { name: 'Envoyer' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ta réponse' }), { target: { value: '  5173 ' } });
    fireEvent.click(send);
    expect(p.onAnswer).toHaveBeenCalledWith({ text: '5173' });
  });

  it('an answered ask quotes its text', () => {
    card({ escalation: { ...sqlite, source: 'ask', questions: [], state: 'answered', answer: { by: 'user', answers: { text: '5173' }, at: NOW } } });
    expect(screen.getByText('Répondu par toi : 5173')).toBeVisible();
  });
});

describe('the other thread pieces', () => {
  it('CategoryChip is neutral outside design, architecture and critical', () => {
    render(<Fr><CategoryChip category="git" /><CategoryChip category="critical" /></Fr>);
    expect(screen.getByText('Git et branches')).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByText('Critique')).toHaveAttribute('data-tone', 'amber');
  });

  it('DecidedLine says what Ledge settled and offers to revisit', () => {
    const onRevisit = vi.fn();
    const rule = { id: 'r1', text: 'merge', category: 'git' as const, since: '2026-10-26', from: 'user', appliedCount: 1, status: 'active' as const };
    render(<Fr><DecidedLine decision={{ id: 'd1', escalationId: 'qi-1', by: 'ledge', category: 'git', summary: 'merge, pas de rebase', answers: {}, rule: 'r1', why: 'branche partagée', at: NOW }} to="build" rule={rule} onRevisit={onRevisit} /></Fr>);
    expect(screen.getByText("J'ai tranché pour build : merge, pas de rebase.")).toBeVisible();
    expect(screen.getByText('Règle du 26/10')).toBeVisible();
    expect(screen.getByText('branche partagée')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revenir dessus' }));
    expect(onRevisit).toHaveBeenCalled();
  });

  it('DecidedLine falls back to the rule id when the rule is gone; BrainStopped offers Démarrer', () => {
    const onStart = vi.fn();
    render(<Fr><DecidedLine decision={{ id: 'd2', escalationId: 'qi-2', by: 'ledge', category: 'git', summary: 'relancer', answers: {}, rule: 'r9', at: NOW }} to="qa" />
      <BrainStopped onStartBrain={onStart} /></Fr>);
    expect(screen.getByText('Règle r9')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Revenir dessus' })).toBeNull();
    expect(screen.getByText('Ledge est arrêté')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Démarrer' }));
    expect(onStart).toHaveBeenCalled();
    expect(isBrainStopped('Ledge est arrêté · Démarrer')).toBe(true);
    expect(isBrainStopped('Ledge est arrêté')).toBe(false);
  });

  it('bubbles carry their author and time', () => {
    render(<Fr><LedgeBubble at="2026-10-30T16:44:00.000Z">salut</LedgeBubble><UserBubble at="2026-10-30T16:45:00.000Z" text="ok" /></Fr>);
    expect(screen.getByText('salut')).toBeVisible();
    expect(screen.getByText('Ledge')).toBeVisible();
    expect(screen.getByText('Toi')).toBeVisible();
  });

  it('useLedgeThreadCopy without a provider throws a clear error', () => {
    const Probe = () => { useLedgeThreadCopy(); return null; };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect(() => render(<Probe />)).toThrow('LedgeThreadCopyProvider missing'); }
    finally { quiet.mockRestore(); }
  });
});
