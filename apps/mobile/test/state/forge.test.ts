import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { getAssertion } from '../../src/link/webauthn';
import { createForge, DETAIL_MS, draftKey, FORGE_STATE_KEY, type ForgeStore } from '../../src/state/forge';
import { RESEND_MAX_MS, UNCERTAIN_MS } from '../../src/state/operations';
import { createStore, type MobileStore } from '../../src/state/store';
import { detail, mr, pr, stateMsg } from '../model/forge-fixtures';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const open: { forge: ForgeStore; store: MobileStore }[] = [];
afterEach(() => { for (const o of open.splice(0)) { o.forge.close(); o.store.close(); } vi.mocked(getAssertion).mockReset(); vi.useRealTimers(); });

const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const CHALLENGE = { type: 'confirm.challenge' as const, purpose: 'forge' as const, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 };
const flush = () => new Promise(r => setTimeout(r, 0));

const BOOT = '11111111-1111-4111-8111-111111111111';
/** The PC's snapshot under `boot`, offering its requests. */
const snap = (boot: string) => {
  const s = snapshot([], 'WSL', boot, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  return { ...s, daemon: { ...s.daemon, forge: true as const } };
};

/** A ready link to a PC that sends its requests (`daemon.forge`), unless `offered` is false; this phone has a passkey unless `confirm` is false. */
function setup(offered = true, confirm = true) {
  const f = fakeLink('ready');
  const storage = new MemoryStorage();
  const store = createStore(f.link, storage);
  const forge = createForge(f.link, store, storage);
  open.push({ forge, store });
  const s = snapshot([], 'WSL', BOOT, { confirm }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  f.deliver(offered ? { ...s, daemon: { ...s.daemon, forge: true } } : s);
  return { ...f, store, forge, storage };
}

/** Runs an action through the passkey; returns its promise and the `forge.act` sent. */
async function acted(t: ReturnType<typeof setup>, prId: string, action: Parameters<ForgeStore['act']>[1]) {
  vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
  const ended = t.forge.act(prId, action);
  await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
  t.deliver(CHALLENGE);
  await vi.waitFor(() => expect(t.of('forge.act')).toHaveLength(1));
  return { ended, sent: t.of('forge.act')[0]! };
}

describe('the forge store', () => {
  it('follows forge.state once per link while the PC offers it, and keeps the list for an offline start', () => {
    const t = setup();
    t.forge.follow();
    t.forge.follow();
    expect(t.of('forge.state')).toHaveLength(1);
    t.deliver(stateMsg());
    expect(t.forge.getState().state?.prs.map(p => p.ref)).toEqual(['!41', '#231']);
    expect(JSON.parse(t.storage.getItem(FORGE_STATE_KEY)!).state.prs).toHaveLength(2);
    const again = createForge(fakeLink('pc_offline').link, t.store, t.storage);
    open.push({ forge: again, store: t.store });
    expect(again.getState().state?.prs).toHaveLength(2);
    t.set('pc_offline');
    t.set('ready');
    // A new link: the PC's snapshot comes first, then the list is asked again.
    t.deliver({ ...(snapshot([], 'WSL', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>), daemon: { version: '0.9.0', name: 'WSL', forge: true } });
    expect(t.of('forge.state')).toHaveLength(2);
  });

  it('asks nothing of a PC that does not offer its requests', async () => {
    const t = setup(false);
    t.forge.follow();
    t.forge.readDetail(pr().id);
    expect(t.of('forge.state')).toHaveLength(0);
    expect(t.of('forge.detail')).toHaveLength(0);
    expect(await t.forge.act(pr().id, { kind: 'rerun' })).toMatchObject({ phase: 'unsent' });
  });

  it('reads a detail, keeps its job log on the next read, and says why one failed', () => {
    const t = setup();
    const id = mr().id;
    t.forge.readDetail(id, 'j2');
    expect(t.of('forge.detail')[0]).toEqual({ type: 'forge.detail', prId: id, log: 'j2' });
    t.deliver({ type: 'forge.detail', prId: id, detail: detail(mr(), { log: { jobId: 'j2', text: 'FAIL test' } }), cut: true });
    expect(t.forge.getState().details[id]).toMatchObject({ loading: false, cut: true, data: { log: { jobId: 'j2' } } });
    t.forge.readDetail(id);
    t.deliver({ type: 'forge.detail', prId: id, detail: detail(mr()) });
    expect(t.forge.getState().details[id]!.data!.log?.text).toBe('FAIL test');
    t.deliver({ type: 'forge.detail', prId: id, error: 'failed' });
    expect(t.forge.getState().details[id]).toMatchObject({ error: 'failed', data: { pr: { id } } });
  });

  it('takes a detail the PC never answers as failed', () => {
    vi.useFakeTimers();
    const t = setup();
    t.forge.readDetail(pr().id);
    vi.advanceTimersByTime(DETAIL_MS + 1);
    expect(t.forge.getState().details[pr().id]).toMatchObject({ loading: false, error: 'failed' });
  });

  it('reads a held detail again when the list brings a new head', () => {
    const t = setup();
    t.forge.follow();
    t.forge.readDetail(pr().id);
    t.deliver({ type: 'forge.detail', prId: pr().id, detail: detail() });
    t.deliver(stateMsg({ prs: [pr({ headSha: 'b'.repeat(40) })] }));
    expect(t.of('forge.detail')).toHaveLength(2);
  });

  it('checks every action on the device over that exact action, then ends it on forge.done and reads the request again', async () => {
    const t = setup();
    t.forge.readDetail(pr().id);
    const action = { kind: 'merge' as const, headSha: pr().headSha };
    const { ended, sent } = await acted(t, pr().id, action);
    expect(t.of('confirm.prepare')[0]).toMatchObject({ purpose: 'forge', forge: { prId: pr().id, action } });
    expect(sent).toMatchObject({ prId: pr().id, action, assertion: ASSERTION });
    t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage);
    t.deliver({ type: 'operation.result', op: sent.op, status: 'applied' } as PhoneServerMessage);
    t.deliver({ type: 'forge.done', op: sent.op, ok: true, command: 'gh pr merge 231 --repo acme/ledge --squash' });
    expect(await ended).toMatchObject({ phase: 'done', done: { ok: true, command: 'gh pr merge 231 --repo acme/ledge --squash' } });
    expect(t.of('forge.detail')).toHaveLength(2);
  });

  it('says a refusal by its code, and keeps the PC’s detail for it', async () => {
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'merge', headSha: 'old' });
    t.deliver({ type: 'operation.result', op: sent.op, status: 'rejected', reason: 'stale' } as PhoneServerMessage);
    expect(await ended).toMatchObject({ phase: 'rejected', reason: 'stale' });
    t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'stale' });
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'rejected', done: { error: 'stale' } });
  });

  it('refuses an action without a passkey on this phone, and sends nothing', async () => {
    const t = setup(true, false);
    expect(await t.forge.act(pr().id, { kind: 'rerun' })).toMatchObject({ phase: 'rejected', reason: 'confirm_required' });
    expect(t.of('forge.act')).toHaveLength(0);
  });

  it('ends a cancelled check without sending anything', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const ended = t.forge.act(pr().id, { kind: 'rerun' });
    await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    t.deliver(CHALLENGE);
    expect(await ended).toMatchObject({ phase: 'cancelled' });
    expect(t.of('forge.act')).toHaveLength(0);
  });

  it('ends an action the link could not send as « unsent »', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const send = t.link.send.bind(t.link);
    vi.spyOn(t.link, 'send').mockImplementation(async m => (m.type === 'forge.act' ? false : send(m)));
    const ended = t.forge.act(pr().id, { kind: 'rerun' });
    await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    t.deliver(CHALLENGE);
    expect(await ended).toMatchObject({ phase: 'unsent' });
  });

  it('turns an action the PC never says it has « uncertain »; « Réessayer » sends the same op without a second check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'comment', body: 'Merci' });
    vi.advanceTimersByTime(UNCERTAIN_MS + 1);
    const run = await ended;
    expect(run.phase).toBe('uncertain');
    t.forge.resend(run.id);
    await flush();
    expect(t.of('forge.act')).toHaveLength(2);
    expect(t.of('forge.act')[1]!.op).toBe(sent.op);
    expect(t.of('confirm.prepare')).toHaveLength(1);
  });

  it('sends an uncertain action again on the next link once its snapshot names the same PC process, and forgets it once its receipt is closed', async () => {
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'rerun' });
    t.set('pc_offline');
    const run = await ended;
    expect(run.phase).toBe('uncertain');
    t.set('ready');
    // Nothing goes before the snapshot says which process answers.
    expect(t.of('forge.act')).toHaveLength(1);
    t.deliver(snap(BOOT));
    expect(t.of('forge.act')).toHaveLength(2);
    t.forge.dismiss(run.id);
    t.set('pc_offline');
    t.set('ready');
    t.deliver(snap(BOOT));
    expect(t.of('forge.act')).toHaveLength(2);
    t.deliver({ type: 'forge.done', op: sent.op, ok: true });
    expect(t.forge.getState().runs).toHaveLength(0);
  });

  it('never sends again what a PC that restarted may have run: the run stays uncertain, with no retry, and a late refusal does not end it', async () => {
    const t = setup();
    const key = draftKey(pr().id);
    t.forge.setDraft(key, 'Merci');
    const { ended, sent } = await acted(t, pr().id, { kind: 'comment', body: 'Merci' });
    t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage);
    // The comment is posted, its end is lost with the link, and the PC restarts before the next one.
    t.set('pc_offline');
    t.set('ready');
    t.deliver(snap('22222222-2222-4222-8222-222222222222'));
    expect(t.of('forge.act')).toHaveLength(1);
    expect(await ended).toMatchObject({ phase: 'uncertain', lost: true });
    t.forge.resend(t.forge.getState().runs[0]!.id);
    expect(t.of('forge.act')).toHaveLength(1);
    t.deliver({ type: 'forge.done', op: sent.op, ok: false, rejected: 'assertion_invalid' });
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'uncertain', lost: true });
    expect(t.forge.getState().drafts[key]).toBe('Merci');
  });

  it('a PC restarted behind the relay, on the same link, loses what the old process held', async () => {
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'merge', headSha: pr().headSha });
    t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage);
    t.deliver(snap('22222222-2222-4222-8222-222222222222'));
    expect(await ended).toMatchObject({ phase: 'uncertain', lost: true });
    expect(t.of('forge.act')).toHaveLength(1);
  });

  it('sends again, to the same process, a run that left on a new link before its snapshot came: it is neither lost nor sent twice', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const ended = t.forge.act(pr().id, { kind: 'comment', body: 'Merci' });
    await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    t.deliver(CHALLENGE);
    // The check is under way when the link drops and comes back; it ends before the new link's snapshot.
    t.set('pc_offline');
    t.set('ready');
    await vi.waitFor(() => expect(t.of('forge.act')).toHaveLength(1));
    const sent = t.of('forge.act')[0]!;
    t.deliver(snap(BOOT));
    expect(t.of('forge.act')).toHaveLength(1);
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'sending', boot: BOOT });
    expect(t.forge.getState().runs[0]!.lost).toBeUndefined();
    t.deliver({ type: 'forge.done', op: sent.op, ok: true });
    expect(await ended).toMatchObject({ phase: 'done', done: { ok: true } });
  });

  it('shows a lost run’s late result when it comes, but not a refusal its send again got for itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'comment', body: 'Merci' });
    vi.advanceTimersByTime(UNCERTAIN_MS + 1);
    t.forge.resend((await ended).id);
    await flush();
    t.deliver({ type: 'operation.result', op: sent.op, status: 'rejected', reason: 'assertion_invalid' } as PhoneServerMessage);
    t.deliver({ type: 'forge.done', op: sent.op, ok: false, rejected: 'assertion_invalid' });
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'uncertain', lost: true });
    // The first send's own end, late: it settles the run.
    t.deliver({ type: 'forge.done', op: sent.op, ok: true });
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'done', done: { ok: true } });
    expect(t.forge.getState().runs[0]!.lost).toBeUndefined();
  });

  it('takes a refusal of a send again as uncertain, not as the action not done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    const { ended, sent } = await acted(t, pr().id, { kind: 'comment', body: 'Merci' });
    vi.advanceTimersByTime(UNCERTAIN_MS + 1);
    const run = await ended;
    t.forge.resend(run.id);
    await flush();
    expect(t.of('forge.act')).toHaveLength(2);
    // The PC forgot the op (its registry evicted it): the send again is new to it, and its check refused.
    t.deliver({ type: 'operation.result', op: sent.op, status: 'rejected', reason: 'assertion_invalid' } as PhoneServerMessage);
    t.deliver({ type: 'forge.done', op: sent.op, ok: false, rejected: 'assertion_invalid' });
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'uncertain', lost: true });
  });

  it('does not send an uncertain action again once too old for the PC to still hold it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    const { ended } = await acted(t, pr().id, { kind: 'rerun' });
    vi.advanceTimersByTime(RESEND_MAX_MS + 1);
    const run = await ended;
    t.forge.resend(run.id);
    await flush();
    expect(t.of('forge.act')).toHaveLength(1);
    expect(t.forge.getState().runs[0]).toMatchObject({ phase: 'uncertain', lost: true });
  });

  it('keeps a comment not posted in its field, and drops it once posted', async () => {
    const t = setup();
    const key = draftKey(pr().id, 't1');
    t.forge.setDraft(key, 'Parce que 24 lignes');
    expect(t.forge.getState().drafts[key]).toBe('Parce que 24 lignes');
    const { sent } = await acted(t, pr().id, { kind: 'reply', threadId: 't1', body: 'Parce que 24 lignes' });
    t.deliver({ type: 'forge.done', op: sent.op, ok: false, error: 'failed', message: 'HTTP 502' });
    expect(t.forge.getState().drafts[key]).toBe('Parce que 24 lignes');
    t.forge.setDraft(key, '');
    expect(t.forge.getState().drafts[key]).toBeUndefined();
    t.forge.setDraft(key, 'Parce que 24 lignes');
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    void t.forge.act(pr().id, { kind: 'reply', threadId: 't1', body: 'Parce que 24 lignes' });
    await vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(2));
    t.deliver(CHALLENGE);
    await vi.waitFor(() => expect(t.of('forge.act')).toHaveLength(2));
    t.deliver({ type: 'forge.done', op: t.of('forge.act')[1]!.op, ok: true });
    expect(t.forge.getState().drafts[key]).toBeUndefined();
  });

  it('keeps a comment written again while the last one was posting: only the text sent leaves its field', async () => {
    const t = setup();
    const key = draftKey(pr().id);
    t.forge.setDraft(key, 'A');
    const { sent } = await acted(t, pr().id, { kind: 'comment', body: 'A' });
    t.forge.setDraft(key, 'A, et B');
    t.deliver({ type: 'operation.result', op: sent.op, status: 'received' } as PhoneServerMessage);
    t.deliver({ type: 'forge.done', op: sent.op, ok: true });
    expect(t.forge.getState().drafts[key]).toBe('A, et B');
  });

  it('forgets the old PC’s requests when the phone is unpaired', () => {
    const t = setup();
    t.forge.follow();
    t.deliver(stateMsg());
    t.set('unpaired');
    expect(t.forge.getState().state).toBeNull();
    expect(t.storage.getItem(FORGE_STATE_KEY)).toBeNull();
  });
});
