import { describe, it, expect, vi, afterEach } from 'vitest';
import { PhoneClientMessageSchema, PhoneServerMessageSchema, PhoneSessionSchema, UNTYPABLE, PHONE_PROTOCOL, OperationReasonSchema, SessionSchema, PAD_TIERS, PLAIN_MAX, padPlain, PushPayloadSchema, PhoneChatTurnSchema, ConfirmPurposeSchema, b64Max, ATTACHMENT_MAX, PREVIEW_MAX } from '../src/index.js';

const OP = '123e4567-e89b-42d3-a456-426614174000';
const expectKey = { kind: 'permission', text: 'Run ls', key: 'k1' };

describe('phone client messages', () => {
  it('accepts the seven commands', () => {
    for (const m of [
      { type: 'snapshot.request' },
      { type: 'session.thread', id: 's1' },
      { type: 'session.watch', id: 's1' },
      { type: 'session.watch', id: null },
      { type: 'session.read', id: 's1', at: '2026-10-20T10:00:00.000Z' },
      { type: 'session.decide', op: OP, id: 's1', decision: 'accept', expect: expectKey },
      { type: 'session.decide', op: OP, id: 's1', decision: 'deny', note: '  no  ', expect: expectKey },
      { type: 'session.reply', op: OP, id: 's1', text: 'hello', expect: null },
      { type: 'session.reply', op: OP, id: 's1', text: '1', expect: expectKey },
      { type: 'session.interrupt', op: OP, id: 's1' }
    ]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
    const d = PhoneClientMessageSchema.parse({ type: 'session.decide', op: OP, id: 's1', decision: 'deny', note: '  no  ', expect: expectKey });
    expect(d).toMatchObject({ note: 'no' });
  });
  it('requires expect with its key, and a uuid op', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.decide', op: OP, id: 's1', decision: 'accept' })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.decide', op: OP, id: 's1', decision: 'accept', expect: { kind: 'permission', text: 'x' } })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.decide', op: 'x', id: 's1', decision: 'accept', expect: expectKey })).toThrow();
  });
  it('requires a reply to name the request it answers, or null', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: 'hi' })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: 'hi', expect: { kind: 'question', text: 'q' } })).toThrow();
  });
  it('bounds a reply to 20 000 characters', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: 'x'.repeat(20_001), expect: null })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: 'x'.repeat(20_000), expect: null })).not.toThrow();
    // An image may stand alone: empty text is the gateway's to judge.
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: '', attachments: ['d'.repeat(64)], expect: null })).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: 'x', attachments: Array(6).fill('d'.repeat(64)), expect: null })).toThrow();
  });
  it('refuses every command outside the whitelist', () => {
    for (const m of [
      { type: 'session.message', rid: 'r', from: 'a', to: 'b', text: 'x' },
      { type: 'chat.ask', qid: 'q', text: 'x' },
      { type: 'mobile.signout' },
      { type: 'session.launch', tool: 'claude', cwd: '/tmp' }
    ]) expect(() => PhoneClientMessageSchema.parse(m)).toThrow();
  });
});

describe('phone projection', () => {
  const full = SessionSchema.parse({
    id: 's1', name: 'bot', tool: 'claude', cwd: '/home/x', project: 'p', title: 't', repoPath: '/home/x/r', workdir: '/home/x/w',
    tmuxSession: 'ledge-s1', state: 'idle', startedAt: '2026-10-20T10:00:00.000Z', lastActivityAt: '2026-10-20T10:00:00.000Z', source: 'launcher',
    machineId: 'm', lastMessage: { id: 'i', to: 'b', summary: 's', at: '2026-10-20T10:00:00.000Z' }
  });
  it('drops the fields the phone must not see', () => {
    const p = PhoneSessionSchema.parse({ ...full, unread: false });
    for (const k of ['cwd', 'repoPath', 'workdir', 'tmuxSession', 'lastMessage', 'machineId']) expect(p).not.toHaveProperty(k);
    expect(p).toMatchObject({ id: 's1', unread: false, helpers: [] });
  });
  it('needs a key, risk and reason on a pending request', () => {
    const pending = { kind: 'permission', text: 'x', source: 'hook' };
    expect(() => PhoneSessionSchema.parse({ ...full, unread: false, pending })).toThrow();
    expect(() => PhoneSessionSchema.parse({ ...full, unread: false, pending: { ...pending, key: 'k', risk: 'low', riskReason: 'unknown' } })).not.toThrow();
  });
});

