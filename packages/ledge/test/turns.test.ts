import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPLY_MAX, TurnSchema, type Session, type SessionEvent, type ThreadItem } from '@ledge/protocol';
import { History, fileOf } from '../src/daemon/history.js';
import { lastReplyAt, phoneTurns, resolvedBy, TURNS_MAX } from '../src/daemon/turns.js';

const T0 = '2026-10-14T18:00:00.000Z';
const later = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}, s = 0): SessionEvent => ({ name, at: later(s), source: 'hook', ...extra });
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's1', name: 's1', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: null, state: 'idle', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
const waiting = session({ state: 'waiting_permission', pending: { id: 'p1', version: 1, kind: 'permission', text: 'rm', source: 'hook' } });

let dir: string;
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'ledge-turns-')), 'history'); });

describe('resolvedBy', () => {
  it('a request that leaves on anything but a decision of Ledge is resolved in the terminal', () => {
    expect(resolvedBy(ev('PostToolUse', { tool: 'Bash' }), waiting, session({ state: 'working' }))).toEqual({ note: 'resolved', source: 'pc', pendingId: 'p1' });
    expect(resolvedBy(ev('Notification'), session(), session())).toBeNull();
  });
  it('a Decided event, the end of the session or of its pane is not', () => {
    expect(resolvedBy(ev('Decided', { source: 'daemon' }), waiting, session({ state: 'working' }))).toBeNull();
    expect(resolvedBy(ev('SessionEnd'), waiting, session({ state: 'exited' }))).toBeNull();
    expect(resolvedBy(ev('PaneGone', { source: 'daemon' }), waiting, session({ state: 'exited' }))).toBeNull();
  });
});

describe('phoneTurns: the phone reads the shared thread', () => {
  it('maps prompts, replies, decisions and notes in thread order, and nothing else', () => {
    const h = new History({ dir });
    h.record('s', ev('UserPromptSubmit', { text: 'Lance les tests' }), { source: 'phone' });
    h.record('s', ev('PreToolUse', { tool: 'Bash', text: 'Bash · rm -rf x', toolUseId: 't1', toolInput: { command: 'rm -rf x' } }, 1));
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'rm -rf x' }, 2));
    h.note('s', { note: 'decision', decision: 'accept', source: 'phone', pendingId: 'p1' }, later(3));
    h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: 't1', output: 'secret output' }, 4));
    h.record('s', ev('SubagentStart', { helperId: 'h1', text: 'explore' }, 5));
    h.record('s', ev('Stop', { text: 'Fini.' }, 6));
    h.note('s', { note: 'interrupt', source: 'pc' }, later(7));
    const turns = phoneTurns(h.items('s'));
    expect(turns.map(t => t.kind)).toEqual(['prompt', 'decision', 'reply', 'interrupt']);
    expect(turns[0]).toMatchObject({ id: 'prompt-1', text: 'Lance les tests', source: 'phone' });
    expect(turns[1]).toMatchObject({ decision: 'accept', source: 'phone', pendingId: 'p1' });
    expect(JSON.stringify(turns)).not.toContain('secret output');
    for (const t of turns) expect(TurnSchema.safeParse(t).success).toBe(true);
  });
  it('a decision with no permission row of this turn is a note, never an older row', () => {
    const h = new History({ dir });
    h.record('s', ev('UserPromptSubmit', { text: 'one' }));
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'ls' }, 1));
    h.record('s', ev('Decided', { source: 'daemon' }, 2)); // old row seen to vanish: unknown
    h.record('s', ev('UserPromptSubmit', { text: 'two' }, 3));
    h.note('s', { note: 'decision', decision: 'deny', source: 'pc', pendingId: 'p9' }, later(4));
    expect(h.items('s').find(i => i.kind === 'permission')).toMatchObject({ decision: 'unknown' });
    expect(phoneTurns(h.items('s')).map(t => `${t.kind}:${t.decision ?? ''}`)).toEqual(['prompt:', 'resolved:', 'prompt:', 'decision:deny']);
  });
  it('an open permission is not a turn; a helper report is not the session reply', () => {
    const items: ThreadItem[] = [
      { kind: 'permission', id: 'perm-1', at: T0, turn: 1, tool: 'Bash', text: 'ls' },
      { kind: 'reply', id: 'report-h', at: later(1), turn: 1, helperId: 'h', text: 'report' }
    ];
    expect(phoneTurns(items)).toEqual([]);
    expect(lastReplyAt(items)).toBeUndefined();
    expect(lastReplyAt([...items, { kind: 'reply', id: 'reply-1', at: later(2), turn: 1, text: 'ok' }])).toBe(later(2));
  });
  it('caps the text and the count it sends', () => {
    const items: ThreadItem[] = Array.from({ length: TURNS_MAX + 20 }, (_, i) => ({ kind: 'prompt', id: `prompt-${i}`, at: later(i), turn: i, text: 'x'.repeat(REPLY_MAX + 100) }));
    const turns = phoneTurns(items);
    expect(turns).toHaveLength(TURNS_MAX);
    expect(turns[0]!.id).toBe('prompt-20');
    expect(TurnSchema.safeParse(turns[0]).success).toBe(true);
  });
});

