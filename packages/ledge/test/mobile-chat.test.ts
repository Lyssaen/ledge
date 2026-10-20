import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CHAT_HISTORY_BUDGET, PhoneChatTurnSchema, PhoneServerMessageSchema, THREAD_TEXT_MAX, type ChatTurn, type PhoneServerMessage } from '@ledge/protocol';
import { toPhoneHistory, toPhoneTurn, phoneEmitter } from '../src/mobile/chat.js';
import { createOutbox } from '../src/mobile/outbox.js';
import { ONE_AT_A_TIME, TOO_MANY } from '../src/chat/service.js';

const AT = '2026-10-20T08:00:00.000Z';
const turn = (extra: Partial<ChatTurn> = {}): ChatTurn => ({ qid: randomUUID(), question: 'what?', askedAt: AT, steps: [], ...extra });

describe('toPhoneTurn', () => {
  it('carries no path, folder, machine or project proposal', () => {
    const t = turn({
      steps: [{ kind: 'git', path: '/home/gch/secret', id: 'a', name: 'n' }, { kind: 'repo', path: '/etc/x' }],
      proposals: [{ cwd: '/home/gch/secret/repo', project: 'repo', prompt: 'do it', tool: 'claude' }],
      projectProposal: { name: 'p', repos: [{ path: '/home/gch/secret/p', why: 'because' }] },
      machineId: 'm1', machineName: 'PC', choices: [{ id: 'm1', label: 'PC' }],
      relay: { id: 's', name: 'sess', tool: 'claude', text: 'go' }
    });
    const p = toPhoneTurn(t);
    expect(JSON.stringify(p)).not.toMatch(/secret|\/etc|machine|choices|projectProposal|"cwd"|"path"/);
    expect(PhoneChatTurnSchema.safeParse(p).success).toBe(true);
    expect(p.steps).toEqual([{ kind: 'git', id: 'a', name: 'n' }, { kind: 'repo' }]);
  });

  it('cuts an answer to 8192 with cut: true', () => {
    const p = toPhoneTurn(turn({ answer: 'x'.repeat(20_000) }));
    expect(p.answer).toHaveLength(THREAD_TEXT_MAX);
    expect(p.cut).toBe(true);
    expect(toPhoneTurn(turn({ answer: 'short' }))).not.toHaveProperty('cut');
  });

  it('never cuts a card: a long instruction or prompt is not projected', () => {
    const long = toPhoneTurn(turn({
      relay: { id: 's', name: 'n', tool: 'claude', text: 'y'.repeat(3_000) },
      proposals: [{ cwd: '/w', project: 'p', prompt: 'z'.repeat(3_000), tool: 'claude' }, { cwd: '/w', project: 'q', prompt: 'ok', tool: 'codex' }]
    }));
    expect(long).not.toHaveProperty('relay');
    expect(long).not.toHaveProperty('proposals');
    const fits = toPhoneTurn(turn({ proposals: [{ cwd: '/w', project: 'a', prompt: 'z'.repeat(2_048), tool: 'claude' }, { cwd: '/w', project: 'b', tool: 'codex' }] }));
    expect(fits.proposals?.map(p => p.project)).toEqual(['a', 'b']);
    expect(toPhoneTurn(turn({ relay: { id: 's', name: 'n', tool: 'claude', text: 'y'.repeat(2_048) } })).relay?.text).toHaveLength(2_048);
  });

  it('turns an error into a code and keeps launch state', () => {
    const code = (error: string) => toPhoneTurn(turn({ error })).error;
    expect(code(ONE_AT_A_TIME)).toBe('busy');
    expect(code(TOO_MANY)).toBe('busy');
    expect(code('cancelled')).toBe('cancelled');
    expect(code('Claude Code did not answer within 3 minutes')).toBe('timeout');
    expect(code('Claude Code exited with code 1: /home/gch/secret')).toBe('failed');
    const p = toPhoneTurn(turn({ proposals: [{ cwd: '/w', project: 'p', tool: 'claude', launchedId: 'L', error: 'boom /w' }, { cwd: '/w', project: 'q', tool: 'claude' }] }));
    expect(p.proposals).toEqual([{ project: 'p', tool: 'claude', launchedId: 'L', failed: true }, { project: 'q', tool: 'claude' }]);
    expect(JSON.stringify(p)).not.toMatch(/boom/);
  });
});

describe('toPhoneHistory', () => {
  it('keeps the most recent turns that fit the budget', () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn({ question: `q${i}`, answer: 'a'.repeat(30_000) }));
    const h = toPhoneHistory(turns);
    expect(h.length).toBeLessThan(50);
    expect(h.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify({ type: 'chat.history', turns: h }))).toBeLessThanOrEqual(CHAT_HISTORY_BUDGET);
    expect(h.at(-1)!.question).toBe('q49');
    expect(h.map(t => t.question)).toEqual(turns.slice(50 - h.length).map(t => t.question));
  });

  it('keeps only the last 50 turns', () => {
    expect(toPhoneHistory(Array.from({ length: 60 }, () => turn()))).toHaveLength(50);
  });
});

