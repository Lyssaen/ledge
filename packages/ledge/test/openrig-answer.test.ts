import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ask, Escalation, OpenRigStatus } from '@ledge/protocol';
import { answerBody, createAnswers, readAnswerPath, type AnswerPath, type AnswerPort, type Answers } from '../src/daemon/openrig/answer.js';
import { ANSWER_PATH } from '../src/daemon/openrig/facts.js';
import type { EscalationPatch } from '../src/daemon/openrig/bridge.js';

const T = '2026-10-31T10:00:00.000Z';
const decision = (over: Partial<Escalation> = {}): Escalation => ({ id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev-build@factory', intent: 'decision',
  summary: 'Quelle base pour le cache ?', questions: [{ id: 'q1', question: 'Base', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Fichier JSON' }] }],
  createdAt: T, state: 'pending', ...over });

type Call = { kind: string; args?: string[]; body?: unknown; headers?: Record<string, string> };
type Fail = { status?: number; body?: unknown };

/** In-memory port: escalations, status, a CLI and an HTTP route that log their calls, with hold/fail hooks. */
function stubPort(list: Escalation[]) {
  const book = new Map(list.map(e => [e.id, e]));
  const rows = new Map<string, string>();
  const calls: Call[] = [];
  let state: OpenRigStatus['state'] = 'running';
  let hold: { gate: Promise<void>; open: () => void } | null = null;   // set by holdNext(): the next call waits for release()
  const fails = new Map<string, Fail[]>();
  let n = 0; let release = () => {};
  async function gate(kind: string): Promise<Fail | undefined> {
    if (hold) { const h = hold; hold = null; await h.gate; }
    return fails.get(kind)?.shift();
  }
  const port: AnswerPort = {
    escalation: id => book.get(id),
    patch(id, p: EscalationPatch) {
      const cur = book.get(id); if (!cur) return undefined;
      const next = { ...cur, ...p } as Escalation;
      for (const k of Object.keys(p) as (keyof Escalation)[]) if (p[k] === undefined) delete next[k];
      book.set(id, next); return next;
    },
    status: () => ({ machine: 'local', state }),
    cli: () => ({
      async queueCreate(o) {
        const args = ['queue', 'create', '--source', o.source, '--destination', o.destination, '--summary', o.summary, '--body-file', o.bodyFile, ...(o.replyTo ? ['--reply-to', o.replyTo] : []), '--json'];
        calls.push({ kind: 'cli:queue create', args, body: readFileSync(o.bodyFile, 'utf8') });
        const f = await gate('cli:queue create');
        return f ? { ok: false, detail: 'queue create failed (stub)' } : { ok: true, qitemId: `qitem-reply-${++n}` };
      }
    }),
    http: () => ({
      async action(body, o) {
        calls.push({ kind: 'http:/api/mission-control/action', body, headers: { 'content-type': 'application/json', 'x-openrig-session': o.session } });
        const f = await gate('http:/api/mission-control/action');
        return f ? { status: f.status ?? 500, json: f.body ?? { error: 'boom' } } : { status: 200, json: { ok: true, state: 'done' } };
      }
    }),
    replyRow: id => rows.get(id),
    setReplyRow: (id, row) => { rows.set(id, row); },
  };
  return { port, calls, rows, book,
    setState: (s: OpenRigStatus['state']) => { state = s; },
    holdNext: () => { let open!: () => void; const gate = new Promise<void>(r => { open = r; }); hold = { gate, open }; release = open; },
    release: () => release(),
    failNext: (kind: string, resp: Fail = {}) => { fails.set(kind, [...(fails.get(kind) ?? []), resp]); } };
}

let fake: ReturnType<typeof stubPort>; let answers: Answers; let askCalls: [string, string][]; let askReply: (id: string, text: string) => Ask | { code: 'closed' | 'dropped' | 'unknown'; reason: string };
const make = (path: AnswerPath = { kind: 'reply-and-approve' }) => createAnswers({ port: fake.port, asks: { answer: (id, text) => { askCalls.push([id, text]); return askReply(id, text) as Ask; } },
  path, localMachine: 'local', now: () => T });
beforeEach(() => {
  fake = stubPort([decision(), decision({ id: 'qi-up', intent: 'update', questions: [], summary: 'Tests verts' }),
    decision({ id: 'ask-3', source: 'ask', from: 'otto', questions: [], summary: 'On merge ?' }), decision({ id: 'qi-far', machine: 'ec2-build' }),
    decision({ id: 'qi-free', questions: [], summary: 'Que faire du cache ?' })]);
  askCalls = []; askReply = (id, text) => ({ id, from: 's1', fromName: 'otto', question: 'On merge ?', options: '', at: T, state: 'answered', answer: { text, at: T } });
  answers = make();
});

describe('answers', () => {
  test('reply-and-approve creates the reply row then approves', async () => {
    const r = await answers.answer('qi-1', { q1: 'sqlite' }, 'user');
    expect(r.ok).toBe(true);
    expect(fake.calls.map(c => c.kind)).toEqual(['cli:queue create', 'http:/api/mission-control/action']);
    expect(fake.calls[0]!.args).toEqual(['queue', 'create', '--source', 'ledge@external', '--destination', 'dev-build@factory', '--summary', 'Réponse de Ledge : Base → SQLite',
      '--body-file', expect.any(String), '--json']);
    expect(fake.calls[0]!.body).toBe('Réponse de Ledge : Base → SQLite');
    expect(fake.calls[1]!.body).toMatchObject({ verb: 'approve', qitemId: 'qi-1', annotation: 'Réponse de Ledge : Base → SQLite' });
    expect(fake.calls[1]!.headers).toMatchObject({ 'x-openrig-session': 'ledge@external' });   // fixé par la fiche de faits, D8
    expect(fake.calls[1]!.body).not.toHaveProperty('actorSession');
    expect(fake.port.escalation('qi-1')).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { q1: 'sqlite' }, at: T } });
    expect(r.ok && r.escalation).toMatchObject({ id: 'qi-1', state: 'answered' });
    expect(fake.rows.get('qi-1')).toBe('qitem-reply-1');
  });

  test('second answer while the first is in flight gets already_answered', async () => {
    fake.holdNext();                                   // le premier appel CLI attend
    const first = answers.answer('qi-1', { q1: 'sqlite' }, 'user');
    expect(fake.port.escalation('qi-1')?.state).toBe('answered');   // marked before the first await
    const second = await answers.answer('qi-1', { q1: 'json' }, 'ledge');
    expect(second).toEqual({ ok: false, code: 'already_answered', reason: expect.any(String) });
    fake.release(); expect((await first).ok).toBe(true);
    expect(fake.calls.filter(c => c.kind === 'cli:queue create')).toHaveLength(1);
    expect(fake.port.escalation('qi-1')?.answer?.by).toBe('user');
  });

  test('an answered escalation refuses another answer', async () => {
    expect((await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).ok).toBe(true);
    expect(await answers.answer('qi-1', { q1: 'json' }, 'user')).toEqual({ ok: false, code: 'already_answered', reason: expect.any(String) });
    fake.port.patch('qi-free', { state: 'closed' });
    expect(await answers.answer('qi-free', { text: 'vas-y' }, 'user')).toMatchObject({ ok: false, code: 'already_answered' });
    expect(fake.calls).toHaveLength(2);
  });

  test('a 409 qitem_already_terminal from approve is already_answered, not failed', async () => {   // fixé par la fiche de faits, D7
    fake.failNext('http:/api/mission-control/action', { status: 409, body: { error: 'qitem_already_terminal', state: 'done' } });
    expect(await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).toEqual({ ok: false, code: 'already_answered', reason: expect.any(String) });
    expect(fake.port.escalation('qi-1')).toMatchObject({ state: 'closed' });
    expect(fake.port.escalation('qi-1')).not.toHaveProperty('answer');
  });

  test('retry after a failed approve reuses the reply row', async () => {
    fake.failNext('http:/api/mission-control/action');
    expect((await answers.answer('qi-1', { q1: 'sqlite' }, 'user'))).toMatchObject({ ok: false, code: 'failed' });
    expect(fake.port.escalation('qi-1')?.state).toBe('pending');
    expect(fake.port.escalation('qi-1')).not.toHaveProperty('answer');
    expect((await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).ok).toBe(true);
    expect(fake.calls.filter(c => c.kind === 'cli:queue create')).toHaveLength(1);
    expect(fake.calls.filter(c => c.kind === 'http:/api/mission-control/action')).toHaveLength(2);
  });

  test('a failed reply row goes back to the state before, grace included', async () => {
    fake.port.patch('qi-1', { state: 'grace', graceUntil: '2026-10-31T10:05:00.000Z' });
    fake.failNext('cli:queue create');
    expect(await answers.answer('qi-1', { q1: 'sqlite' }, 'ledge')).toMatchObject({ ok: false, code: 'failed' });
    expect(fake.port.escalation('qi-1')).toMatchObject({ state: 'grace', graceUntil: '2026-10-31T10:05:00.000Z' });
    expect(fake.port.escalation('qi-1')).not.toHaveProperty('answer');
    expect(fake.rows.has('qi-1')).toBe(false);
    expect(fake.calls.map(c => c.kind)).toEqual(['cli:queue create']);
  });

  test('openrig down refuses without touching the escalation', async () => {
    fake.setState('stopped');
    expect(await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).toEqual({ ok: false, code: 'openrig_down', reason: expect.any(String) });
    expect(fake.port.escalation('qi-1')).toEqual(decision());
    expect(fake.calls).toEqual([]);
  });

  test('an update is closed with approve only', async () => {
    expect((await answers.answer('qi-up', {}, 'user')).ok).toBe(true);
    expect(fake.calls.map(c => c.kind)).toEqual(['http:/api/mission-control/action']);
    expect(fake.calls[0]!.body).toMatchObject({ verb: 'approve', qitemId: 'qi-up' });
    expect(fake.port.escalation('qi-up')).toMatchObject({ state: 'answered', answer: { answers: {} } });
  });

  test('an update answered with text gets a reply row pointing at it', async () => {
    expect((await answers.answer('qi-up', { text: 'bien vu' }, 'user')).ok).toBe(true);
    expect(fake.calls[0]!.args).toContain('--reply-to');
    expect(fake.calls[0]!.args!.slice(-3)).toEqual(['--reply-to', 'qi-up', '--json']);
  });

  test('an ask is answered through asks, not OpenRig', async () => {
    fake.setState('stopped');   // OpenRig plays no part
    const r = await answers.answer('ask-3', { text: '  oui, merge  ' }, 'user');
    expect(r.ok).toBe(true);
    expect(askCalls).toEqual([['3', 'oui, merge']]);
    expect(fake.calls).toEqual([]);
    expect(fake.port.escalation('ask-3')).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { text: '  oui, merge  ' } } });
  });

  test('an ask already answered elsewhere is already_answered, a dropped one failed', async () => {
    askReply = () => ({ code: 'closed', reason: 'déjà répondue' });
    expect(await answers.answer('ask-3', { text: 'oui' }, 'user')).toMatchObject({ ok: false, code: 'already_answered' });
    expect(fake.port.escalation('ask-3')?.state).toBe('closed');
    fake.port.patch('ask-3', { state: 'pending' });
    askReply = () => ({ code: 'dropped', reason: "cette session s'est terminée avant ta réponse" });
    expect(await answers.answer('ask-3', { text: 'oui' }, 'user')).toEqual({ ok: false, code: 'failed', reason: "cette session s'est terminée avant ta réponse" });
    expect(fake.port.escalation('ask-3')?.state).toBe('pending');
  });

  test('a remote escalation is unreachable until lot 6', async () => {
    expect(await answers.answer('qi-far', { q1: 'sqlite' }, 'user')).toEqual({ ok: false, code: 'unreachable', reason: 'réponse à distance : lot 6' });
    expect(fake.port.escalation('qi-far')?.state).toBe('pending');
    expect(fake.calls).toEqual([]);
  });

  test('an empty or missing answer is invalid, free text is not', async () => {
    expect(await answers.answer('qi-1', { q1: '' }, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answers.answer('qi-1', { q1: '   ' }, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answers.answer('qi-1', {}, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answers.answer('ask-3', {}, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answers.answer('ask-3', { text: ' ' }, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answers.answer('qi-free', {}, 'user')).toMatchObject({ ok: false, code: 'invalid' });
    expect(fake.calls).toEqual([]); expect(askCalls).toEqual([]);
    expect(fake.port.escalation('qi-1')?.state).toBe('pending');
    const r = await answers.answer('qi-1', { q1: 'les deux, en lecture seule' }, 'user');
    expect(r.ok).toBe(true);
    expect(fake.calls[0]!.body).toBe('Réponse de Ledge : Base → les deux, en lecture seule');
  });

  test('an unknown escalation fails', async () => {
    expect(await answers.answer('nope', { q1: 'sqlite' }, 'user')).toMatchObject({ ok: false, code: 'failed' });
  });

  test('approve-only approves with the answer as annotation, no reply row', async () => {
    answers = make({ kind: 'approve-only' });
    expect((await answers.answer('qi-1', { q1: 'json' }, 'ledge', { rule: 'r-git' })).ok).toBe(true);
    expect(fake.calls.map(c => c.kind)).toEqual(['http:/api/mission-control/action']);
    expect(fake.calls[0]!.body).toEqual({ verb: 'approve', qitemId: 'qi-1', annotation: 'Réponse de Ledge : Base → Fichier JSON' });
    expect(fake.port.escalation('qi-1')?.answer).toEqual({ by: 'ledge', answers: { q1: 'json' }, at: T, rule: 'r-git' });
  });

  test('resolve sends the decision as ledge@external', async () => {
    answers = make({ kind: 'resolve' });
    expect((await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).ok).toBe(true);
    expect(fake.calls).toEqual([{ kind: 'http:/api/mission-control/action', body: { verb: 'resolve', qitemId: 'qi-1', decision: 'Réponse de Ledge : Base → SQLite' },
      headers: expect.objectContaining({ 'x-openrig-session': 'ledge@external' }) }]);
  });

  test('a non-2xx approve other than 409 terminal fails with the status', async () => {
    fake.failNext('http:/api/mission-control/action', { status: 409, body: { error: 'something_else' } });
    expect(await answers.answer('qi-1', { q1: 'sqlite' }, 'user')).toMatchObject({ ok: false, code: 'failed', reason: expect.stringContaining('409') });
  });

  test('onAnswered fires once per successful answer', async () => {
    const seen: Escalation[] = []; const off = answers.onAnswered(e => seen.push(e));
    fake.failNext('http:/api/mission-control/action');
    await answers.answer('qi-1', { q1: 'sqlite' }, 'user');
    expect(seen).toEqual([]);
    await answers.answer('qi-1', { q1: 'sqlite' }, 'user');
    await answers.answer('qi-1', { q1: 'sqlite' }, 'user');   // already answered
    expect(seen.map(e => [e.id, e.state])).toEqual([['qi-1', 'answered']]);
    off(); await answers.answer('qi-up', {}, 'user');
    expect(seen).toHaveLength(1);
  });
});

describe('answerBody', () => {
  test('one line per question, option label or free text quoted as is', () => {
    const e = decision({ questions: [...decision().questions, { id: 'q2', question: 'Où', options: [{ id: 'a', label: 'Local' }, { id: 'b', label: 'Partagé' }] }] });
    expect(answerBody(e, { q1: 'json', q2: 'sur le NAS' })).toBe('Réponse de Ledge : Base → Fichier JSON\nRéponse de Ledge : Où → sur le NAS');
  });
  test('without questions, the free text itself', () => {
    expect(answerBody(decision({ questions: [] }), { text: 'oui, merge' })).toBe('oui, merge');
  });
});

describe('readAnswerPath', () => {
  test('readAnswerPath reads the facts sheet line', () => {
    expect(readAnswerPath('…\nChemin de réponse : resolve\n…')).toEqual({ kind: 'resolve' });
    expect(readAnswerPath('## Retenu\n- Chemin de réponse : reply-and-approve\n')).toEqual({ kind: 'reply-and-approve' });   // forme liste de la fiche
    expect(readAnswerPath('* Chemin de réponse : approve-only')).toEqual({ kind: 'approve-only' });
    expect(readAnswerPath('rien ici')).toEqual({ kind: 'reply-and-approve' });
  });
  test('ANSWER_PATH matches the facts sheet', () => {
    const sheet = readFileSync(fileURLToPath(new URL('../../../docs/superpowers/specs/2026-10-30-openrig-facts.md', import.meta.url)), 'utf8');
    expect(readAnswerPath(sheet)).toEqual({ kind: ANSWER_PATH });
  });
});
