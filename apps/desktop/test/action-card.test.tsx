import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ActionCard, type ActionRowView } from '@ledge/ui/chat/ActionCard';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { fr } from '../src/i18n/fr';
import { en } from '../src/i18n/en';
import { chatCopy } from '../src/i18n/lang';

const AT = '2026-10-26T09:42:00.000Z';
const at = new Date(AT).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const verbs = fr.chat.action.verbs;
// The mockup's plan (docs/mockups/ledge-action-card.html), its verbs taken from the Desktop's own copy.
const plan: ActionRowView[] = [
  { summary: 'Passer **Nova** sur Opus 5.5, effort élevé', risk: 'reversible', verb: verbs['session.model'] },
  { summary: 'Archiver **Otto**', risk: 'reversible', verb: verbs['session.archive'] },
  { summary: 'Dissoudre l’équipe **ledge-roles**', risk: 'destructive', verb: verbs['team.dissolve'], detail: 'Ses 6 sessions retournent à la table commune.' }
];
const permission: ActionRowView = {
  summary: 'Accepter la demande de **Nova**', risk: 'destructive', verb: verbs['session.decide'], target: 'Nova',
  request: { kind: 'Bash', text: 'rm -rf packages/ledge/dist' }, deny: { summary: 'Refuser la demande de **Nova**' }
};
const show = (rows: ActionRowView[], o: { ignoredAt?: string } = {}) => render(
  <ChatCopyProvider value={chatCopy(fr)}><ActionCard rows={rows} {...o} onApply={vi.fn()} onDeny={vi.fn()} onIgnore={vi.fn()} onReview={vi.fn()} onOpen={vi.fn()} /></ChatCopyProvider>
);

describe('the action card in the Desktop\'s words (#94)', () => {
  it('a plan, as the mockup words it', () => {
    show(plan);
    expect(screen.getByRole('region', { name: 'Plan de 3 actions' })).toBeTruthy();
    for (const name of ['Changer', 'Archiver', 'Dissoudre…', 'Tout appliquer (3)…', 'Ignorer']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(document.body).toHaveTextContent('Irréversible');
    expect(document.body).toHaveTextContent('· je te redemanderai');
    expect(document.body).toHaveTextContent('dans l’ordre, s’arrête au premier échec · 1 irréversible, je te redemanderai');
    fireEvent.click(screen.getByRole('button', { name: 'Tout appliquer (3)…' }));
    const confirm = screen.getByRole('group', { name: 'Confirmation' });
    expect(confirm).toHaveTextContent('Appliquer ces 3 actions, dans l’ordre ?');
    expect(confirm).toHaveTextContent('Une est irréversible : relis son détail ci-dessus. Si une étape échoue, les suivantes ne sont pas appliquées.');
    expect(within(confirm).getByRole('button', { name: 'Appliquer les 3' })).toBeTruthy();
  });

  it('after a failure, a refusal, and once applied', () => {
    const { unmount } = show(plan.map((r, i) => (i === 0 ? { ...r, state: 'done', doneAt: AT } : i === 1 ? { ...r, state: 'failed', error: 'Otto est sur la machine Atlas, hors ligne.' } : r)));
    expect(document.body).toHaveTextContent('Échec : Otto est sur la machine Atlas, hors ligne.');
    expect(document.body).toHaveTextContent('Pas appliquée : le plan s’est arrêté à l’étape 2.');
    expect(screen.getByRole('button', { name: 'Reprendre à l’étape 2 (2)…' })).toBeTruthy();
    unmount();
    const r = show(plan.map((x, i) => (i === 0 ? { ...x, state: 'done', doneAt: AT } : i === 1 ? { ...x, state: 'refused', error: 'Otto a été fermé entre-temps.' } : x)));
    expect(document.body).toHaveTextContent('Refusée : Otto a été fermé entre-temps. Rien n’a été envoyé.');
    expect(screen.getByRole('button', { name: 'Continuer sans l’étape 2 (1)…' })).toBeTruthy();
    r.unmount();
    show(plan.map(x => ({ ...x, state: 'done' as const, doneAt: AT })));
    expect(document.body).toHaveTextContent(`Plan appliqué à ${at}`);
  });

  it('a permission: Accepter… and Refuser; the denial sent, in grey', () => {
    const { unmount } = show([permission]);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Ignorer', 'Refuser', 'Accepter…']);
    unmount();
    show([{ ...permission, state: 'denied', doneAt: AT }]);
    expect(document.body).toHaveTextContent('Refuser la demande de Nova');
    expect(document.body).toHaveTextContent(`Refus envoyé · ${at}`);
    expect(document.body).toHaveTextContent('Nova a reçu ton refus : la commande n’a pas été lancée.');
  });

  it('ignored, folded into a line', () => {
    show(plan, { ignoredAt: AT });
    expect(document.body).toHaveTextContent(`Plan de 3 actions ignoré à ${at} · rien n’a été envoyé`);
    expect(screen.getByRole('button', { name: 'Revoir' })).toBeTruthy();
  });

  it('English has a verb for each action French has', () => {
    expect(Object.keys(en.chat.action.verbs).sort()).toEqual(Object.keys(fr.chat.action.verbs).sort());
  });
});