describe('phone server messages', () => {
  it('parses a snapshot and a thread', () => {
    const caps = { freeTextAnswer: true };
    expect(() => PhoneServerMessageSchema.parse({ type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps, omp: caps }, daemon: { version: '1.0.0', name: 'pc' } })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps, omp: caps }, daemon: { version: '1.0.0', name: 'x'.repeat(41) } })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.pending', id: 's1' })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.pending', id: 's1', pending: { kind: 'plan', text: 'x', source: 'hook', key: 'k', risk: 'high', riskReason: 'plan', cut: true } })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.thread', id: 's1', items: [], cut: [], more: false })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'operation.result', op: OP, status: 'rejected', reason: 'confirm_required' })).not.toThrow();
  });
  it('keeps errors free of text', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'error', code: 'invalid', request: 'x'.repeat(41) })).toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'error', code: 'whatever' })).toThrow();
    expect(PhoneServerMessageSchema.parse({ type: 'error', code: 'too_large', message: 'secret' })).not.toHaveProperty('message');
  });
  it('extends the refusal codes with the operation ones', () => {
    for (const r of ['stale', 'untypable', 'confirm_required', 'conflict']) expect(OperationReasonSchema.parse(r)).toBe(r);
  });
});

describe('UNTYPABLE', () => {
  it('detects what cannot be typed as one line', () => {
    for (const c of ['a\nb', 'a\x1bb', 'a\u202eb', 'a\u200bb']) expect(UNTYPABLE.test(c)).toBe(true);
  });
  it('lets text, emoji and joiners through', () => {
    for (const c of ['é', '👩\u200d💻', 'a\u200db']) expect(UNTYPABLE.test(c)).toBe(false);
  });
});

describe('padPlain', () => {
  const size = (t: string) => new TextEncoder().encode(t).length;
  const jsonOf = (bytes: number) => JSON.stringify({ a: 'x'.repeat(bytes - 8) });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pads {} to the first tier with spaces that JSON.parse ignores', () => {
    const p = padPlain('{}')!;
    expect(size(p)).toBe(PAD_TIERS[0]);
    expect(p.trimEnd()).toBe('{}');
    expect(JSON.parse(p)).toEqual({});
  });
  it('moves a JSON one byte past a tier to the next one, and keeps an exact tier as is', () => {
    expect(size(padPlain(jsonOf(1025))!)).toBe(4096);
    expect(padPlain(jsonOf(1024))).toBe(jsonOf(1024));
  });
  it('counts UTF-8 bytes, not characters', () => {
    expect(size(padPlain(JSON.stringify({ a: 'é'.repeat(1000) }))!)).toBe(4096);
  });
  it('refuses past PLAIN_MAX', () => {
    expect(size(padPlain(jsonOf(PLAIN_MAX))!)).toBe(PLAIN_MAX);
    expect(padPlain(jsonOf(PLAIN_MAX + 1))).toBeNull();
  });
  it('needs no Buffer, as in a browser', () => {
    vi.stubGlobal('Buffer', undefined);
    expect(size(padPlain('{"t":"ab"}')!)).toBe(1024);
  });
});