describe('phoneEmitter', () => {
  const rig = (turns: ChatTurn[] = []) => {
    const sent: Array<[PhoneServerMessage, string | undefined]> = [];
    const ends: unknown[] = [];
    const clock = { t: 0 };
    const emit = phoneEmitter((m, k) => { sent.push([m, k]); }, { history: () => turns }, { now: () => clock.t, onEnd: e => ends.push(e) });
    return { emit, sent, ends, clock, types: () => sent.map(([m]) => m.type) };
  };

  it('coalesces deltas into whole texts, keyed per question', () => {
    const t = turn({ answer: 'abcdefghij' });
    const r = rig([t]);
    for (let i = 0; i < 10; i++) { r.emit({ type: 'chat.delta', qid: t.qid, text: String.fromCharCode(97 + i) }); r.clock.t += 10; }
    expect(r.types()).toEqual(['chat.delta']);
    r.emit({ type: 'chat.done', qid: t.qid, text: 'abcdefghij', at: AT });
    expect(r.types()).toEqual(['chat.delta', 'chat.delta', 'chat.done']);
    expect(r.sent[1]![0]).toMatchObject({ type: 'chat.delta', text: 'abcdefghij' });
    expect(r.sent[1]![1]).toBe(`chat.live:${t.qid}`);
    expect(r.sent[2]![0]).toMatchObject({ type: 'chat.done', turn: { qid: t.qid, answer: 'abcdefghij' } });
    expect(r.ends).toEqual([{ qid: t.qid }]);
    r.clock.t += 1_000;
    expect(PhoneServerMessageSchema.safeParse(r.sent[2]![0]).success).toBe(true);
  });

  it('sends the whole text again once 250 ms have passed', () => {
    const r = rig();
    r.emit({ type: 'chat.delta', qid: 'q', text: 'a' });
    r.clock.t = 250;
    r.emit({ type: 'chat.delta', qid: 'q', text: 'b' });
    expect(r.sent.map(([m]) => m.type === 'chat.delta' && m.text)).toEqual(['a', 'ab']);
  });

  it('ends with chat.error failed when the turn is gone from the history, and ignores a late delta', () => {
    const r = rig([]);
    r.emit({ type: 'chat.delta', qid: 'q', text: 'a' });
    r.emit({ type: 'chat.done', qid: 'q', text: 'a', at: AT });
    expect(r.sent.at(-1)![0]).toEqual({ type: 'chat.error', qid: 'q', code: 'failed' });
    expect(r.ends).toEqual([{ qid: 'q' }]);
    const n = r.sent.length;
    r.clock.t += 1_000;
    r.emit({ type: 'chat.delta', qid: 'q', text: 'late' });
    r.emit({ type: 'chat.error', qid: 'e', message: 'x' });
    r.emit({ type: 'chat.delta', qid: 'e', text: 'late' });
    expect(r.sent.length).toBe(n + 1);
  });

  it('sends a code for an error, then ends once, with the code', () => {
    const r = rig();
    r.emit({ type: 'chat.error', qid: 'q', message: TOO_MANY });
    expect(r.sent[0]![0]).toEqual({ type: 'chat.error', qid: 'q', code: 'busy' });
    expect(r.ends).toEqual([{ qid: 'q', code: 'busy' }]);
  });

  it('projects history and steps, and a turn named by another message becomes chat.done', () => {
    const t = turn({ steps: [{ kind: 'repo', path: '/x' }] });
    const r = rig([t]);
    r.emit({ type: 'chat.history', turns: [t] });
    r.emit({ type: 'chat.step', qid: t.qid, step: { kind: 'repo', path: '/x', name: 'f' } });
    r.emit({ type: 'chat.relay', qid: t.qid } as never);
    expect(r.types()).toEqual(['chat.history', 'chat.step', 'chat.done']);
    expect(JSON.stringify(r.sent)).not.toContain('/x');
  });

  it('180 s of deltas four times a second never overflow the outbox', async () => {
    const t = turn({ answer: 'x'.repeat(8_192) });
    let overflowed = 0;
    const clock = { t: 0 };
    const out = createOutbox({ send: async () => true, onGone: () => {}, onOverflow: () => { overflowed++; }, log: () => {}, now: () => clock.t });
    const emit = phoneEmitter((m, k) => out.push('d', m, k), { history: () => [t] }, { now: () => clock.t });
    for (let i = 0; i < 720; i++) {
      emit({ type: 'chat.delta', qid: t.qid, text: 'x'.repeat(12) });
      clock.t += 250;
      await new Promise(r => setImmediate(r));
    }
    emit({ type: 'chat.done', qid: t.qid, text: '', at: AT });
    await out.flush('d');
    expect(overflowed).toBe(0);
    out.close();
  });
});
