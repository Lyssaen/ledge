import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerMessageSchema, type LedgeDecision, type LedgeThreadItem, type Projects } from '@ledge/protocol';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig, type FakeRigCli } from './fakes/openrig.js';
import { createBridge, type Bridge, type BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { createAnswers, type Answers } from '../src/daemon/openrig/answer.js';
import { createMemory, type Memory } from '../src/daemon/brain/memory.js';
import { createDeciding, type Deciding } from '../src/daemon/brain/decide.js';
import { parseMandate, DEFAULT_MANDATE } from '../src/daemon/brain/mandate.js';
import type { BrainEvent } from '../src/daemon/brain/inbox.js';
import { createRevisit } from '../src/daemon/brain/revisit.js';
import type { LedgeThread } from '../src/daemon/ledgeThread.js';

const until = async (ok: () => boolean, ms = 4000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const q = { id: 'q1', question: 'Base', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'json', label: 'Fichier JSON' }] };
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: 'Quelle base ?',
  body: 'Quelle base ?', humanQuestions: [q], createdAt: '2026-10-30 10:00:00' });

const dirs: string[] = []; let fake: FakeOpenRig | null = null; let bridge: Bridge | null = null; let deciding: Deciding | null = null;
afterEach(async () => { deciding?.dispose(); deciding = null; await bridge?.stop(); bridge = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type World = { b: Bridge; exec: FakeRigCli; answers: Answers; memory: Memory; thread: LedgeThreadItem[]; inbox: BrainEvent[]; msgs: BridgeMessage[];
  revisit: (id: string, text?: string) => Promise<{ ok: boolean; reason?: string }>; setBrain(on: boolean): void };

async function world(): Promise<World> {
  fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
  const d = mkdtempSync(join(tmpdir(), 'ledge-revisit-')); dirs.push(d);
  const exec = fakeRigCli(fake); const msgs: BridgeMessage[] = [];
  const b = bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec, projects: () => none, home: d, file: join(d, 'openrig.json'),
    sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 40 });
  b.onMessage(m => { ServerMessageSchema.parse(m); msgs.push(m); });
  await b.start(); await until(() => b.status().state === 'running' && b.escalation('E1') !== undefined);
  const answers = createAnswers({ port: { escalation: b.escalation, patch: b.patchEscalation, status: b.status, cli: b.cli, http: b.http, replyRow: b.replyRow, setReplyRow: b.setReplyRow },
    path: { kind: 'reply-and-approve' }, localMachine: 'local' });
  const memory = createMemory({ dir: join(d, 'memoire') });
  const thread: LedgeThreadItem[] = []; const inbox: BrainEvent[] = []; let n = 0; let on = true;
  const append: LedgeThread['append'] = item => { const full = { ...item, id: `t${++n}`, at: new Date().toISOString() } as LedgeThreadItem; thread.push(full); return full; };
  deciding = createDeciding({ escalations: { escalation: b.escalation, patchEscalation: b.patchEscalation }, answers, thread: { append }, memory,
    inbox: { push: e => { inbox.push(e); return true; } }, mandate: () => parseMandate(DEFAULT_MANDATE), brainOn: () => on });
  const r = createRevisit({ memory, escalations: { escalation: b.escalation, patchEscalation: b.patchEscalation }, answers, thread: { append },
    inbox: { push: e => { inbox.push(e); return true; } }, brainOn: () => on, bridge: { replyRow: b.replyRow, replyClaimed: b.replyClaimed } });
  return { b, exec, answers, memory, thread, inbox, msgs, revisit: r.revisit, setBrain: v => { on = v; } };
}

