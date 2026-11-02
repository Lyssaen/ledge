import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { askFocus, loadDraft, saveDraft } from '../../src/state/drafts';
import { session } from '../model/fixtures';
import { at, prompt, rigHandoff, rigNotice, rigReceived, rigSent } from '../model/rig-fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

function opened(items: ThreadItem[]) {
  const t = setup();
  t.deliver(snapshot([session('lu', { name: 'Lu', topic: 'Maquettes', state: 'idle' }), session('bix', { name: 'Bix', state: 'idle' })]));
  const view = render(<Thread store={t.store} sessionId="lu" storage={t.storage} />);
  act(() => t.deliver({ type: 'session.thread', id: 'lu', items, cut: [], more: false }));
  return { ...t, view };
}

describe('OpenRig in the phone thread', () => {
  it('shows a received rig send as the sender\'s bubble on the left, never as « moi »', () => {
    opened([rigReceived('r1', at(19, 1), 'Validation maquette encoche.', {}, 'bix')]);
    const bubble = screen.getByRole('article', { name: 'De Bix' });
    expect(within(bubble).getByText('Bix').tagName).toBe('STRONG');
    expect(within(bubble).getByText('pilot-lead')).toHaveClass('font-mono');
    expect(within(bubble).getByText('Validation maquette encoche.')).toBeInTheDocument();
    expect(screen.getByText('19:01')).toBeInTheDocument();
    expect(bubble.parentElement).toHaveClass('items-start');
  });

  it('unfolds the raw text under « Brut », and folds it again', () => {
    opened([rigReceived('r1', at(19, 1), 'Corps', {}, 'bix')]);
    expect(screen.queryByText(/↩ Reply: rig send/)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Brut' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/↩ Reply: rig send pilot-lead@ledge-dev-2/)).toHaveClass('font-mono');
    fireEvent.click(toggle);
    expect(screen.queryByText(/↩ Reply: rig send/)).not.toBeInTheDocument();
  });

  it('« Répondre » opens the sender\'s thread, its draft prefixed', () => {
    const t = opened([rigReceived('r1', at(19, 1), 'Validation maquette encoche.\nSuite', {}, 'bix')]);
    const link = screen.getByRole('link', { name: 'Répondre à Bix' });
    expect(link).toHaveAttribute('href', '#/thread/bix');
    fireEvent.click(link);
    expect(loadDraft('bix', t.storage)).toBe('À propos de : « Validation maquette encoche. » ');
  });

  it('keeps what was typed for the sender after the prefix', () => {
    const t = opened([rigReceived('r1', at(19, 1), 'Question', {}, 'bix')]);
    saveDraft('bix', 'mon brouillon', t.storage);
    fireEvent.click(screen.getByRole('link', { name: 'Répondre à Bix' }));
    expect(loadDraft('bix', t.storage)).toBe('À propos de : « Question » mon brouillon');
  });

  it('opens the sender\'s composer focused, the cursor after the prefix', () => {
    const t = setup();
    t.deliver(snapshot([session('bix', { name: 'Bix', state: 'idle' })]));
    saveDraft('bix', 'À propos de : « x » ', t.storage);
    askFocus('bix');
    render(<Thread store={t.store} sessionId="bix" storage={t.storage} />);
    const field = screen.getByLabelText('Message pour Bix') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(field.value.length);
  });

  it('offers no « Répondre » when the sender has no Ledge session', () => {
    opened([rigReceived('r1', at(19, 1), 'Salut', { from: 'operator-agent@kernel' })]);
    expect(screen.getByRole('article', { name: 'De operator-agent' })).toBeInTheDocument();
    expect(screen.getByText('kernel')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Répondre/ })).not.toBeInTheDocument();
  });

  it('marks a block received twice', () => {
    opened([rigReceived('r1', at(19, 47), 'Option A', { count: 2 }, 'bix')]);
    expect(screen.getByText('reçu 2 fois')).toBeInTheDocument();
  });

  it('shows a handoff as the violet task card, its state not tracked, and no « Ouvrir »', () => {
    opened([rigHandoff('h1', at(19, 2), 'Retouche maquette encoche : bouton lecture/pause en icône simple', {}, { peer: 'bix' })]);
    const card = screen.getByRole('region', { name: 'Confiée par Bix' });
    expect(within(card).getByRole('heading', { name: /Retouche maquette encoche/ })).toHaveClass('line-clamp-2');
    expect(within(card).getByText('état non suivi')).toHaveClass('border-dashed');
    expect(within(card).queryByText(/Ouvrir/)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Brut' })).toBeInTheDocument();
  });

  it('shows a row the seat passed as « Passée à », its command under « Commande »', () => {
    opened([rigHandoff('h2', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2' }, { outgoing: true, peer: 'bix' })]);
    const card = screen.getByRole('region', { name: 'Passée à Bix' });
    expect(within(card).getByRole('button', { name: 'Commande' })).toBeInTheDocument();
  });

  it('says « non transmise » in red on a handoff OpenRig refused, its output under « Commande », no retry', () => {
    const item = { ...rigHandoff('h3', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2', raw: 'rig queue handoff qitem-x --to pilot-lead@ledge-dev-2\nError: destination unknown' }, { outgoing: true, peer: 'bix' }), status: 'refused' } as ThreadItem;
    opened([item]);
    const card = screen.getByRole('region', { name: 'Passée à Bix' });
    expect(within(card).getByText('non transmise')).toHaveClass('text-danger-fg', 'bg-danger-bg');
    expect(within(card).queryByText('état non suivi')).not.toBeInTheDocument();
    expect(within(card).getByText('passée 19:04 · OpenRig : Error: destination unknown')).toBeInTheDocument();
    expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Commande']);
    fireEvent.click(within(card).getByRole('button', { name: 'Commande' }));
    expect(within(card).getByText(/rig queue handoff qitem-x[\s\S]*Error: destination unknown/, { selector: 'pre' })).toBeInTheDocument();
  });

  it('shows the seat\'s own rig send on the right, with its delivery', () => {
    opened([rigSent('s1', at(19, 3), 'Maquette validée', 'delivered')]);
    const bubble = screen.getByRole('article', { name: 'À dev-front' });
    expect(bubble.parentElement).toHaveClass('items-end');
    expect(within(bubble).getByText('✓ remis')).toBeInTheDocument();
    fireEvent.click(within(bubble).getByRole('button', { name: 'Commande' }));
    expect(within(bubble).getByText(/Sent to dev-front/)).toBeInTheDocument();
  });

  it('shows OpenRig\'s notices as quiet lines, a stalled row in amber, consecutive ones folded', () => {
    const quiet = (id: string) => rigNotice(id, at(19, 46), `Custody not checked ${id}`, { kind: 'openrig', alert: 'custody' });
    opened([
      rigNotice('n1', at(19, 20), 'Blocker …', { kind: 'unblocked', qitem: 'qitem-20261102184941-4389f392504db9e3' }),
      rigNotice('n2', at(19, 45), 'Stuck sweep', { kind: 'openrig', alert: 'stalled', qitem: 'qitem-20261102193758-ffc1de6e4e82ffc1', minutes: 7 }),
      quiet('q1'), quiet('q2')
    ]);
    expect(screen.getByText('Blocage levé : la ligne …b9e3 est de nouveau à faire')).toBeInTheDocument();
    expect(screen.getByText('Ligne …ffc1 sans suite depuis 7 min')).toHaveClass('text-attention');
    const fold = screen.getByRole('button', { name: /2 avis OpenRig/ });
    expect(screen.queryByText('Custody not checked q1')).not.toBeInTheDocument();
    fireEvent.click(fold);
    expect(screen.getByText('Custody not checked q1')).toBeInTheDocument();
    expect(screen.getByText('Custody not checked q2')).toBeInTheDocument();
  });

  it('shows an unreadable block as is', () => {
    const raw = 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance';
    opened([rigNotice('u1', at(19, 50), raw, { kind: 'unreadable' })]);
    expect(screen.getByText('Message OpenRig illisible · affiché tel quel')).toBeInTheDocument();
    expect(screen.getByText(/Relance/).tagName).toBe('PRE');
  });

  it('gives pasted blocks one raw for the packet', () => {
    const packet = (index: number) => ({ packet: { id: 'p1', index, count: 2 } });
    opened([rigReceived('a', at(19, 49), 'Oui, now', { ...packet(0), from: 'operator-agent@kernel' }), rigReceived('b', at(19, 49), 'Ligne créée', packet(1), 'bix')]);
    expect(screen.queryByRole('button', { name: 'Brut' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '2 messages collés ensemble · brut' });
    // its own row after the group, not inside a bubble
    expect(toggle.closest('article')).toBeNull();
    const last = screen.getByRole('article', { name: 'De Bix' });
    expect(last.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    const pre = screen.getByText(/Oui, now[\s\S]*Ligne créée/, { selector: 'pre' });
    expect(pre).toHaveClass('font-mono');
    expect(pre.closest('article')).toBeNull();
    expect(screen.getAllByText('19:49')).toHaveLength(1);
  });

  it('shows the raw row of a packet of quiet notices after the fold, folded or open', () => {
    const quiet = (id: string, index: number) => rigNotice(id, at(19, 46), `Custody not checked ${id}`, { kind: 'openrig', alert: 'custody', packet: { id: 'p2', index, count: 3 } });
    opened([rigReceived('m', at(19, 46), 'Salut', { packet: { id: 'p2', index: 0, count: 3 } }, 'bix'), quiet('q1', 1), quiet('q2', 2)]);
    const fold = screen.getByRole('button', { name: /2 avis OpenRig/ });
    const raw = () => screen.getByRole('button', { name: '3 messages collés ensemble · brut' });
    expect(fold.compareDocumentPosition(raw()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Brut' })).not.toBeInTheDocument();
    fireEvent.click(fold);
    expect(screen.getByText('Custody not checked q2').compareDocumentPosition(raw()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Brut' })).not.toBeInTheDocument();
    fireEvent.click(raw());
    expect(screen.getByText(/Salut[\s\S]*Custody not checked q2/, { selector: 'pre' })).toBeInTheDocument();
  });

  it('keeps the user\'s own prompt as theirs', () => {
    opened([rigReceived('r1', at(19, 1), 'a', {}, 'bix'), prompt('p1', at(19, 52), 'Regarde aussi le mobile.')]);
    const mine = screen.getByText('Regarde aussi le mobile.');
    expect(mine.closest('article')).toBeNull();
    expect(mine.parentElement).toHaveClass('items-end');
  });
});
