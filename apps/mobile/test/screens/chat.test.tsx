import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setCodecForTests } from '@ledge/ui/images';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import { Chat, suggestionsOf } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

const ON = { confirm: true, chat: true as const };
const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });

function chatSetup(sessions = [session('a', { name: 'Bix', repo: 'ledge' }), session('b', { name: 'Nova', repo: 'relay' })], device: { confirm: boolean; chat?: true } = ON) {
  const t = setup();
  t.deliver(snapshot(sessions, 'Atelier', undefined, device));
  render(<Chat store={t.store} />);
  return t;
}
const type = (text: string) => fireEvent.change(screen.getByLabelText('Question pour Ledge'), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Envoyer la question' }));

describe('the tab bar', () => {
  it('has the same five tabs whether the PC offers the chat or not, Ledge last', () => {
    const tabs = () => within(nav()).getAllByRole('link').map(a => a.textContent?.replace(/\d+$/, ''));
    const five = [copy.nav.atoi, copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.chat];
    const a = app('ready', { hash: '#/' });
    act(() => a.deliver(snapshot([session('a')])));
    expect(tabs()).toEqual(five);
    act(() => a.deliver(snapshot([session('a')], 'Atelier', undefined, ON)));
    expect(tabs()).toEqual(five);
    expect(within(nav()).getByRole('link', { name: copy.nav.chat })).toHaveAttribute('href', '#/chat');
  });

  it('#/chat without device.chat says the PC does not offer it, with no field, and stays there', () => {
    const a = app('ready', { hash: '#/chat' });
    act(() => a.deliver(snapshot([session('a')], 'WSL')));
    expect(screen.getByRole('heading', { name: copy.chat.unavailable.title('WSL') })).toBeInTheDocument();
    expect(screen.getByText(copy.chat.unavailable.body)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.chat.unavailable.seeAtoi })).toHaveAttribute('href', '#/');
    expect(screen.queryByLabelText('Question pour Ledge')).toBeNull();
    expect(globalThis.location.hash).toBe('#/chat');
  });

  it('opens the chat at #/chat with device.chat', () => {
    const a = app('ready', { hash: '#/chat' });
    act(() => a.deliver(snapshot([session('a')], 'Atelier', undefined, ON)));
    expect(screen.getByLabelText('Question pour Ledge')).toBeInTheDocument();
  });
});