/** The user answers E1 with sqlite: a reply row (pending in the fake) and the human row approved; the decision is recorded. */
async function answered(w: World): Promise<LedgeDecision> {
  const r = await w.answers.answer('E1', { q1: 'sqlite' }, 'user');
  expect(r.ok).toBe(true);
  const dec = w.memory.decisions().find(x => x.escalationId === 'E1')!;
  expect(dec).toMatchObject({ by: 'user', answers: { q1: 'sqlite' }, from: 'dev-build@starter' });
  return dec;
}
const replyRowOf = (w: World) => fake!.queue.find(r => r.qitemId === w.b.replyRow('E1'))!;
const creates = (w: World) => w.exec.calls.filter(c => c[0] === 'queue' && c[1] === 'create');
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
const approves = () => fake!.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action');

describe('revisit a decision', () => {
  test('unclaimed: the card comes back and the correction is a new reply row', async () => {
    const w = await world(); const dec = await answered(w);
    expect(replyRowOf(w).state).toBe('pending');
    const approvesBefore = approves().length; const threadBefore = w.thread.length;
    const r = await w.revisit(dec.id);
    expect(r).toEqual({ ok: true });
    expect(w.b.escalation('E1')).toMatchObject({ state: 'pending', correcting: dec.id });
    expect(w.b.escalation('E1')!.answer).toBeUndefined();
    expect(w.thread.slice(threadBefore)).toEqual([expect.objectContaining({ kind: 'escalation', escalationId: 'E1' })]);
    // C21: the human row is closed in OpenRig, re-reads must not remove the reopened card.
    await sleep(150);
    expect(w.msgs.some(m => m.type === 'escalation.removed' && m.id === 'E1')).toBe(false);
    expect(w.b.escalation('E1')).toMatchObject({ state: 'pending', correcting: dec.id });

    const a = await w.answers.answer('E1', { q1: 'json' }, 'user');   // the user answers the reopened card
    expect(a.ok).toBe(true);
    const last = creates(w).at(-1)!;
    expect(creates(w)).toHaveLength(2);
    expect(flag(last, '--summary')).toMatch(/^Correction de Ledge : /);
    expect(flag(last, '--summary')).toContain('Fichier JSON');
    expect(flag(last, '--destination')).toBe('dev-build@starter');
    expect(fake!.queue.at(-1)!.body).toMatch(/^Correction de Ledge : Base → Fichier JSON/);
    expect(approves().length).toBe(approvesBefore);   // no approve: the human row is already closed
    const e = w.b.escalation('E1')!;
    expect(e).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { q1: 'json' } } });
    expect(e.correcting).toBeUndefined();
    expect(w.b.replyRow('E1')).toBe(fake!.queue.at(-1)!.qitemId);
    const all = w.memory.decisions();
    const fresh = all.find(x => x.escalationId === 'E1' && x.id !== dec.id)!;
    expect(fresh).toMatchObject({ by: 'user', answers: { q1: 'json' } });
    expect(all.find(x => x.id === dec.id)!.revisitedBy).toBe(fresh.id);
  });

  test('a decision by Ledge is revisited the same way', async () => {
    const w = await world();
    const r0 = await w.answers.answer('E1', { q1: 'sqlite' }, 'ledge');
    expect(r0.ok).toBe(true);
    const dec = w.memory.record({ by: 'ledge', category: 'code', escalationId: 'E1', summary: 'Base → SQLite', answers: { q1: 'sqlite' }, at: new Date().toISOString(), from: 'dev-build@starter' });
    expect(await w.revisit(dec.id)).toEqual({ ok: true });
    expect(w.b.escalation('E1')).toMatchObject({ state: 'pending', correcting: dec.id });
    // The brain cannot answer a card the user reopened.
    expect((await w.answers.answer('E1', { q1: 'json' }, 'ledge')).ok).toBe(false);
    expect((await w.answers.answer('E1', { q1: 'json' }, 'user')).ok).toBe(true);
    const fresh = w.memory.decisions().find(x => x.escalationId === 'E1' && x.id !== dec.id)!;
    expect(w.memory.decisions().find(x => x.id === dec.id)!.revisitedBy).toBe(fresh.id);
  });

  test('with a text, it goes as the correction body, without reopening the card', async () => {
    const w = await world(); const dec = await answered(w);
    const threadBefore = w.thread.length;
    const r = await w.revisit(dec.id, 'Finalement, garde le fichier JSON.\nMerci.');
    expect(r).toEqual({ ok: true });
    expect(creates(w)).toHaveLength(2);
    expect(fake!.queue.at(-1)!.body).toBe('Correction de Ledge : Finalement, garde le fichier JSON.\nMerci.');
    expect(flag(creates(w).at(-1)!, '--summary')).toBe('Correction de Ledge : Finalement, garde le fichier JSON. Merci.');
    expect(w.thread.slice(threadBefore).some(i => i.kind === 'escalation')).toBe(false);
    const e = w.b.escalation('E1')!;
    expect(e.state).toBe('answered'); expect(e.correcting).toBeUndefined();
    const fresh = w.memory.decisions().find(x => x.escalationId === 'E1' && x.id !== dec.id)!;
    expect(fresh).toBeDefined();
    expect(w.memory.decisions().find(x => x.id === dec.id)!.revisitedBy).toBe(fresh.id);
  });

  test('claimed with the brain on: the brain is asked to explain', async () => {
    const w = await world(); const dec = await answered(w);
    replyRowOf(w).state = 'in-progress';
    const r = await w.revisit(dec.id, 'Je préfère JSON');
    expect(r).toEqual({ ok: true });
    expect(w.inbox.at(-1)).toEqual({ kind: 'revisit', decision: expect.objectContaining({ id: dec.id }), claimed: true, text: 'Je préfère JSON' });
    expect(creates(w)).toHaveLength(1);
    expect(w.b.escalation('E1')!.state).toBe('answered');
    expect(w.b.escalation('E1')!.correcting).toBeUndefined();
  });

  test('claimed without brain: Ledge says to write to the seat', async () => {
    const w = await world(); const dec = await answered(w);
    w.setBrain(false);
    replyRowOf(w).state = 'done';
    const inboxBefore = w.inbox.length;
    expect(await w.revisit(dec.id)).toEqual({ ok: true });
    expect(w.thread.at(-1)).toMatchObject({ kind: 'ledge', text: 'dev-build@starter a déjà agi sur cette décision. Écris-lui avec @dev-build@starter pour la défaire.' });
    expect(w.inbox.length).toBe(inboxBefore);
    expect(creates(w)).toHaveLength(1);
  });

  test("a reply row read as '?' counts as claimed: nothing is resent blindly", async () => {
    const w = await world(); const dec = await answered(w);
    w.b.setReplyRow('E1', '?');
    expect(await w.revisit(dec.id)).toEqual({ ok: true });
    expect(w.inbox.at(-1)).toMatchObject({ kind: 'revisit', claimed: true });
    expect(w.b.escalation('E1')!.state).toBe('answered');
    expect(await w.b.replyClaimed('local', '?')).toBe(true);
    expect(await w.b.replyClaimed('local', 'qitem-unknown')).toBe(true);
  });

  test('two corrections at once: one wins', async () => {
    const w = await world(); const dec = await answered(w);
    await w.revisit(dec.id);
    const [a, b] = await Promise.all([w.answers.answer('E1', { q1: 'json' }, 'user'), w.answers.answer('E1', { q1: 'sqlite' }, 'user')]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const lost = (a.ok ? b : a) as { ok: false; code: string };
    expect(lost.code).toBe('already_answered');
    expect(creates(w)).toHaveLength(2);
    expect(w.memory.decisions().filter(x => x.escalationId === 'E1')).toHaveLength(2);
    // Revisited once: a second revisit of the same decision is refused.
    expect((await w.revisit(dec.id)).ok).toBe(false);
  });

  test('an unknown decision is not ok', async () => {
    const w = await world();
    expect((await w.revisit('nope')).ok).toBe(false);
  });
});
