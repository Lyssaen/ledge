import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneChatAction, PhoneChatTurn } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { getAssertion } from '../../src/link/webauthn';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const QID = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const C = copy.chat.action;

function open(turn: Partial<PhoneChatTurn>, confirm = true) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Nova', repo: 'ledge' }), session('b', { name: 'Otto', repo: 'ledge' })], 'Atelier', undefined, { confirm, chat: true }));
  t.deliver(chat.history(chat.turn(QID, { answer: 'Voilà.', answeredAt: '2026-10-30T10:00:05.000Z', ...turn })));
  render(<Chat store={t.store} />);
  return t;
}
const archive: PhoneChatAction = { action: 'session.archive', summary: 'Archiver **Otto**', vars: { session: 'Otto' }, risk: 'reversible', session: 'b' };
const dissolve: PhoneChatAction = { action: 'team.dissolve', summary: 'Dissoudre l’équipe **workshop**', vars: { team: 'workshop' }, risk: 'destructive', team: 'team-1', detail: 'Ses 6 sessions retournent à la table commune.' };
const card = () => screen.getByRole('region', { name: /Action proposée|Plan de/ });

describe('the action card', () => {
  it('draws a dissolution with its risk, and confirms it in a sheet before any check', async () => {
    const t = open({ actions: [dissolve] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(within(card()).getByText('workshop').tagName).toBe('STRONG');
    expect(within(card()).getByText(C.risk.destructive)).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole('button', { name: 'Dissoudre…' }));
    expect(spy).not.toHaveBeenCalled();
    const sheet = screen.getByRole('dialog', { name: 'Dissoudre l’équipe workshop ?' });
    expect(within(sheet).getByText(dissolve.detail!)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: copy.confirm.go }));
    expect(spy).toHaveBeenCalledWith(QID, [0], undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('applies a reversible row with no device check at the tap', () => {
    const t = open({ actions: [archive] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    fireEvent.click(within(card()).getByRole('button', { name: 'Archiver' }));
    expect(spy).toHaveBeenCalledWith(QID, [0], undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a plan: steps in order, « Tout appliquer » sends every open row through one sheet', () => {
    const t = open({ actions: [archive, dissolve] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(screen.getByRole('region', { name: C.label(2) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `${C.all(2)}…` }));
    const sheet = screen.getByRole('dialog', { name: C.sheet.many(2) });
    fireEvent.click(within(sheet).getByRole('button', { name: copy.confirm.go }));
    expect(spy).toHaveBeenCalledWith(QID, [0, 1], undefined);
  });

  it('after a failed step, holds the next ones and resumes from it', () => {
    open({ actions: [{ ...archive, state: 'done', doneAt: '2026-10-30T10:01:00.000Z' }, { ...dissolve, state: 'failed', code: 'dissolved' }, archive] });
    expect(screen.getByRole('alert').textContent).toBe('Échec : l’équipe workshop a été dissoute entre-temps.');
    expect(screen.getByText(C.held(2))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${C.resume(2, 2)}…` })).toBeInTheDocument();
  });

  it('says a cancelled check sent nothing', async () => {
    const t = open({ actions: [dissolve] });
    vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'cancelled' });
    fireEvent.click(within(card()).getByRole('button', { name: 'Dissoudre…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.confirm.go }));
    expect(await screen.findByText(copy.confirm.cancelled)).toBeInTheDocument();
  });

  it('without a passkey, a checked row cannot be applied and Connexion is pointed to', () => {
    open({ actions: [dissolve] }, false);
    expect(within(card()).getByRole('button', { name: 'Dissoudre…' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
  });

  it('« Ignorer » sets the turn aside, and an ignored card folds into a line with « Revoir »', async () => {
    const t = open({ actions: [archive] });
    const spy = vi.spyOn(t.store, 'ignoreTurn').mockResolvedValue({ status: 'applied' });
    fireEvent.click(within(card()).getByRole('button', { name: C.ignore }));
    expect(spy).toHaveBeenCalledWith(QID, undefined);
    t.deliver(chat.history(chat.turn(QID, { answer: 'Voilà.', answeredAt: '2026-10-30T10:00:05.000Z', actions: [archive], ignoredAt: '2026-10-30T10:42:00.000Z' })));
    await waitFor(() => expect(screen.queryByRole('region', { name: C.label(1) })).toBeNull());
    expect(screen.getByText(/Carte ignorée à .* · rien n’a été envoyé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: C.review }));
    expect(spy).toHaveBeenLastCalledWith(QID, true);
  });

  it('a request too long for the phone is refused from here and accepted on the PC', () => {
    const t = open({ actions: [{ action: 'session.decide', summary: 'Accepter la demande de permission de **Nova**', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, risk: 'destructive', session: 'a', detail: 'rm -rf build', detailCut: true }] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(screen.getByText(copy.decide.onPc)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accepter…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: C.deny }));
    expect(spy).toHaveBeenCalledWith(QID, [0], { deny: true });
  });
});

describe('store.act', () => {
  it('signs a checked row with an `act` challenge over the turn and sends it confirmed', async () => {
    const t = open({ actions: [archive, dissolve] });
    vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
    const p = t.store.act(QID, [1]);
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'act', qid: QID }]));
    t.deliver({ type: 'confirm.challenge', purpose: 'act', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 });
    await waitFor(() => expect(t.of('chat.act')).toHaveLength(1));
    const [sent] = t.of('chat.act');
    expect(sent).toMatchObject({ qid: QID, rows: [1], confirmed: true, assertion: { id: 'a' } });
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' });
    await expect(p).resolves.toEqual({ status: 'applied' });
  });

  it('sends a reversible row without a check, and a deny without one either', async () => {
    const t = open({ actions: [archive] });
    void t.store.act(QID, [0]);
    void t.store.act(QID, [0], { deny: true });
    await waitFor(() => expect(t.of('chat.act')).toHaveLength(2));
    expect(t.of('confirm.prepare')).toHaveLength(0);
    expect(t.of('chat.act')[0]).not.toHaveProperty('confirmed');
    expect(t.of('chat.act')[1]).toMatchObject({ deny: true });
  });

  it('refuses a checked row on a phone without a passkey, before asking anything', async () => {
    const t = open({ actions: [dissolve] }, false);
    await expect(t.store.act(QID, [0])).resolves.toEqual({ status: 'rejected', reason: 'confirm_required' });
    expect(t.of('confirm.prepare')).toHaveLength(0);
  });

  it('ignoreTurn sends chat.ignore, and its undo', async () => {
    const t = open({ actions: [archive] });
    void t.store.ignoreTurn(QID);
    await waitFor(() => expect(t.of('chat.ignore')).toHaveLength(1));
    expect(t.of('chat.ignore')[0]).toMatchObject({ qid: QID });
    expect(t.of('chat.ignore')[0]).not.toHaveProperty('undo');
  });
});
