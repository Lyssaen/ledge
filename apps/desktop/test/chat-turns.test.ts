import { describe, it, expect } from 'vitest';
import type { ChatTurn } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { answerBlocks, cardKind, cardMark, CHAT_ID, inline, mentionable, newQid, runningTurn, turnLinks } from '../src/chat/turns';

const T = '2026-10-15T09:00:00.000Z';
const turn = (qid: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ qid, question: 'Q', askedAt: T, steps: [], machineId: 'local', machineName: 'Local', ...extra });
const otto = fakeSession('local:otto', { name: 'Otto', machineId: 'local' });
const nova = fakeSession('local:nova', { name: 'Nova', machineId: 'local' });
const remoteOtto = fakeSession('devbox:otto', { name: 'Otto', machineId: 'devbox' });

describe('ids', () => {
  it('the chat is the `ledge` pseudo-machine and every qid is new and short enough for chat.route', () => {
    expect(CHAT_ID).toBe('ledge');
    const ids = new Set(Array.from({ length: 200 }, newQid));
    expect(ids.size).toBe(200);
    for (const id of ids) { expect(id).toMatch(/^q-/); expect(id.length).toBeLessThanOrEqual(100); }
  });
});

describe('runningTurn', () => {
  it('is the turn with neither an answer nor an error', () => {
    expect(runningTurn([turn('a', { answeredAt: T, answer: 'ok' }), turn('b', { error: 'cancelled' })])).toBeNull();
    expect(runningTurn([turn('a', { answeredAt: T }), turn('b')])?.qid).toBe('b');
  });
});

describe('turnLinks', () => {
  it('lists the sessions the answer read, its relay target and the launched one, once each, in order', () => {
    const t = turn('a', {
      answeredAt: T, answer: 'ok',
      steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'local:otto', name: 'Otto' }, { kind: 'git', id: 'local:otto', name: 'Otto' }, { kind: 'reply', id: 'local:nova', name: 'Nova' }, { kind: 'repo', path: 'README.md' }],
      proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', launchedId: 'local:ari' }
    });
    expect(turnLinks(t, [otto, nova])).toEqual([
      { id: 'local:otto', name: 'Otto', live: true },
      { id: 'local:nova', name: 'Nova', live: true },
      { id: 'local:ari', name: 'ari', live: false }
    ]);
  });
  it('a session that left the list stays named but is not live (Review Focus 4)', () => {
    const t = turn('a', { answeredAt: T, relay: { id: 'local:pim', name: 'Pim', tool: 'claude', text: 'Run the tests' } });
    expect(turnLinks(t, [otto])).toEqual([{ id: 'local:pim', name: 'Pim', live: false }]);
  });
  it('the listed name wins over the step name', () => {
    const t = turn('a', { answeredAt: T, steps: [{ kind: 'pane', id: 'local:otto', name: 'Old name' }] });
    expect(turnLinks(t, [otto])[0]!.name).toBe('Otto');
  });
  it('nothing while the turn runs or after an error', () => {
    const steps = [{ kind: 'pane' as const, id: 'local:otto', name: 'Otto' }];
    expect(turnLinks(turn('a', { steps }), [otto])).toEqual([]);
    expect(turnLinks(turn('a', { steps, error: 'Local is offline' }), [otto])).toEqual([]);
  });
});

describe('mentionable', () => {
  it('only the names of the turn machine, only when unique there (Review Focus 4)', () => {
    const twin = fakeSession('local:otto2', { name: 'Otto', machineId: 'local' });
    expect([...mentionable(turn('a'), [otto, nova, remoteOtto])]).toEqual([['Otto', 'local:otto'], ['Nova', 'local:nova']]);
    expect([...mentionable(turn('a', { machineId: 'devbox' }), [otto, nova, remoteOtto])]).toEqual([['Otto', 'devbox:otto']]);
    expect(mentionable(turn('a'), [otto, twin, nova]).has('Otto')).toBe(false);
    expect(mentionable(turn('a', { machineId: undefined }), [otto]).size).toBe(0);
  });
});

describe('inline', () => {
  const names = new Map([['Otto', 'local:otto']]);
  it('bold, code, a known session and a markdown link rendered as its text', () => {
    expect(inline('Ask **Otto** and **Pim** to run `pnpm test`, see [the doc](https://x.y/z).', names)).toEqual([
      { kind: 'text', text: 'Ask ' }, { kind: 'session', id: 'local:otto', name: 'Otto' }, { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'Pim' }, { kind: 'text', text: ' to run ' }, { kind: 'code', text: 'pnpm test' },
      { kind: 'text', text: ', see the doc.' }
    ]);
  });
  it('plain text stays one piece', () => {
    expect(inline('Nothing special', names)).toEqual([{ kind: 'text', text: 'Nothing special' }]);
  });
});

describe('answerBlocks', () => {
  it('paragraphs, lists and headings', () => {
    const blocks = answerBlocks('## Status\nTwo agents:\nall good\n\n- **Otto** waits\n* Nova works\nAfter the list', new Map([['Otto', 'local:otto']]));
    expect(blocks.map(b => b.kind)).toEqual(['h', 'p', 'ul', 'p']);
    expect(blocks[1]).toEqual({ kind: 'p', lines: [[{ kind: 'text', text: 'Two agents:' }], [{ kind: 'text', text: 'all good' }]] });
    expect(blocks[2]).toEqual({ kind: 'ul', items: [[{ kind: 'session', id: 'local:otto', name: 'Otto' }, { kind: 'text', text: ' waits' }], [{ kind: 'text', text: 'Nova works' }]] });
  });
  it('empty text gives no block', () => {
    expect(answerBlocks('\n\n', new Map())).toEqual([]);
  });
});

describe('cards', () => {
  const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const };
  const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
  it('a card shows on an answered turn only, the relay first', () => {
    expect(cardKind(turn('a', { proposal }))).toBeNull();
    expect(cardKind(turn('a', { answeredAt: T, proposal }))).toBe('launch');
    expect(cardKind(turn('a', { answeredAt: T, relay, proposal }))).toBe('relay');
    expect(cardKind(turn('a', { answeredAt: T }))).toBeNull();
  });
  it('the mark changes with the card outcome, not with the steps or the answer', () => {
    const before = turn('a', { answeredAt: T, proposal });
    expect(cardMark({ ...before, steps: [{ kind: 'sessions' }], answer: 'x' })).toBe(cardMark(before));
    expect(cardMark({ ...before, proposal: { ...proposal, launchedId: 'local:ari' } })).not.toBe(cardMark(before));
    expect(cardMark({ ...before, proposal: { ...proposal, error: 'no such folder' } })).not.toBe(cardMark(before));
    expect(cardMark({ ...before, relay: { ...relay, status: 'queued' } })).not.toBe(cardMark(before));
  });
});
