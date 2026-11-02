import { describe, it, expect, vi } from 'vitest';
import { OpenRigAnsweredSchema, OpenRigAsksChangedSchema, parseClientMessage, type OpenRigState } from '@ledge/protocol';
import { answerError, attentionRef, createHumanChannel, samePerson, seatParts, toAsk, type HumanList, type RigHttp, type RigSse } from '../src/daemon/openrigHuman.js';
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

function fake(over: { rows?: Record<string, unknown>; attention?: unknown; detail?: (id: string) => { status: number; json: unknown } | undefined; post?: (body: Record<string, unknown>) => { status: number; json: unknown } } = {}) {
  const rows: Record<string, unknown> = over.rows ?? { 'qitem-1': ASK, 'qitem-2': NEWS, 'qitem-3': PARKED };
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const http: RigHttp = async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'POST') return over.post?.(body as Record<string, unknown>) ?? { status: 200, json: {} };
    if (url === `${BASE}/api/attention?view=default`) return { status: 200, json: over.attention ?? ATTENTION };
    if (url.startsWith(`${BASE}/api/attention`)) return { status: 400, json: { error: 'this test serves the default view only' } };
    const id = decodeURIComponent(url.slice(`${BASE}/api/queue/`.length));
    const d = over.detail?.(id);
    if (d) return d;
    return rows[id] ? { status: 200, json: rows[id] } : { status: 404, json: { error: 'qitem_not_found' } };
  };
  const run: RigRun = async () => ({ code: 0, stdout: JSON.stringify(HUMANS), stderr: '' });
  return { http, run, calls, rows };
}