describe('phone device confirmation (lot 6a)', () => {
  const credential = { id: 'AbC_-9', publicKey: 'MFkw', alg: -7, clientDataJSON: 'eyJ0', authenticatorData: 'SZYN', transports: ['internal'] };
  const assertion = { id: 'AbC_-9', clientDataJSON: 'eyJ0', authenticatorData: 'SZYN', signature: 'MEUC' };
  const caps = { freeTextAnswer: true };
  const allCaps = { claude: caps, codex: caps, cursor: caps, omp: caps };
  const snap = { type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: allCaps, daemon: { version: '1.0.0', name: 'pc' } };

  it('accepts the new client messages', () => {
    for (const m of [
      { type: 'confirm.prepare', purpose: 'register' },
      { type: 'confirm.prepare', purpose: 'decide', id: 's1', expect: expectKey },
      { type: 'credential.register', op: OP, credential },
      { type: 'credential.register', op: OP, credential: { ...credential, alg: -257, transports: undefined } },
      { type: 'session.decide', op: OP, id: 's1', decision: 'accept', expect: expectKey, assertion },
      { type: 'session.reply', op: OP, id: 's1', text: '1', expect: expectKey, assertion },
      { type: 'session.answer', op: OP, id: 's1', requestId: 'r1', answers: [{ id: 'q1', selected: ['a'], text: 'x' }], expect: expectKey },
      { type: 'session.answer', op: OP, id: 's1', requestId: 'r1', answers: [], cancel: true, expect: expectKey },
      { type: 'device.forget', op: OP }
    ]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
  });
  it('refuses a bad algorithm and non base64url fields', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'credential.register', op: OP, credential: { ...credential, alg: -8 } })).toThrow();
    for (const bad of ['ab+c', 'ab=']) {
      expect(() => PhoneClientMessageSchema.parse({ type: 'credential.register', op: OP, credential: { ...credential, clientDataJSON: bad } })).toThrow();
      expect(() => PhoneClientMessageSchema.parse({ type: 'session.decide', op: OP, id: 's1', decision: 'accept', expect: expectKey, assertion: { ...assertion, signature: bad } })).toThrow();
    }
    expect(() => PhoneClientMessageSchema.parse({ type: 'confirm.prepare', purpose: 'bogus' })).toThrow();
  });
  it('bounds session.answer like the local one', () => {
    const base = { type: 'session.answer', op: OP, id: 's1', requestId: 'r1', expect: expectKey };
    const a = { id: 'q', selected: [] };
    expect(() => PhoneClientMessageSchema.parse({ ...base, answers: Array(50).fill(a) })).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ ...base, answers: Array(51).fill(a) })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ ...base, answers: [], cancel: false })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ ...base, answers: [], expect: undefined })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ ...base, requestId: '', answers: [] })).toThrow();
  });
  it('accepts a confirm.challenge', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'confirm.challenge', purpose: 'decide', challenge: 'abc_-', rpId: 'relay.example', credentialId: 'AbC', expiresInMs: 60_000 })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'confirm.challenge', purpose: 'register', challenge: 'abc', rpId: 'relay.example', expiresInMs: 0 })).toThrow();
  });
  it('the phone whitelist holds no team, role, template or task message', () => {
    const types = PhoneClientMessageSchema.options.map(o => o.shape.type.value);
    expect(types.filter(t => /^(team|teams|role|template|task)\.|^chat\.(team|task)$/.test(t))).toEqual([]);
    expect(types).toContain('daemon.update');
    expect(() => PhoneClientMessageSchema.parse({ type: 'teams.catalog' })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'team.resume', op: OP, team: 't' })).toThrow();
  });
  it('the phone server messages hold no team, role or task message', () => {
    const types = PhoneServerMessageSchema.options.map(o => o.shape.type.value);
    expect(types.filter(t => /^(team|teams|role|task)(\.|$)/.test(t))).toEqual([]);
  });
  it('daemon.update still takes a passkey assertion', () => expect(PhoneClientMessageSchema.safeParse({ type: 'daemon.update', op: OP, version: '1.2.3', assertion }).success).toBe(true));
  it('a challenge covers the supported purposes, and prepare carries no digest', () => {
    expect(ConfirmPurposeSchema.options).toEqual(['register', 'decide', 'launch', 'close', 'act', 'pc', 'rig']);
    expect(PhoneClientMessageSchema.parse({ type: 'confirm.prepare', purpose: 'pc', digest: 'a'.repeat(64) })).not.toHaveProperty('digest');
  });
  it('a session carries no role, role label or team, and the snapshot no teams flag', () => {
    const s = PhoneSessionSchema.parse({ id: 's1', name: 'bot', tool: 'claude', project: 'p', title: 't', state: 'idle', startedAt: '2026-10-20T10:00:00.000Z', lastActivityAt: '2026-10-20T10:00:00.000Z', cwd: '/x', unread: false, role: 'r', roleLabel: 'R', team: 't' });
    for (const k of ['role', 'roleLabel', 'team']) expect(s).not.toHaveProperty(k);
    const snapshot = PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1', name: 'pc', teams: true } }) as { daemon: object };
    expect(snapshot.daemon).not.toHaveProperty('teams');
  });
  it('the operation reasons hold no definition code', () => {
    for (const r of ['changed', 'exists', 'unknown_project', 'seat_failed']) expect(OperationReasonSchema.options).not.toContain(r);
  });
  it('still parses a lot 5 snapshot and takes the new fields', () => {
    expect(() => PhoneServerMessageSchema.parse(snap)).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ ...snap, device: { confirm: true }, daemon: { version: '1', name: 'pc', boot: OP } })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1', name: 'pc', boot: 'nope' } })).toThrow();
    const c2 = { freeTextAnswer: true, decide: false, questions: true };
    expect(() => PhoneServerMessageSchema.parse({ ...snap, capabilities: { claude: c2, codex: c2, cursor: c2, omp: c2 } })).not.toThrow();
  });
  it('extends the operation reasons', () => {
    for (const r of ['assertion_invalid', 'assertion_expired']) expect(OperationReasonSchema.parse(r)).toBe(r);
  });
});

