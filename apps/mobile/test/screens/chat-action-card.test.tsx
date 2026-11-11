import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneChatAction, PhoneChatTurn } from '@ledge/protocol';
import { copy, setLang } from '../../src/copy';
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
const cancel: PhoneChatAction = { action: 'task.cancel', summary: 'Annuler la tâche « Revue » de **Otto**', vars: { task: 'Revue', owner: 'Otto' }, risk: 'destructive', detail: 'Otto est prévenu et arrête la tâche.' };
const card = () => screen.getByRole('region', { name: /Action proposée|Plan de/ });

describe('the action card', () => {
  // M3 §5, Q34: an OpenRig row's button is its line's verb; without one, the action's own (Appliquer / Changer).
  it('an OpenRig row says its verb on its button', () => {
    open({ actions: [
      { action: 'rig.act', summary: 'Redémarrer le rig **ledge-dev**', vars: { kind: 'rig.restart', rig: 'ledge-dev' }, risk: 'destructive' },
      { action: 'rig.act', summary: 'Prendre une action sur **ledge-dev**', vars: { kind: 'rig.unknown', rig: 'ledge-dev' }, risk: 'reversible' }
    ] });
    expect(within(card()).getByRole('button', { name: 'Redémarrer…' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Appliquer…' })).toBeInTheDocument();
  });

  // Q85: the sheet of an irreversible OpenRig step says what it stops, from the daemon's list; without it, « Irréversible » alone.
  describe('what an OpenRig step stops, in its sheet (Q85)', () => {
    const sheetOf = (a: PhoneChatAction, verb: string) => {
      open({ actions: [a] });
      fireEvent.click(within(card()).getByRole('button', { name: `${verb}…` }));
      return screen.getByRole('dialog');
    };
    const rig = (kind: string, seats: Record<string, string>): PhoneChatAction =>
      ({ action: 'rig.act', summary: 'Rig **ledge-dev**', vars: { kind, rig: 'ledge-dev', ...seats }, risk: 'destructive' });

    it('a restart: its seats stop, then start again', () => {
      const s = sheetOf(rig('rig.restart', { seats: 'lead, dev-front, dev-back, reviewer, design-ux', seatCount: '5' }), 'Redémarrer');
      expect(within(s).getByText('Ses 5 sièges s’arrêtent puis redémarrent : lead, dev-front, dev-back, reviewer, design-ux.')).toBeInTheDocument();
    });
    it('a stop of the kernel, its list cut by the PC', () => {
      const s = sheetOf(rig('kernel.stop', { seats: 'operator, advisor', seatCount: '5', seatsMore: '3' }), 'Arrêter');
      expect(within(s).getByText('Ses 5 sièges s’arrêtent : operator, advisor … et 3 autres.')).toBeInTheDocument();
    });
    it('one seat', () => {
      const s = sheetOf(rig('rig.stop', { seats: 'lead', seatCount: '1' }), 'Arrêter');
      expect(within(s).getByText('Son siège s’arrête : lead.')).toBeInTheDocument();
    });
    it('removed seats', () => {
      const s = sheetOf({ action: 'rig.seats', summary: 'Retirer', vars: { rig: 'ledge-dev', role: 'dev.back', count: '1', from: '3', seats: 'dev-back-2, dev-back-3', seatCount: '2' }, risk: 'destructive' }, 'Retirer');
      expect(within(s).getByText('Les 2 sièges retirés s’arrêtent : dev-back-2, dev-back-3.')).toBeInTheDocument();
    });
    it('without the list, « Irréversible » alone', () => {
      const s = sheetOf(rig('rig.restart', {}), 'Redémarrer');
      expect(within(s).getByText(C.risk.destructive)).toBeInTheDocument();
      expect(within(s).queryByText(/sièges? .*s’arrête/)).toBeNull();
    });
    it('in English', () => {
      setLang('en');
      try {
        const en = copy.chat.action.stops;
        expect(en('stop', 5, 'lead, dev-front', 3)).toBe('Its 5 seats stop: lead, dev-front … and 3 more.');
        expect(en('restart', 3, 'a, b, c', 0)).toBe('Its 3 seats stop, then start again: a, b, c.');
        expect(en('removed', 2, 'dev-back-2, dev-back-3', 0)).toBe('The 2 removed seats stop: dev-back-2, dev-back-3.');
        expect(en('stop', 1, 'lead', 0)).toBe('Its seat stops: lead.');
        expect(en('restart', 1, 'lead', 0)).toBe('Its seat stops, then starts again: lead.');
        expect(en('removed', 1, 'dev-back-2', 0)).toBe('The removed seat stops: dev-back-2.');
      } finally { setLang('fr'); }
    });
  });

  // Review caeb9e32: one background per element, so the fill is not lost to another class (m3-chat.html §5).
  describe('the red fills (review caeb9e32)', () => {
    const bgs = (el: Element) => [...el.classList].filter(c => /^!?bg-/.test(c));
    it('the sheet’s confirm button is filled red, its outline background overridden', () => {
      open({ actions: [cancel] });
      fireEvent.click(within(card()).getByRole('button', { name: 'Abandonner…' }));
      const go = within(screen.getByRole('dialog')).getByRole('button', { name: copy.confirm.go });
      expect(go).toHaveClass('!bg-destructive', '!text-primary-fg', '!border-transparent');
    });
    it('a failed or refused step is a red disc with its ✕; an open one keeps the card’s background', () => {
      open({ actions: [{ ...archive, state: 'refused', code: 'unchanged' }, { ...cancel, state: 'failed', code: 'failed' }, archive] });
      for (const name of [C.stepState.refused(1), C.stepState.failed(2)]) expect(bgs(screen.getByRole('img', { name }))).toEqual(['bg-destructive']);
      expect(bgs(screen.getByRole('img', { name: C.step(3) }))).toEqual(['bg-surface']);
    });
  });

  it('draws a cancellation with its risk, and confirms it in a sheet before any check', async () => {
    const t = open({ actions: [cancel] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(within(card()).getByText('Otto').tagName).toBe('STRONG');
    expect(within(card()).getByText(C.risk.destructive)).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole('button', { name: 'Abandonner…' }));
    expect(spy).not.toHaveBeenCalled();
    const sheet = screen.getByRole('dialog', { name: 'Annuler la tâche « Revue » de Otto ?' });
    expect(within(sheet).getByText(cancel.detail!)).toBeInTheDocument();
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
    const t = open({ actions: [archive, cancel] });
    const spy = vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'applied' });
    expect(screen.getByRole('region', { name: C.label(2) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `${C.all(2)}…` }));
    const sheet = screen.getByRole('dialog', { name: C.sheet.many(2) });
    fireEvent.click(within(sheet).getByRole('button', { name: copy.confirm.go }));
    expect(spy).toHaveBeenCalledWith(QID, [0, 1], undefined);
  });

  it('after a failed step, holds the next ones and resumes from it', () => {
    open({ actions: [{ ...archive, state: 'done', doneAt: '2026-10-30T10:01:00.000Z' }, { ...cancel, state: 'failed', code: 'closed' }, archive] });
    expect(screen.getByRole('alert').textContent).toBe('Échec : la tâche « Revue » est déjà close.');
    expect(screen.getByText(C.held(2))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${C.resume(2, 2)}…` })).toBeInTheDocument();
  });

  it('says a cancelled check sent nothing', async () => {
    const t = open({ actions: [cancel] });
    vi.spyOn(t.store, 'act').mockResolvedValue({ status: 'cancelled' });
    fireEvent.click(within(card()).getByRole('button', { name: 'Abandonner…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.confirm.go }));
    expect(await screen.findByText(copy.confirm.cancelled)).toBeInTheDocument();
  });

  it('without a passkey, a checked row cannot be applied and Connexion is pointed to', () => {
    open({ actions: [cancel] }, false);
    expect(within(card()).getByRole('button', { name: 'Abandonner…' })).toBeDisabled();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '#/connection');
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
    const t = open({ actions: [archive, cancel] });
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
    const t = open({ actions: [cancel] }, false);
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