describe('History: what the phone adds to it', () => {
  it('a decision through Ledge lands on the open permission row with its source, and survives a restart', async () => {
    const h = new History({ dir });
    h.record('s', ev('UserPromptSubmit', { text: 'go' }));
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'ls' }, 1));
    h.tagPending('s', 'p1', 'Bash', 'ls');
    h.note('s', { note: 'decision', decision: 'accept', source: 'phone', pendingId: 'p1' }, later(2));
    h.note('s', { note: 'answer', text: 'Oui', source: 'pc', pendingId: 'p2' }, later(3));
    await h.flush();
    const again = new History({ dir }); await again.load();
    expect(again.items('s').map(i => i.kind)).toEqual(['prompt', 'permission', 'note']);
    expect(again.items('s')[1]).toMatchObject({ decision: 'accept', source: 'phone', pendingId: 'p1' });
    expect(phoneTurns(again.items('s')).map(t => t.kind)).toEqual(['prompt', 'decision', 'answer']);
  });
  it('a request settled in the terminal closes its own row; a later decision on another request never takes it', () => {
    const h = new History({ dir });
    h.record('s', ev('UserPromptSubmit', { text: 'go' }));
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'ls' }, 1));
    h.tagPending('s', 'p1', 'Bash', 'ls');
    h.note('s', { note: 'resolved', source: 'pc', pendingId: 'p1' }, later(2));
    expect(h.items('s')[1]).toMatchObject({ kind: 'permission', decision: 'unknown', pendingId: 'p1' });
    // The phone accepts a plan (no row of its own): Decided with that request pending, then the decision.
    const plan = { id: 'p2', version: 1, kind: 'plan' as const, text: 'Plan', source: 'hook' as const };
    h.record('s', ev('Decided', { source: 'daemon' }, 3), { pending: plan });
    h.note('s', { note: 'decision', decision: 'accept', source: 'phone', pendingId: 'p2' }, later(4));
    expect(h.items('s')[1]).toMatchObject({ decision: 'unknown', pendingId: 'p1' });
    expect(phoneTurns(h.items('s')).map(t => [t.kind, t.pendingId, t.decision ?? ''])).toEqual([['prompt', undefined, ''], ['resolved', 'p1', ''], ['decision', 'p2', 'accept']]);
  });
  it('a Decided with nothing pending (an instruction typed into an idle agent) touches no row', () => {
    const h = new History({ dir });
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'ls' }));
    h.record('s', ev('Decided', { source: 'daemon' }, 1), { pending: null });
    expect(h.items('s')[0]).toMatchObject({ kind: 'permission' });
    expect((h.items('s')[0] as { decision?: string }).decision).toBeUndefined();
  });
  it('an id with a slash never escapes the history folder, and is read back under its id', async () => {
    const h = new History({ dir });
    for (const id of ['../../x', '..', '.', 'a/b']) h.record(id, ev('UserPromptSubmit', { text: 'hi' }));
    await h.flush();
    const names = readdirSync(dir);
    expect(names).toHaveLength(4);
    for (const n of names) expect(n.startsWith('~')).toBe(true);
    expect(existsSync(join(dir, '..', '..', 'x.jsonl'))).toBe(false);
    const again = new History({ dir }); await again.load();
    expect(again.ids().sort()).toEqual(['.', '..', '../../x', 'a/b']);
    again.forget('../../x'); await again.flush();
    expect(readdirSync(dir)).toHaveLength(3);
  });
  it('a plain id keeps the file name earlier daemons wrote', () => {
    expect(fileOf('c0ffee-12_ab.cd')).toBe('c0ffee-12_ab.cd.jsonl');
  });
  it('reads a journal an earlier daemon wrote, and keeps the folder private (0700) and new files 0600', async () => {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    writeFileSync(join(dir, 'old.jsonl'), JSON.stringify({ kind: 'prompt', id: 'prompt-1', at: T0, turn: 1, text: 'x' }) + '\n');
    const h = new History({ dir }); await h.load();
    expect(h.items('old')).toHaveLength(1);
    h.record('new', ev('UserPromptSubmit', { text: 'y' })); await h.flush();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'new.jsonl')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'old.jsonl'), 'utf8')).toContain('"prompt-1"');
  });
});