describe('phone push and presence', () => {
  const sub = { endpoint: 'https://web.push.apple.com/QZ', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
  const key = 'A'.repeat(87);
  it('accepts push.subscribe, push.unsubscribe and presence', () => {
    for (const m of [
      { type: 'push.subscribe', op: OP, subscription: sub, key },
      { type: 'push.unsubscribe', op: OP },
      { type: 'presence', visible: true },
      { type: 'presence', visible: false }
    ]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
  });
  it('requires an op for push.subscribe and push.unsubscribe, a valid subscription and key', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'push.subscribe', subscription: sub, key })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'push.unsubscribe' })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'push.subscribe', op: OP, subscription: { ...sub, endpoint: 'https://evil.example/x' }, key })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'push.subscribe', op: OP, subscription: sub, key: 'A'.repeat(86) })).toThrow();
  });
  it('requires a boolean visible on presence', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'presence' })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'presence', visible: 'yes' })).toThrow();
  });
  it('takes snapshot.device.push as an optional enum', () => {
    const cap = { freeTextAnswer: true };
    const snap = (device: object) => ({ type: 'snapshot', protocol: 1, sessions: [], capabilities: { claude: cap, codex: cap, cursor: cap, omp: cap }, daemon: { version: '1', name: 'pc' }, device });
    expect(() => PhoneServerMessageSchema.parse(snap({ confirm: true }))).not.toThrow();
    for (const push of ['on', 'off', 'stale', 'unavailable']) expect(() => PhoneServerMessageSchema.parse(snap({ confirm: true, push }))).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse(snap({ confirm: true, push: 'maybe' }))).toThrow();
  });
});

