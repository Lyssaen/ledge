import { describe, it, expect, vi } from 'vitest';
import { OpenRigAnsweredSchema, OpenRigAsksChangedSchema, parseClientMessage, type OpenRigState } from '@ledge/protocol';
import { answerError, attentionRef, createHumanChannel, seatParts, toAsk, type HumanList, type RigHttp, type RigSse } from '../src/daemon/openrigHuman.js';
import type { RigRun } from '../src/daemon/openrig.js';

// Shapes read from OpenRig 0.7.7 on 2026-11-02 (GET /api/attention, GET /api/queue/<id>), trimmed to what Ledge reads.
const RUNNING: OpenRigState = { installed: true, daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, rigs: [], at: '' };
const BASE = 'http://127.0.0.1:7433';
const ASK = {
  qitemId: 'qitem-1', sourceSession: 'dev-review@starter', destinationSession: 'ledge@external', state: 'pending', priority: 'routine',
  tags: ['human-alert'], body: 'Question de test.\nDeuxième ligne.', summary: 'Choisir une couleur', humanIntent: 'decision', humanDetail: null,
  evidenceRef: '/tmp/evidence.md', tsCreated: '2026-11-02T19:00:00.000Z', tsUpdated: '2026-11-02T19:01:00.000Z',
  humanQuestions: [
    { id: 'couleur', question: 'Quelle couleur ?', options: [{ id: 'bleu', label: 'Bleu', recommended: true }, { id: 'vert', label: 'Vert' }] },
    { id: 'taille', question: 'Quelle taille ?', options: [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }] }
  ],
  humanAnswers: { couleur: 'bleu' }
};
const NEWS = { qitemId: 'qitem-2', sourceSession: 'design-ux@ledge-dev', destinationSession: 'ledge@external', state: 'pending', priority: 'urgent', tags: null,
  body: 'La maquette est prête.', summary: null, humanIntent: 'update', tsCreated: '2026-11-02T18:00:00.000Z', tsUpdated: '2026-11-02T18:00:00.000Z' };
const PARKED = { qitemId: 'qitem-3', sourceSession: 'pilot-lead@ledge-dev', destinationSession: 'dev-back@ledge-dev', state: 'blocked', blockedOn: 'ledge@external',
  priority: 'routine', body: 'Push autorisé ?', summary: 'Push de feat/x', tsCreated: '2026-11-02T17:00:00.000Z', tsUpdated: '2026-11-02T19:30:00.000Z' };
const ATTENTION = {
  perspective: { actingAs: { person: 'ledge@external', authority: 'primary-user' } },
  items: [
    { id: 'queue:qitem-1', kind: 'action', answer: { verb: 'answer', actorSession: 'ledge@external' }, at: ASK.tsUpdated },
    { id: 'queue-update:qitem-2', kind: 'update', at: NEWS.tsUpdated },
    { id: 'queue:qitem-3', kind: 'action', answer: { verb: 'resolve', actorSession: 'ledge@external' }, at: PARKED.tsUpdated },
    { id: 'proof:something', kind: 'action' }
  ]
};
const HUMANS = { ok: true, humans: [{ entityId: 'ledge', displayName: 'Ledge', address: 'ledge@external', deliveryReadiness: { ready: false } }] };

function fake(over: { rows?: Record<string, unknown>; attention?: unknown; post?: (body: Record<string, unknown>) => { status: number; json: unknown } } = {}) {
  const rows: Record<string, unknown> = over.rows ?? { 'qitem-1': ASK, 'qitem-2': NEWS, 'qitem-3': PARKED };
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const http: RigHttp = async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'POST') return over.post?.(body as Record<string, unknown>) ?? { status: 200, json: {} };
    if (url === `${BASE}/api/attention`) return { status: 200, json: over.attention ?? ATTENTION };
    const id = decodeURIComponent(url.slice(`${BASE}/api/queue/`.length));
    return rows[id] ? { status: 200, json: rows[id] } : { status: 404, json: { error: 'qitem_not_found' } };
  };
  const run: RigRun = async () => ({ code: 0, stdout: JSON.stringify(HUMANS), stderr: '' });
  return { http, run, calls, rows };
}

