import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, type MobileStore } from '../../src/state/store';
import { OPS_KEY } from '../../src/state/operations';
import { getAssertion } from '../../src/link/webauthn';
import { chat, fakeLink, MemoryStorage, snapshot } from './helpers';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const stores: MobileStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.mocked(getAssertion).mockReset();
});

function setup(device: { confirm: boolean; chat?: true } = { confirm: true, chat: true }) {
  const f = fakeLink('ready');
  const storage = new MemoryStorage();
  const store = createStore(f.link, storage);
  stores.push(store);
  f.deliver(snapshot([], 'Atelier', undefined, device));
  return { ...f, store, storage };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const CHALLENGE = { type: 'confirm.challenge' as const, purpose: 'launch' as const, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 };

describe('the phone chat in the store', () => {
  it('ask shows the turn before any answer, and sends chat.ask', () => {
    const t = setup();
    const qid = t.store.ask('  Où en est le lot 6 ?  ');
    expect(t.store.chat().turns).toMatchObject([{ qid, question: 'Où en est le lot 6 ?' }]);
    expect(t.store.chat().live).toEqual({ qid, steps: [], text: '' });
    expect(t.of('chat.ask')).toEqual([{ type: 'chat.ask', qid, text: 'Où en est le lot 6 ?' }]);
  });

  it('chat.delta replaces the text, it does not append', () => {
    const t = setup();
    const qid = t.store.ask('q');
    t.deliver(chat.delta(qid, 'Le lot'));
    t.deliver(chat.delta(qid, 'Le lot 6 est'));
    expect(t.store.chat().live?.text).toBe('Le lot 6 est');
  });

  it('chat.step adds to the live steps once', () => {
    const t = setup();
    const qid = t.store.ask('q');
    const step = { kind: 'repo' as const, id: 's1', name: 'Read' };
    t.deliver({ type: 'chat.step', qid, step });
    t.deliver({ type: 'chat.step', qid, step });
    expect(t.store.chat().live?.steps).toEqual([step]);
  });

  it('chat.done clears the live and gives the turn its answer', () => {
    const t = setup();
    const qid = t.store.ask('q');
    t.deliver(chat.delta(qid, 'Fin'));
    t.deliver(chat.done(qid));
    expect(t.store.chat().live).toBeNull();
    expect(t.store.chat().turns).toMatchObject([{ qid, answer: 'Fini.' }]);
  });

  it('after a cut and a ready, chat.history is asked and the finished turn replaces the bubble', () => {
    const t = setup();
    const qid = t.store.ask('q');
    expect(t.of('chat.history')).toHaveLength(1);
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('chat.history')).toHaveLength(2);
    t.deliver(chat.history(chat.turn(qid, { answer: 'Fini.' })));
    expect(t.store.chat().turns).toMatchObject([{ qid, answer: 'Fini.' }]);
    expect(t.store.chat().live).toBeNull();
  });

  it('chat.history is not asked from a PC without chat', () => {
    const t = setup({ confirm: true });
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('chat.history')).toEqual([]);
  });

  it('an unfinished turn in the history keeps the live; delta keeps working', () => {
    const t = setup();
    const qid = t.store.ask('q');
    t.deliver(chat.history(chat.turn(qid)));
    t.deliver(chat.delta(qid, 'Encore'));
    expect(t.store.chat().live?.text).toBe('Encore');
  });

  it('chat.error busy removes the optimistic bubble and keeps the text', () => {
    const t = setup();
    const qid = t.store.ask('Ma question');
    t.deliver(chat.error(qid, 'busy'));
    expect(t.store.chat().turns).toEqual([]);
    expect(t.store.chat().live).toBeNull();
    expect(t.store.chat().error).toEqual({ code: 'busy', qid, text: 'Ma question' });
    t.store.clearChatError();
    expect(t.store.chat().error).toBeNull();
  });

  it('another error code marks the turn and keeps it', () => {
    const t = setup();
    const qid = t.store.ask('q');
    t.deliver(chat.error(qid, 'timeout'));
    expect(t.store.chat().turns).toMatchObject([{ qid, error: 'timeout' }]);
    expect(t.store.chat().error).toEqual({ code: 'timeout', qid });
  });

  it('offline: nothing is sent, error offline with the text', () => {
    const t = setup();
    t.set('pc_offline');
    t.store.ask('Bonjour');
    expect(t.of('chat.ask')).toEqual([]);
    expect(t.store.chat().turns).toEqual([]);
    expect(t.store.chat().error).toEqual({ code: 'offline', text: 'Bonjour' });
  });

  it('cancelAsk and resetChat', () => {
    const t = setup();
    const qid = t.store.ask('q');
    t.store.cancelAsk();
    expect(t.of('chat.cancel')).toEqual([{ type: 'chat.cancel', qid }]);
    t.store.resetChat();
    expect(t.of('chat.reset')).toHaveLength(1);
    expect(t.store.chat()).toEqual({ turns: [], live: null, error: null });
  });

  it('subscribers hear chat changes', () => {
    const t = setup();
    const fn = vi.fn();
    t.store.subscribe(fn);
    t.store.ask('q');
    expect(fn).toHaveBeenCalled();
  });

  it('launch without a credential is rejected confirm_required, with no WebAuthn call', async () => {
    const t = setup({ confirm: false, chat: true });
    await expect(t.store.launch('0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11')).resolves.toEqual({ status: 'rejected', reason: 'confirm_required' });
    expect(getAssertion).not.toHaveBeenCalled();
    expect(t.of('confirm.prepare')).toEqual([]);
    expect(t.of('chat.launch')).toEqual([]);
  });

  it('launch prepares a challenge for the qid, signs it and resolves on the result; it is not stored', async () => {
    const t = setup();
    const qid = '0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11';
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const done = t.store.launch(qid, [0, 2]);
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'launch', qid }]);
    t.deliver(CHALLENGE);
    await flush();
    const [sent] = t.of('chat.launch');
    expect(sent).toMatchObject({ qid, rows: [0, 2], assertion: ASSERTION });
    expect(JSON.parse(t.storage.getItem(OPS_KEY) ?? '{}')).toEqual({});
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'received' });
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'rejected', reason: 'assertion_invalid' });
    await expect(done).resolves.toEqual({ status: 'rejected', reason: 'assertion_invalid' });
  });

  it('launch: the user cancelling the prompt gives cancelled, nothing is sent', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const done = t.store.launch('0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11');
    t.deliver(CHALLENGE);
    await expect(done).resolves.toEqual({ status: 'cancelled' });
    expect(t.of('chat.launch')).toEqual([]);
  });

  it('relay resolves applied at the operation.result', async () => {
    const t = setup();
    const qid = '0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11';
    const done = t.store.relay(qid);
    const [sent] = t.of('chat.relay');
    expect(sent).toMatchObject({ type: 'chat.relay', qid });
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' });
    await expect(done).resolves.toEqual({ status: 'applied' });
  });

  it('a second relay tap on the same turn shares the first', async () => {
    const t = setup();
    const qid = '0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11';
    const a = t.store.relay(qid);
    const b = t.store.relay(qid);
    expect(b).toBe(a);
    expect(t.of('chat.relay')).toHaveLength(1);
  });

  it('a chat.relay or chat.launch operation is never in local storage', () => {
    const t = setup();
    void t.store.relay('0b0e6f4c-27e6-4c1a-9a53-0d8a7d2a3c11');
    expect(Object.values(t.store.getState().ops).map(o => o.message.type)).toEqual(['chat.relay']);
    expect(JSON.parse(t.storage.getItem(OPS_KEY) ?? '{}')).toEqual({});
  });
});