describe('phone chat', () => {
  const QID = '223e4567-e89b-42d3-a456-426614174001';
  const turn = { qid: QID, question: 'q', askedAt: '2026-10-20T10:00:00.000Z', steps: [{ kind: 'pane', id: 's1', name: 'api' }] };
  const snap = { type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: { freeTextAnswer: true }, codex: { freeTextAnswer: true }, cursor: { freeTextAnswer: true }, omp: { freeTextAnswer: true } }, daemon: { version: '1.0.0', name: 'pc' } };
  it('accepts a turn and refuses a cwd in a proposal or a path in a step', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'chat.done', qid: QID, turn: { ...turn, answer: 'a', proposals: [{ project: 'p', tool: 'claude', prompt: 'go' }], relay: { id: 's1', name: 'api', tool: 'claude', text: 'x' } } })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'chat.done', qid: QID, turn: { ...turn, proposals: [{ project: 'p', tool: 'claude', cwd: '/home/x' }] } })).toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'chat.done', qid: QID, turn: { ...turn, steps: [{ kind: 'repo', path: '/etc/passwd' }] } })).toThrow();
  });
  it('parses the server messages', () => {
    for (const m of [
      { type: 'chat.history', turns: [turn] },
      { type: 'chat.step', qid: QID, step: { kind: 'git', id: 's1' } },
      { type: 'chat.delta', qid: QID, text: 'abc' },
      { type: 'chat.error', qid: QID, code: 'busy' }
    ]) expect(() => PhoneServerMessageSchema.parse(m)).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'chat.error', qid: QID, code: 'boom' })).toThrow();
  });
  it('checks the client messages', () => {
    for (const m of [
      { type: 'chat.ask', qid: QID, text: '  hi ' }, { type: 'chat.cancel', qid: QID }, { type: 'chat.reset' }, { type: 'chat.history' },
      { type: 'chat.relay', op: OP, qid: QID }, { type: 'chat.launch', op: OP, qid: QID, rows: [0, 7] },
      { type: 'confirm.prepare', purpose: 'launch', qid: QID }
    ]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
    expect(PhoneClientMessageSchema.parse({ type: 'chat.ask', qid: QID, text: '  hi ' })).toMatchObject({ text: 'hi' });
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.ask', qid: 'nope', text: 'hi' })).toThrow();
    // Blank text is the gateway's to judge: an image may stand alone.
    expect(PhoneClientMessageSchema.parse({ type: 'chat.ask', qid: QID, text: '   ' })).toMatchObject({ text: '' });
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.launch', op: OP, qid: QID, rows: [8] })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.launch', op: OP, qid: QID, rows: [0, 0] })).toThrow();
  });
  it('carries the close card, strictly', () => {
    const row = { id: 's1', name: 'Arlo', tool: 'claude', how: 'killed', closedAt: '2026-10-20T10:00:00.000Z' };
    expect(() => PhoneChatTurnSchema.parse({ ...turn, closes: [row] })).not.toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, closes: [{ ...row, error: 'busy' }] })).toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, closes: [] })).toThrow();
    expect(ConfirmPurposeSchema.parse('close')).toBe('close');
  });
  it('carries the generic rows without their args, strictly', () => {
    const row = { action: 'session.archive', summary: 'Archiver **api**', risk: 'reversible', session: 'local:api' };
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [row] })).not.toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ ...row, state: 'refused' }] })).not.toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ ...row, args: { session: 'local:api' } }] })).toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ ...row, error: 'boom' }] })).toThrow();
    expect(ConfirmPurposeSchema.parse('act')).toBe('act');
    // Its words for the phone's own language, a cut detail, an error as a code, an action this PWA does not know yet.
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ ...row, action: 'session.later', vars: { session: 'api' }, detail: 'x…', detailCut: true, state: 'failed', code: 'failed' }] })).not.toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ ...row, code: 'x'.repeat(41) }] })).toThrow();
  });
  it('carries an ignored turn, and chat.ignore', () => {
    expect(() => PhoneChatTurnSchema.parse({ ...turn, ignoredAt: '2026-10-20T10:00:00.000Z' })).not.toThrow();
    expect(PhoneClientMessageSchema.parse({ type: 'chat.ignore', op: OP, qid: QID })).toEqual({ type: 'chat.ignore', op: OP, qid: QID });
    expect(PhoneClientMessageSchema.parse({ type: 'chat.ignore', op: OP, qid: QID, undo: true })).toMatchObject({ undo: true });
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.ignore', op: OP, qid: 'nope' })).toThrow();
  });
  it('checks the chat.act client message', () => {
    const assertion = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
    for (const m of [{ type: 'chat.act', op: OP, qid: QID }, { type: 'chat.act', op: OP, qid: QID, rows: [1, 0], confirmed: true, assertion }]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.act', op: OP, qid: QID, rows: [0, 0] })).toThrow();
    expect(PhoneClientMessageSchema.parse({ type: 'chat.act', op: OP, qid: QID, rows: [0], deny: true })).toMatchObject({ deny: true });
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.act', op: OP, qid: QID, deny: false })).toThrow();
    expect(() => PhoneChatTurnSchema.parse({ ...turn, actions: [{ action: 'session.decide', summary: 'Accepter', risk: 'destructive', state: 'denied', doneAt: '2026-10-20T10:00:00.000Z' }] })).not.toThrow();
    expect(PhoneClientMessageSchema.parse({ type: 'chat.act', op: OP, qid: QID, args: { team: 'x' } })).not.toHaveProperty('args');
  });
  it('checks the chat.close client message', () => {
    const assertion = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
    for (const m of [{ type: 'chat.close', op: OP, qid: QID }, { type: 'chat.close', op: OP, qid: QID, rows: [0, 2], assertion }]) expect(() => PhoneClientMessageSchema.parse(m)).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.close', op: OP, qid: QID, rows: [0, 0] })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'chat.close', op: OP, qid: QID, rows: [8] })).toThrow();
  });
  it('keeps a snapshot without chat valid and accepts chat: true', () => {
    expect(() => PhoneServerMessageSchema.parse({ ...snap, device: { confirm: true } })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ ...snap, device: { confirm: true, chat: true } })).not.toThrow();
  });
  it('accepts a chat push payload', () => {
    expect(PushPayloadSchema.safeParse({ v: 1, kind: 'chat', title: 'Ledge a répondu', body: 'Touchez pour lire la réponse.', url: '/#/chat', badge: 0, tag: 'chat' }).success).toBe(true);
  });
});