describe('« À toi » reading', () => {
  it('reads asks, news and rows parked on the person, with the channel, most recent first', async () => {
    const f = fake();
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    const l = await h.list();
    expect(OpenRigAsksChangedSchema.parse({ type: 'openrig.asksChanged', ...l })).toBeTruthy();
    expect(l.channel).toEqual({ state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false });
    expect(l.asks.map(a => [a.id, a.kind])).toEqual([['qitem-3', 'parked'], ['qitem-1', 'decision'], ['qitem-2', 'update']]);
    const ask = l.asks.find(a => a.id === 'qitem-1')!;
    expect(ask).toMatchObject({ alert: true, from: { seat: 'dev-review@starter', rig: 'starter', role: 'dev.review' }, summary: 'Choisir une couleur', evidenceRef: '/tmp/evidence.md', bodyTruncated: false });
    expect(ask.questions).toEqual([
      { id: 'couleur', question: 'Quelle couleur ?', options: [{ id: 'bleu', label: 'Bleu', recommended: true }, { id: 'vert', label: 'Vert', recommended: false }], answer: 'bleu' },
      { id: 'taille', question: 'Quelle taille ?', options: [{ id: 's', label: 'S', recommended: false }, { id: 'm', label: 'M', recommended: false }], answer: null }
    ]);
    // A piece of news without a summary takes its first line; a parked row comes from its owner.
    expect(l.asks.find(a => a.id === 'qitem-2')).toMatchObject({ summary: 'La maquette est prête.', priority: 'urgent', alert: false });
    expect(l.asks.find(a => a.id === 'qitem-3')!.from.seat).toBe('dev-back@ledge-dev');
  });

  it('reads a row again only when it changed', async () => {
    const f = fake();
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    await h.list(); await h.list();
    expect(f.calls.filter(c => c.url.endsWith('/api/queue/qitem-1'))).toHaveLength(1);
  });

  it('says why nothing can reach the person', async () => {
    const f = fake({ attention: { items: [] } });
    const stopped = createHumanChannel({ state: async () => ({ ...RUNNING, daemon: { state: 'stopped' } }), run: f.run, http: f.http });
    expect((await stopped.list()).channel.state).toBe('openrig_stopped');
    const absent = createHumanChannel({ state: async () => ({ ...RUNNING, installed: false }), run: f.run, http: f.http });
    expect((await absent.list()).channel.state).toBe('not_installed');
    expect((await createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http }).list()).channel).toEqual({ state: 'no_person', person: null, slack: false });
    const down = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async () => ({ status: 0, json: undefined }) });
    expect((await down.list()).channel).toMatchObject({ state: 'unreachable', person: null });
  });

  it('cuts a long text and says so', () => {
    const a = toAsk({ ...ASK, body: 'x'.repeat(20_000) }, 'decision')!;
    expect(a.body).toHaveLength(16_000);
    expect(a.bodyTruncated).toBe(true);
  });

  it('names a seat by rig and role', () => {
    expect(seatParts('pilot-lead@ledge-dev')).toEqual({ rig: 'ledge-dev', role: 'pilot.lead' });
    expect(seatParts('dev-build-2@starter')).toEqual({ rig: 'starter', role: 'dev.build-2' });
    expect(seatParts('ledge@external')).toEqual({ rig: 'external', role: null });
    expect(attentionRef({ id: 'mission:x' })).toBeNull();
  });

  it('pushes the list when an OpenRig queue event comes, not on activity noise', async () => {
    vi.useFakeTimers();
    try {
      const f = fake();
      let emit: ((id: string | null, data: unknown) => void) | null = null;
      const urls: Array<[string, string | null]> = [];
      const sse: RigSse = (url, last, onEvent, signal) => { urls.push([url, last]); emit = onEvent; return new Promise(res => signal.addEventListener('abort', () => res())); };
      const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http, sse, debounceMs: 100, pollMs: 1e9 });
      const seen: HumanList[] = [];
      h.start(l => seen.push(l));
      await vi.advanceTimersByTimeAsync(50);
      expect(seen).toHaveLength(1);
      expect(urls[0]).toEqual([`${BASE}/api/events?replay=0`, null]);
      f.rows['qitem-1'] = { ...ASK, tsUpdated: '2026-11-02T19:59:00.000Z', humanAnswers: { couleur: 'bleu', taille: 'm' } };
      emit!('41', { type: 'agent.activity' });
      await vi.advanceTimersByTimeAsync(500);
      expect(seen).toHaveLength(1);
      // The attention feed's own time moves with the row.
      ATTENTION.items[0]!.at = '2026-11-02T19:59:00.000Z';
      emit!('42', { type: 'queue.updated' });
      emit!('43', { type: 'mission_control.action_executed' });
      await vi.advanceTimersByTimeAsync(500);
      expect(seen).toHaveLength(2);
      expect(seen[1]!.asks.find(a => a.id === 'qitem-1')!.questions[1]!.answer).toBe('m');
      h.stop();
    } finally { ATTENTION.items[0]!.at = ASK.tsUpdated; vi.useRealTimers(); }
  });
});