describe('« À toi » reading', () => {
  it('reads asks, news and rows parked on the person, with the channel, the pressing first then the most recent', async () => {
    const f = fake();
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    const l = await h.list();
    expect(OpenRigAsksChangedSchema.parse({ type: 'openrig.asksChanged', ...l })).toBeTruthy();
    expect(l.channel).toEqual({ state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false });
    // qitem-2 is urgent (and the oldest): it comes first.
    expect(l.asks.map(a => [a.id, a.kind])).toEqual([['qitem-2', 'update'], ['qitem-3', 'parked'], ['qitem-1', 'decision']]);
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

  it('a row OpenRig cannot read stays open, from what was known or from the attention item, and the list says it is partial', async () => {
    let failing = false;
    const f = fake({ detail: id => (failing && id === 'qitem-1' ? { status: 503, json: {} } : undefined) });
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    expect((await h.list()).partial).toBeUndefined();
    failing = true;
    ATTENTION.items[0]!.at = '2026-11-02T19:59:00.000Z'; // the row changed, so it is read again, and that read fails
    try {
      const l = await h.list();
      expect(l.partial).toBe(true);
      expect(l.channel.state).toBe('ready');
      expect(l.asks.find(a => a.id === 'qitem-1')).toMatchObject({ body: ASK.body, bodyTruncated: false });
      // Never read before: built from the attention item.
      const g = fake({ detail: id => (id === 'qitem-1' ? { status: 503, json: {} } : undefined),
        attention: { ...ATTENTION, items: [{ ...ATTENTION.items[0], asker: 'dev-review@starter', summary: 'Choisir une couleur', urgency: 'urgent', humanQuestions: ASK.humanQuestions, humanAnswers: {} }] } });
      const fresh = await createHumanChannel({ state: async () => RUNNING, run: g.run, http: g.http }).list();
      expect(fresh.partial).toBe(true);
      expect(fresh.asks[0]).toMatchObject({ id: 'qitem-1', summary: 'Choisir une couleur', body: 'Choisir une couleur', bodyTruncated: true, priority: 'urgent', from: { seat: 'dev-review@starter' } });
      expect(fresh.asks[0]!.questions.map(q => q.id)).toEqual(['couleur', 'taille']);
    } finally { ATTENTION.items[0]!.at = ASK.tsUpdated; }
  });

  it('a row OpenRig no longer has is settled; one a partial source leaves out is kept', async () => {
    const f = fake();
    const without1 = { ...ATTENTION, items: ATTENTION.items.filter(i => i.id !== 'queue:qitem-1') };
    // OpenRig could not read its queue fully: a row it leaves out is not settled.
    let calls = 0;
    const both = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async (m, u, b) => {
      if (u.endsWith('/api/attention?view=default')) return { status: 200, json: calls++ === 0 ? ATTENTION : { ...without1, sources: [{ source: 'queue', state: 'partial' }] } };
      return f.http(m, u, b);
    } });
    await both.list();
    const kept = await both.list();
    expect(kept.partial).toBe(true);
    expect(kept.asks.map(a => a.id)).toContain('qitem-1');
    // A complete read without it: settled.
    let calls2 = 0;
    const settled = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async (m, u, b) =>
      (u.endsWith('/api/attention?view=default') ? { status: 200, json: calls2++ === 0 ? ATTENTION : without1 } : f.http(m, u, b)) });
    await settled.list();
    expect((await settled.list()).asks.map(a => a.id)).not.toContain('qitem-1');
    // Listed but gone from the queue (404): settled too.
    const gone = fake({ detail: id => (id === 'qitem-1' ? { status: 404, json: { error: 'qitem_not_found' } } : undefined) });
    const g = await createHumanChannel({ state: async () => RUNNING, run: gone.run, http: gone.http }).list();
    expect(g.asks.map(a => a.id)).not.toContain('qitem-1');
    expect(g.partial).toBeUndefined();
  });

  it('OpenRig unreachable keeps the asks known, partial; stopped clears them', async () => {
    let up = true, running = true;
    const f = fake();
    const h = createHumanChannel({ state: async () => (running ? RUNNING : { ...RUNNING, daemon: { state: 'stopped' } }), run: f.run,
      http: async (m, u, b) => (up ? f.http(m, u, b) : { status: 0, json: undefined }) });
    await h.list();
    up = false;
    const l = await h.list();
    expect(l).toMatchObject({ channel: { state: 'unreachable' }, partial: true });
    expect(l.asks).toHaveLength(3);
    running = false;
    expect(await h.list()).toEqual({ channel: { state: 'openrig_stopped', person: null, slack: false }, asks: [] });
  });

  it('reads the default person\'s view only; several people and no default show nothing and say so', async () => {
    const f = fake();
    await createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http }).list();
    expect(f.calls.filter(c => c.url.includes('/api/attention')).map(c => c.url)).toEqual([`${BASE}/api/attention?view=default`]);
    const g = fake({ attention: { perspective: { viewing: null, basis: 'all', defaultSource: 'none', actingAs: { person: null, authority: 'primary-user' } }, items: ATTENTION.items } });
    const l = await createHumanChannel({ state: async () => RUNNING, run: g.run, http: g.http }).list();
    expect(l.channel.state).toBe('no_default');
    expect(l.asks).toEqual([]);
  });

  it('a change of default person forgets the asks known for the previous one, even on a partial read', async () => {
    const f = fake();
    let bob = false;
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async (m, u, b) => {
      if (!u.endsWith('/api/attention?view=default')) return f.http(m, u, b);
      return bob
        ? { status: 200, json: { perspective: { viewing: 'bob@external', basis: 'default', actingAs: { person: 'bob@external', authority: 'primary-user' } }, items: [], sources: [{ source: 'queue', state: 'unavailable' }] } }
        : { status: 200, json: ATTENTION };
    } });
    expect((await h.list()).asks).toHaveLength(3);
    bob = true;
    const l = await h.list();
    expect(l.channel.person?.address).toBe('bob@external');
    expect(l.asks).toEqual([]);
    expect(l.partial).toBe(true);
  });

  it('reads one at a time: a second read starts once the first has ended', async () => {
    const f = fake();
    let inFlight = 0, most = 0;
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async (m, u, b) => {
      if (!u.endsWith('/api/attention?view=default')) return f.http(m, u, b);
      inFlight++; most = Math.max(most, inFlight);
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
      return f.http(m, u, b);
    } });
    const [a, b] = await Promise.all([h.list(), h.list()]);
    expect(most).toBe(1);
    expect(a.asks).toHaveLength(3);
    expect(b.asks).toHaveLength(3);
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
    // No person registered: OpenRig's Feed has no perspective at all.
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
      body: { verb: 'answer', questionId: 'couleur', optionId: 'bleu', qitemId: 'qitem-1', actorSession: 'ledge@external', authority: 'primary-user', auditNotes: { client: 'ledge' } } });
  });

  it('what still waits comes from OpenRig\'s answer and the row read before, never from a second read; unknown stays unknown', async () => {
    let after = false;
    const f = fake({ detail: id => (after && id === 'qitem-1' ? { status: 503, json: {} } : undefined),
      post: () => { after = true; return { status: 200, json: { answer: { outcome: 'recorded', unanswered: ['Quelle taille ?'] } } }; } });
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    expect(await h.answer('qitem-1', { kind: 'choice', questionId: 'couleur', optionId: 'bleu' })).toEqual({ qitemId: 'qitem-1', ok: true, outcome: 'recorded', remaining: ['taille'] });
    // Nothing is read after the answer went (the reads before it check the row and who the person is).
    expect(f.calls.slice(f.calls.findIndex(c => c.method === 'POST') + 1)).toEqual([]);
    const g = fake({ post: () => ({ status: 200, json: { answer: { outcome: 'recorded', unanswered: ['Une question que la ligne ne porte pas'] } } }) });
    const r = await createHumanChannel({ state: async () => RUNNING, run: g.run, http: g.http }).answer('qitem-1', { kind: 'choice', questionId: 'couleur', optionId: 'bleu' });
    expect(r).toEqual({ qitemId: 'qitem-1', ok: true, outcome: 'recorded' });
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
    expect(f.calls.filter(c => c.method === 'POST').map(c => [(c.body as { verb: string }).verb, (c.body as { actorSession: string }).actorSession])).toEqual([['approve', 'ledge@external'], ['resolve', 'ledge@external']]);
  });

  it('refuses an answer that does not fit the row, without asking OpenRig', async () => {
    const { f, h } = answering(() => ({ status: 200, json: {} }));
    expect(await h.answer('qitem-2', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'refused' });
    expect(await h.answer('qitem-1', { kind: 'seen' })).toMatchObject({ ok: false, error: 'refused' });
    expect(await h.answer('qitem-1', { kind: 'resolve', text: 'x' })).toMatchObject({ ok: false, error: 'refused' });
    expect(f.calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('refuses to answer a row addressed to another person', async () => {
    const f = fake({ rows: { 'qitem-1': ASK, 'qitem-2': NEWS, 'qitem-3': PARKED, 'qitem-bob': { ...ASK, qitemId: 'qitem-bob', destinationSession: 'bob@external' } } });
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    expect(await h.answer('qitem-bob', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'refused', message: 'this row is not addressed to ledge@external' });
    expect(f.calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('sends nothing when the default person cannot be checked now, nor to the previous one once it changed', async () => {
    const f = fake();
    let attention: 'ok' | 'down' | 'bob' = 'ok';
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: async (m, u, b) => {
      if (!u.endsWith('/api/attention?view=default')) return f.http(m, u, b);
      if (attention === 'down') return { status: 503, json: {} };
      if (attention === 'bob') return { status: 200, json: { perspective: { viewing: 'bob@external', basis: 'default', actingAs: { person: 'bob@external', authority: 'primary-user' } }, items: [] } };
      return { status: 200, json: ATTENTION };
    } });
    await h.list();
    attention = 'down';
    expect(await h.answer('qitem-1', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'unreachable' });
    attention = 'bob';
    expect(await h.answer('qitem-1', { kind: 'words', text: 'x' })).toMatchObject({ ok: false, error: 'refused', message: 'this row is not addressed to bob@external' });
    expect(f.calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('answers an ask or a park addressed to the person by one of their seats, as OpenRig resolves it', async () => {
    const f = fake({ rows: {
      'q-seat': { ...ASK, qitemId: 'q-seat', destinationSession: 'ledge@some-rig' },
      'q-park': { ...PARKED, qitemId: 'q-park', blockedOn: 'ledge@other-rig' },
      'q-bob': { ...ASK, qitemId: 'q-bob', destinationSession: 'bob@some-rig' }
    }, post: () => ({ status: 200, json: { answer: { outcome: 'answered', unanswered: [] }, createdQitemId: 'r' } }) });
    const h = createHumanChannel({ state: async () => RUNNING, run: f.run, http: f.http });
    expect(await h.answer('q-seat', { kind: 'words', text: 'Oui' })).toMatchObject({ ok: true, outcome: 'answered' });
    expect(await h.answer('q-park', { kind: 'resolve', text: 'Oui' })).toMatchObject({ ok: true, outcome: 'answered' });
    expect(await h.answer('q-bob', { kind: 'words', text: 'Oui' })).toMatchObject({ ok: false, error: 'refused' });
    expect(f.calls.filter(c => c.method === 'POST').map(c => (c.body as { actorSession: string }).actorSession)).toEqual(['ledge@some-rig', 'ledge@other-rig']);
    expect(samePerson('ledge@external', 'ledge')).toBe(true);
    expect(samePerson('ledge-dev@x', 'ledge')).toBe(false);
    expect(samePerson('ledge', 'ledge')).toBe(false);
    expect(samePerson('ledge@', 'ledge')).toBe(false);
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