describe('phone attachments', () => {
  const QID = '223e4567-e89b-42d3-a456-426614174001';
  const b64 = (bytes: number) => 'A'.repeat(b64Max(bytes));
  const put = (data: string, preview?: string) => ({ type: 'attachment.put', requestId: 'r1', image: { mime: 'image/webp', data, ...(preview ? { preview: { mime: 'image/webp', data: preview } } : {}) } });

  it('caps a put at 400 000 bytes and takes no session id', () => {
    expect(() => PhoneClientMessageSchema.parse(put(b64(ATTACHMENT_MAX)))).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse(put(b64(ATTACHMENT_MAX) + 'A'))).toThrow();
    expect(PhoneClientMessageSchema.parse({ ...put('AAAA'), id: 's1' })).not.toHaveProperty('id');
  });

  it('takes a get by id, and refuses a path', () => {
    const get = { type: 'attachment.get', requestId: 'r1', attachment: 'e'.repeat(64), preview: true };
    expect(PhoneClientMessageSchema.parse(get)).toEqual(get);
    expect(() => PhoneClientMessageSchema.parse({ ...get, attachment: '../x' })).toThrow();
  });

  it('seals the largest put under PLAIN_MAX', () => {
    const json = JSON.stringify(put(b64(ATTACHMENT_MAX), b64(PREVIEW_MAX)));
    expect(padPlain(json)).not.toBeNull();
  });

  it('takes attachments on a chat question and a turn, and sends the three answers', () => {
    const id = 'f'.repeat(64);
    expect(PhoneClientMessageSchema.parse({ type: 'chat.ask', qid: QID, text: '  ', attachments: [id] })).toMatchObject({ text: '', attachments: [id] });
    const ref = { id, mime: 'image/png', width: 5, height: 5, bytes: 30, preview: false };
    expect(() => PhoneChatTurnSchema.parse({ qid: QID, question: 'q', askedAt: '2026-10-20T10:00:00.000Z', steps: [], attachments: [ref] })).not.toThrow();
    expect(() => PhoneChatTurnSchema.parse({ qid: QID, question: 'q', askedAt: '2026-10-20T10:00:00.000Z', steps: [], attachments: Array(6).fill(ref) })).toThrow();
    expect(PhoneServerMessageSchema.parse({ type: 'attachment.stored', requestId: 'r1', ref }).type).toBe('attachment.stored');
    expect(PhoneServerMessageSchema.parse({ type: 'attachment.data', requestId: 'r1', attachment: id, mime: 'image/png', data: 'AAAA' }).type).toBe('attachment.data');
    expect(PhoneServerMessageSchema.parse({ type: 'attachment.error', requestId: 'r1', reason: 'too_large' }).type).toBe('attachment.error');
  });
});