describe('« À toi » answering', () => {
  const answering = (post: (body: Record<string, unknown>) => { status: number; json: unknown }) => {
    const f = fake({ post });
    return { f, h: createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http }) };
  };

  it('a button is OpenRig\'s answer verb, as the primary user, and says what still waits', async () => {
    const { f, h } = answering(() => ({ status: 200, json: { verb: 'answer', answer: { outcome: 'recorded', unanswered: ['Quelle taille ?'] }, createdQitemId: null } }));
    const r = await h.answer('qitem-1', { kind: 'choice', questionId: 'couleur', optionId: 'bleu' });
    expect(OpenRigAnsweredSchema.parse({ type: 'openrig.answered', requestId: 'r', ...r })).toBeTruthy();
    expect(r).toEqual({ qitemId: 'qitem-1', ok: true, outcome: 'recorded', remaining: ['taille'] });
    expect(f.calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', url: `${BASE}/api/mission-control/action`,
      body: { verb: 'answer', questionId: 'couleur', optionId: 'bleu', qitemId: 'qitem-1', authority: 'primary-user', auditNotes: { client: 'ledge' } } });
  });

  it('the last answer goes back to the seat: answered, with the reply row', async () => {
    const { f, h } = answering(() => ({ status: 200, json: { answer: { outcome: 'answered', unanswered: [] }, createdQitemId: 'qitem-reply' } }));
    expect(await h.answer('qitem-1', { kind: 'words', text: 'Plutôt vert' })).toEqual({ qitemId: 'qitem-1', ok: true, outcome: 'answered', replyId: 'qitem-reply' });
    expect(f.calls.find(c => c.method === 'POST')!.body).toMatchObject({ verb: 'answer', decision: 'Plutôt vert' });
  });

  it('a second send is « already », nothing new', async () => {
    const { h } = answering(() => ({ status: 200, json: { answer: { outcome: 'answered', unanswered: [], message: 'Already answered; the original answer went to dev-review@starter as qitem-reply. No new reply was sent.' }, createdQitemId: 'qitem-reply' } }));
    expect(await h.answer('qitem-1', { kind: 'words', text: 'Plutôt vert' })).toMatchObject({ ok: true, outcome: 'already' });
  });

  it('« Vu » approves a piece of news; a parked row is resolved with words', async () => {
    const { f, h } = answering(() => ({ status: 200, json: {} }));
    expect(await h.answer('qitem-2', { kind: 'seen' })).toEqual({ qitemId: 'qitem-2', ok: true, outcome: 'answered' });
    expect(await h.answer('qitem-3', { kind: 'resolve', text: 'Oui, pousse' })).toEqual({ qitemId: 'qitem-3', ok: true, outcome: 'answered' });
    expect(f.calls.filter(c => c.method === 'POST').map(c => (c.body as { verb: string }).verb)).toEqual(['approve', 'resolve']);
  });

  it('refuses an answer that does not fit the row, without asking OpenRig', async () => {
    const { f, h } = answering(() => ({ status: 200, json: {} }));
    expect(await h.answer('qitem-2', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'refused' });
    expect(await h.answer('qitem-1', { kind: 'seen' })).toMatchObject({ ok: false, error: 'refused' });
    expect(await h.answer('qitem-1', { kind: 'resolve', text: 'x' })).toMatchObject({ ok: false, error: 'refused' });
    expect(f.calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('maps OpenRig\'s refusals', async () => {
    expect(await answering(() => ({ status: 200, json: {} })).h.answer('nope', { kind: 'seen' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(answerError(409, { error: 'qitem_already_terminal', message: 'already terminal' })).toEqual({ error: 'closed', message: 'already terminal' });
    expect(answerError(409, { error: 'answer_not_closed' }).error).toBe('not_closed');
    expect(answerError(400, { error: 'answer_not_recorded', message: 'not an ask' })).toEqual({ error: 'refused', message: 'not an ask' });
    expect(answerError(500, {}).error).toBe('unreachable');
    expect(answerError(0, undefined).error).toBe('unreachable');
    const { h } = answering(() => ({ status: 0, json: undefined }));
    expect(await h.answer('qitem-1', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'unreachable' });
  });

  it('says « not sent » when OpenRig is stopped', async () => {
    const f = fake();
    const h = createHumanChannel({ state: async () => ({ ...RUNNING, daemon: { state: 'stopped' } }), run: f.run, http: f.http });
    expect(await h.answer('qitem-1', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'openrig_stopped' });
  });

  it('the protocol takes the answer messages and refuses an empty text', () => {
    expect(parseClientMessage(({ type: 'openrig.answer', requestId: 'r', qitemId: 'q', answer: { kind: 'choice', questionId: 'a', optionId: 'b' } }))).toBeTruthy();
    expect(() => parseClientMessage(({ type: 'openrig.answer', requestId: 'r', qitemId: 'q', answer: { kind: 'words', text: '   ' } }))).toThrow();
    expect(parseClientMessage(({ type: 'openrig.asks', requestId: 'r' }))).toBeTruthy();
  });
});
