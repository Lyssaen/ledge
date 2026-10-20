import { describe, it, expect, vi, afterEach } from 'vitest';
import { PhoneClientMessageSchema, PhoneServerMessageSchema, PhoneSessionSchema, UNTYPABLE, PHONE_PROTOCOL, OperationReasonSchema, SessionSchema, PAD_TIERS, PLAIN_MAX, padPlain } from '../src/index.js';

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
    expect(() => PhoneClientMessageSchema.parse({ type: 'session.reply', op: OP, id: 's1', text: '', expect: null })).toThrow();
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
    expect(() => PhoneServerMessageSchema.parse({ type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: [], capabilities: { claude: caps, codex: caps, cursor: caps }, daemon: { version: '1.0.0' } })).not.toThrow();
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