describe('phone model change', () => {
  const sess = SessionSchema.parse({
    id: 's1', name: 'bot', tool: 'claude', cwd: '/home/x', project: 'p', title: 't', tmuxSession: 'ledge-s1', state: 'idle',
    startedAt: '2026-10-20T10:00:00.000Z', lastActivityAt: '2026-10-20T10:00:00.000Z', source: 'launcher'
  });
  const psess = { ...sess, unread: false };
  const caps = { freeTextAnswer: true };
  it('a session carries its model, effort, pending change and canSwitch', () => {
    const p = PhoneSessionSchema.parse({ ...psess, model: 'opus', effort: 'high', modelNext: { model: 'sonnet' }, canSwitch: true });
    expect(p).toMatchObject({ model: 'opus', effort: 'high', modelNext: { model: 'sonnet' }, canSwitch: true });
    expect(() => PhoneSessionSchema.parse({ ...psess, canSwitch: false })).toThrow();
  });
  it('the client asks for models and changes one', () => {
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.model', op: OP, id: 's1', model: null, effort: null })).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.model', op: OP, id: 's1', model: 'opus', effort: 'high' })).not.toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.model', id: 's1', model: null, effort: null })).toThrow();
    expect(() => PhoneClientMessageSchema.parse({ type: 'models.list', tool: 'claude' })).not.toThrow();
  });
  it('the daemon lists models strictly and reports a failure', () => {
    const m = { id: 'opus', label: 'Opus', description: 'd', efforts: ['low'], defaultEffort: 'low', isDefault: true };
    expect(() => PhoneServerMessageSchema.parse({ type: 'models.listing', tool: 'claude', models: [m] })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'models.listing', tool: 'claude', models: [], error: true })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'models.listing', tool: 'claude', models: [{ ...m, extra: 1 }] })).toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'models.listing', tool: 'claude', models: [{ ...m, label: 'x'.repeat(81) }] })).toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.model.failed', id: 's1', reason: 'restart_failed' })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.model.failed', id: 's1', reason: 'boom' })).toThrow();
  });
  it('an operation result may be scheduled', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'operation.result', op: OP, status: 'applied', reason: 'scheduled' })).not.toThrow();
    expect(OperationReasonSchema.options).toContain('restart_failed');
  });
  it('the snapshot announces the model change', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps, omp: caps }, daemon: { version: '1.0.0', name: 'pc', models: true } })).not.toThrow();
  });
});