describe('the chat screen', () => {
  // m3-chat.html §1, Q32 (design-ux 355eade2): who waits, « Résumer la nuit » before noon, one name from the snapshot (the first
  // rig's, else the first session's), and « Nouvelle session » with a PC that launches.
  describe('the suggestions', () => {
    const at = (h: number) => new Date(2026, 10, 11, h, 0);
    it('before noon: who waits, the night, the first session; after noon, no night', () => {
      const list = [session('a', { name: 'Bix' }), session('b', { name: 'Nova' })];
      expect(suggestionsOf(list, at(9))).toEqual(['Qui attend quelque chose de moi ?', 'Résumer la nuit', 'Où en est Bix sur le badge d\'attente ?']);
      expect(suggestionsOf(list, at(14))).toEqual(['Qui attend quelque chose de moi ?', 'Où en est Bix sur le badge d\'attente ?']);
    });
    it('a rig of the snapshot comes before a session, never the kernel; nothing named without one', () => {
      const seat = session('s', { name: 'dev-back', rig: { name: 'ledge-dev', role: 'dev.back' } });
      const kernel = session('k', { name: 'operator', rig: { name: 'kernel' } });
      expect(suggestionsOf([session('a', { name: 'Bix' }), kernel, seat], at(14))).toEqual(['Qui attend quelque chose de moi ?', 'Où en est ledge-dev ?']);
      expect(suggestionsOf([kernel], at(14))).toEqual(['Qui attend quelque chose de moi ?']);
      expect(suggestionsOf([], at(14))).toEqual(['Qui attend quelque chose de moi ?']);
    });
    it('a tap on a question sends it at once (Q32); « Nouvelle session » opens the launch, only on a PC that launches', () => {
      const t = setup();
      const m = snapshot([session('a', { name: 'Bix' })], 'Atelier', undefined, ON);
      t.deliver(m.type === 'snapshot' ? { ...m, daemon: { ...m.daemon, launch: true } } : m);
      render(<Chat store={t.store} />);
      expect(screen.getByRole('region', { name: copy.chat.point.label })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Nouvelle session' })).toHaveAttribute('href', '#/new');
      fireEvent.click(screen.getByRole('button', { name: 'Qui attend quelque chose de moi ?' }));
      expect(t.of('chat.ask')).toMatchObject([{ text: 'Qui attend quelque chose de moi ?' }]);
      expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('');
    });
    it('no « Nouvelle session » from a PC that does not launch; offline, no suggestion at all', () => {
      const t = chatSetup();
      expect(screen.queryByRole('link', { name: 'Nouvelle session' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Qui attend quelque chose de moi ?' })).toBeInTheDocument();
      act(() => t.set('pc_offline'));
      expect(screen.queryByRole('button', { name: 'Qui attend quelque chose de moi ?' })).toBeNull();
    });
  });

  it('its head: Ledge, Nouvelle conversation and, on a phone, Réglages', () => {
    chatSetup();
    const head = screen.getByRole('banner');
    expect(within(head).getByRole('heading', { name: 'Ledge' })).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: 'Nouvelle conversation' })).toBeEnabled();
    expect(within(head).getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '#/connection');
  });

  it('asking sends chat.ask, shows the bubble, then the steps and « Arrêter », which sends chat.cancel', () => {
    const t = chatSetup();
    type('Où en est le lot 6 ?');
    send();
    const [ask] = t.of('chat.ask');
    expect(ask).toMatchObject({ text: 'Où en est le lot 6 ?' });
    expect(screen.getByText('Où en est le lot 6 ?')).toBeInTheDocument();
    expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('');
    act(() => t.deliver({ type: 'chat.step', qid: ask!.qid, step: { kind: 'sessions' } }));
    act(() => t.deliver({ type: 'chat.step', qid: ask!.qid, step: { kind: 'pane', id: 'a', name: 'Bix' } }));
    expect(screen.getByText('Lit les 2 sessions…')).toBeInTheDocument();
    expect(screen.getByText('Regarde le terminal de Bix…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
    expect(t.of('chat.cancel')).toEqual([{ type: 'chat.cancel', qid: ask!.qid }]);
  });

  it('« Nouvelle conversation » is disabled while a question runs, and resets once it is done', () => {
    const t = chatSetup();
    const reset = () => screen.getByRole('button', { name: 'Nouvelle conversation' });
    expect(reset()).toBeEnabled();
    type('Salut');
    send();
    expect(reset()).toBeDisabled();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.done(qid)));
    expect(reset()).toBeEnabled();
    fireEvent.click(reset());
    expect(t.of('chat.reset')).toHaveLength(1);
  });

  it('busy puts the text of the refusal on screen and the question back in the field', () => {
    const t = chatSetup();
    type('Une question');
    send();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.error(qid, 'busy')));
    // In the thread, under the question (§3).
    expect(within(screen.getByRole('main')).getByText(copy.chat.busy)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Une question')).toBeInTheDocument();
    expect(screen.getByLabelText('Question pour Ledge')).toHaveValue('Une question');
    expect(screen.queryByText('Arrêter')).not.toBeInTheDocument();
  });

  it('a failed turn says why, from its code', () => {
    const t = chatSetup();
    type('Une question');
    send();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.error(qid, 'timeout')));
    expect(screen.getByText(copy.chat.timeout)).toBeInTheDocument();
  });

  it('« Arrêter » takes the send button’s place while Ledge answers, the field still usable (Q37)', () => {
    const t = chatSetup();
    type('Une question');
    send();
    expect(screen.queryByRole('button', { name: 'Envoyer la question' })).toBeNull();
    expect(screen.getByLabelText('Question pour Ledge')).toBeEnabled();
    expect(screen.getByLabelText('Question pour Ledge')).toHaveAttribute('placeholder', 'Ledge répond…');
    act(() => t.deliver(chat.done(t.of('chat.ask')[0]!.qid)));
    expect(screen.queryByRole('button', { name: 'Arrêter' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Envoyer la question' })).toBeInTheDocument();
  });

  it('« Reposer la question » after a timeout or a failure sends the same question as a new one; a stop has none (Q37)', () => {
    const t = chatSetup();
    type('Une question');
    send();
    const qid = t.of('chat.ask')[0]!.qid;
    act(() => t.deliver(chat.error(qid, 'failed')));
    expect(screen.getByText(copy.chat.failed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reposer la question' }));
    const [, again] = t.of('chat.ask');
    expect(again).toMatchObject({ text: 'Une question' });
    expect(again!.qid).not.toBe(qid);
    act(() => t.deliver(chat.error(again!.qid, 'cancelled')));
    expect(screen.getByText(copy.chat.cancelled)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reposer la question' })).toHaveLength(1);
  });

  it('offline, the send button is disabled, the note is shown and nothing is sent', () => {
    const t = chatSetup();
    act(() => t.set('pc_offline'));
    type('Une question');
    expect(screen.getByRole('button', { name: 'Envoyer la question' })).toBeDisabled();
    expect(screen.getByText('Hors ligne : pose la question quand le PC sera joignable.')).toBeInTheDocument();
    expect(t.of('chat.ask')).toHaveLength(0);
  });

  const pointer = (fine: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: fine && q.includes('pointer: fine') })) as typeof matchMedia; };

  it('on a touch keyboard Enter does not send', () => {
    pointer(false);
    const t = chatSetup();
    type('Une question');
    fireEvent.keyDown(screen.getByLabelText('Question pour Ledge'), { key: 'Enter' });
    expect(t.of('chat.ask')).toHaveLength(0);
  });

  it('Enter sends, Shift+Enter does not', () => {
    pointer(true);
    const t = chatSetup();
    type('Une question');
    const field = screen.getByLabelText('Question pour Ledge');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(t.of('chat.ask')).toHaveLength(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(t.of('chat.ask')).toHaveLength(1);
  });

  // Q86: under the field, « + Image » alone on a touch keyboard, « + Image · Entrée envoie » with a physical one; no ＋ beside it.
  it('the line under the field: « + Image » alone on a phone', () => {
    pointer(false);
    chatSetup();
    expect(screen.getByRole('button', { name: '+ Image' })).toBeInTheDocument();
    expect(screen.queryByText('· Entrée envoie')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Joindre une image' })).toBeNull();
  });
  it('the line under the field: « + Image · Entrée envoie » with a physical keyboard', () => {
    pointer(true);
    chatSetup();
    expect(screen.getByRole('button', { name: '+ Image' }).parentElement).toHaveTextContent('+ Image· Entrée envoie');
  });
});

describe('images in the chat', () => {
  const ID = 'd'.repeat(64);
  const REF = { id: ID, mime: 'image/webp' as const, width: 800, height: 600, bytes: 31_000, preview: true };

  it('« + Image » then send asks with the image id and the turn shows its thumbnail', async () => {
    setCodecForTests({ async decode() { return { width: 800, height: 600, async draw() { return { async encode(mime: 'image/webp' | 'image/jpeg') { return new Blob([new Uint8Array(1000)], { type: mime }); } }; } }; } });
    try {
      const t = chatSetup();
      expect(screen.getByRole('button', { name: '+ Image' })).toBeEnabled();
      const input = document.querySelector<HTMLInputElement>('input[type=file][accept="image/*"][multiple]')!;
      fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })] } });
      await waitFor(() => expect(t.of('attachment.put')).toHaveLength(1));
      act(() => t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[0]!.requestId, ref: REF }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Envoyer la question' })).toBeEnabled());
      send();
      expect(t.of('chat.ask')).toMatchObject([{ text: '', attachments: [ID] }]);
      await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
      act(() => t.deliver({ type: 'attachment.data', requestId: t.of('attachment.get')[0]!.requestId, attachment: ID, mime: 'image/webp', data: 'AAAA' }));
      await waitFor(() => expect(document.querySelector('[data-thumb=ready]')).not.toBeNull());
    } finally { setCodecForTests(null); }
  });

  it('a refused question (busy) brings the chip back', async () => {
    setCodecForTests({ async decode() { return { width: 800, height: 600, async draw() { return { async encode(mime: 'image/webp' | 'image/jpeg') { return new Blob([new Uint8Array(1000)], { type: mime }); } }; } }; } });
    try {
      const t = chatSetup();
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type=file]')!, { target: { files: [new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })] } });
      await waitFor(() => expect(t.of('attachment.put')).toHaveLength(1));
      act(() => t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[0]!.requestId, ref: REF }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Envoyer la question' })).toBeEnabled());
      send();
      expect(document.querySelectorAll('[data-chip]')).toHaveLength(0);
      act(() => t.deliver(chat.error(t.of('chat.ask')[0]!.qid, 'busy')));
      await waitFor(() => expect(document.querySelectorAll('[data-chip]')).toHaveLength(1));
    } finally { setCodecForTests(null); }
  });

  it('a turn the PC lists with images shows them', async () => {
    const t = chatSetup();
    act(() => t.deliver(chat.history(chat.turn('q1', { question: 'Regarde', answer: 'Vu.', attachments: [REF] }))));
    await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
  });
});