describe('phone checklist', () => {
  const full = SessionSchema.parse({
    id: 's1', name: 'bot', tool: 'claude', cwd: '/home/x', project: 'p', title: 't', repoPath: '/home/x/r', workdir: '/home/x/w',
    tmuxSession: 'ledge-s1', state: 'idle', startedAt: '2026-10-20T10:00:00.000Z', lastActivityAt: '2026-10-20T10:00:00.000Z', source: 'launcher', machineId: 'm'
  });
  const cap = { freeTextAnswer: true };
  const snap = { type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: cap, codex: cap, cursor: cap, omp: cap }, daemon: { version: '1.0.0', name: 'pc' } };
  it('keeps the summary on a session, and accepts a session without one', () => {
    const checklist = { done: 2, total: 5, current: 'Write the test' };
    expect(PhoneSessionSchema.parse({ ...full, unread: false, checklist }).checklist).toEqual(checklist);
    expect(PhoneSessionSchema.parse({ ...full, unread: false })).not.toHaveProperty('checklist');
  });
  it('bounds the summary text', () => {
    expect(() => PhoneSessionSchema.parse({ ...full, unread: false, checklist: { done: 0, total: 1, current: 'x'.repeat(201) } })).toThrow();
  });
  it('sends the list, or null when there is none', () => {
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.checklist', id: 'a', checklist: null })).not.toThrow();
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.checklist', id: 'a', checklist: { tasks: [{ text: 'a', status: 'in_progress' }], done: 0, total: 1 } })).not.toThrow();
    const tasks = Array.from({ length: 51 }, () => ({ text: 'a', status: 'pending' }));
    expect(() => PhoneServerMessageSchema.parse({ type: 'session.checklist', id: 'a', checklist: { tasks, done: 0, total: 51 } })).toThrow();
  });
  it('announces the capability in the snapshot, optionally', () => {
    expect(PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1.0.0', name: 'pc', checklist: true } })).toMatchObject({ daemon: { checklist: true } });
    expect(PhoneServerMessageSchema.parse(snap)).not.toHaveProperty('daemon.checklist');
    expect(() => PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1.0.0', name: 'pc', checklist: false } })).toThrow();
  });
});

describe('phone session close and resume', () => {
  const assertion = { id: 'AbC_-9', clientDataJSON: 'eyJ0', authenticatorData: 'SZYN', signature: 'MEUC' };
  const caps = { freeTextAnswer: true };
  const snap = { type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps, omp: caps }, daemon: { version: '1.0.0', name: 'pc' } };
  const session = { id: 's1', name: 'Nova', tool: 'claude', project: 'p', title: 't', state: 'exited', helpers: [], startedAt: '2026-10-29T18:00:00.000Z', lastActivityAt: '2026-10-29T18:42:00.000Z', unread: false };

  it('takes session.close and session.resume on a session, with the device check', () => {
    for (const type of ['session.close', 'session.resume']) {
      expect(() => PhoneClientMessageSchema.parse({ type, op: OP, id: 's1', assertion })).not.toThrow();
      expect(() => PhoneClientMessageSchema.parse({ type, op: OP, id: '' })).toThrow();
      expect(() => PhoneClientMessageSchema.parse({ type, op: 'nope', id: 's1' })).toThrow();
    }
  });
  it('a close or act challenge may name a session instead of a turn', () => {
    for (const purpose of ['close', 'act']) expect(() => PhoneClientMessageSchema.parse({ type: 'confirm.prepare', purpose, id: 's1' })).not.toThrow();
  });
  it('the daemon says it takes them; a result says how the agent was closed', () => {
    expect(PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1', name: 'pc', sessionClose: true } })).toMatchObject({ daemon: { sessionClose: true } });
    expect(() => PhoneServerMessageSchema.parse({ ...snap, daemon: { version: '1', name: 'pc', sessionClose: false } })).toThrow();
    for (const how of ['exit', 'killed']) expect(PhoneServerMessageSchema.parse({ type: 'operation.result', op: OP, status: 'applied', how })).toMatchObject({ how });
    expect(() => PhoneServerMessageSchema.parse({ type: 'operation.result', op: OP, status: 'applied', how: 'crashed' })).toThrow();
  });
  it('a session says when it ended and whether it was started outside Ledge', () => {
    expect(PhoneSessionSchema.parse({ ...session, exitedAt: '2026-10-29T18:42:00.000Z', readOnly: true })).toMatchObject({ exitedAt: '2026-10-29T18:42:00.000Z', readOnly: true });
    expect(() => PhoneSessionSchema.parse({ ...session, readOnly: false })).toThrow();
    expect(() => PhoneSessionSchema.parse({ ...session, exitedAt: 'yesterday' })).toThrow();
  });
});
