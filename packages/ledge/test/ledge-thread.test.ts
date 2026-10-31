import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Exchange, LedgeThreadItem } from '@ledge/protocol';
import { createLedgeThread, type LedgeThread } from '../src/daemon/ledgeThread.js';

let path: string;
let n: number;
const uuid = () => `g${++n}`;
const open = (): LedgeThread => createLedgeThread({ path, uuid, now: () => '2026-10-30T16:00:00.000Z' });
const at = (hm: string) => `2026-10-30T${hm}:00.000Z`;
const ex = (id: string, hm: string, rigId = 'factory', extra: Partial<Exchange> = {}): Exchange =>
  ({ id, machine: 'local', rigId, from: 'a@x', to: 'b@x', kind: 'message', text: id, at: at(hm), ...extra });
const user = (id: string, text = id): LedgeThreadItem => ({ kind: 'user', id, at: at('16:00'), text });

beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'ledge-thread-')), 'ledge-thread.jsonl'); n = 0; });

describe('ledge thread store', () => {
  it('items survive a restart, last line of an id wins', async () => {
    const t = open();
    t.append({ kind: 'ledge', id: 'l1', text: 'a', pending: true });
    t.upsert({ kind: 'ledge', id: 'l1', at: at('16:00'), text: 'b' });
    await t.flush();
    const r = open();
    expect((r.get('l1') as { text: string }).text).toBe('b');
    expect(r.page().items.length).toBe(1);
  });

  it('page returns the latest 50 then the older ones', async () => {
    const t = open();
    for (let i = 1; i <= 120; i++) t.append({ kind: 'user', id: `u${i}`, text: String(i) });
    const p1 = t.page();
    expect(p1.items.length).toBe(50);
    expect(p1.items[0]!.id).toBe('u71');
    expect(p1.items[49]!.id).toBe('u120');
    expect(p1.before).toBe('u71');
    const p2 = t.page(p1.before);
    expect(p2.items.length).toBe(50);
    expect(p2.items[0]!.id).toBe('u21');
    expect(p2.before).toBe('u21');
    const p3 = t.page(p2.before);
    expect(p3.items.length).toBe(20);
    expect(p3.before).toBeUndefined();
  });

  it('exchanges of one rig within 10 min share a group', () => {
    const t = open();
    t.exchange(ex('e1', '16:36')); t.exchange(ex('e2', '16:40')); const g = t.exchange(ex('e3', '16:42'))!;
    expect(t.page().items.length).toBe(1);
    expect(g).toMatchObject({ kind: 'exchanges', from: at('16:36'), to: at('16:42'), exchangeIds: ['e1', 'e2', 'e3'] });
  });

  it('a gap over 10 min, or a ledge bubble in between, starts a new group', () => {
    const a = open();
    a.exchange(ex('e1', '16:36')); a.exchange(ex('e2', '16:47'));
    expect(a.page().items.length).toBe(2);
    path += '.2';
    const b = open();
    b.exchange(ex('e1', '16:36')); b.append({ kind: 'ledge', text: 'hm' }); b.exchange(ex('e2', '16:37'));
    expect(b.page().items.map(i => i.kind)).toEqual(['exchanges', 'ledge', 'exchanges']);
  });

  it('two rigs interleaved keep their own groups', () => {
    const t = open();
    t.exchange(ex('e1', '16:36', 'factory')); t.exchange(ex('e2', '16:37', 'starter')); t.exchange(ex('e3', '16:38', 'factory'));
    const groups = t.page().items as Extract<LedgeThreadItem, { kind: 'exchanges' }>[];
    expect(groups.find(g => g.rigId === 'factory')!.exchangeIds).toEqual(['e1', 'e3']);
    expect(groups.find(g => g.rigId === 'starter')!.exchangeIds).toEqual(['e2']);
  });

  it('an exchange of kind ledge is not grouped', () => {
    const t = open();
    expect(t.exchange(ex('e1', '16:36', 'factory', { kind: 'ledge' }))).toBeNull();
    expect(t.page().items.length).toBe(0);
  });

  it('a repeated exchange id does not grow the group twice', () => {
    const t = open();
    t.exchange(ex('e1', '16:36')); const g = t.exchange(ex('e1', '16:37'))!;
    expect((g as { exchangeIds: string[] }).exchangeIds).toEqual(['e1']);
  });

  it('a group keeps growing after a restart, until another kind comes in', async () => {
    const t = open();
    t.exchange(ex('e1', '16:36')); await t.flush();
    const r = open();
    r.exchange(ex('e2', '16:38'));
    expect(r.page().items.length).toBe(1);
    r.append({ kind: 'user', text: 'x' }); await r.flush();
    const s = open();
    s.exchange(ex('e3', '16:39'));
    expect(s.page().items.length).toBe(3);
  });

  it('a torn last line is skipped and the next append starts clean', async () => {
    writeFileSync(path, `${JSON.stringify(user('u1'))}\n{"kind":"user","id":"u2"`);
    const t = open();
    expect(t.page().items.length).toBe(1);
    t.append(user('u3')); await t.flush();
    expect(open().page().items.map(i => i.id)).toEqual(['u1', 'u3']);
  });

  it('a garbage line in the middle is skipped, the rest is intact', async () => {
    writeFileSync(path, `${JSON.stringify(user('u1'))}\nnot json\n{"kind":"nope","id":"z"}\n${JSON.stringify(user('u2'))}\n`);
    expect(open().page().items.map(i => i.id)).toEqual(['u1', 'u2']);
  });

  it('compacts at load when lines outnumber ids twice, and keeps escalations known', async () => {
    const t = open();
    t.append({ kind: 'escalation', id: 'x1', escalationId: 'esc-1' });
    t.append({ kind: 'ledge', id: 'l1', text: '0', pending: true });
    for (let i = 1; i <= 6; i++) t.upsert({ kind: 'ledge', id: 'l1', at: at('16:00'), text: String(i) });
    await t.flush();
    expect(readFileSync(path, 'utf8').trim().split('\n').length).toBe(8);
    const r = open();
    expect(readFileSync(path, 'utf8').trim().split('\n').length).toBe(2);
    expect(r.hasEscalation('esc-1')).toBe(true);
    expect((r.get('l1') as { text: string }).text).toBe('6');
    expect(open().page().items.map(i => i.id)).toEqual(['x1', 'l1']);
  });

  it('hasEscalation is true once an escalation item exists', () => {
    const t = open();
    expect(t.hasEscalation('esc-1')).toBe(false);
    t.append({ kind: 'escalation', escalationId: 'esc-1' });
    expect(t.hasEscalation('esc-1')).toBe(true);
  });

  it('onItem hears appends, upserts and grown groups, and can be unsubscribed', () => {
    const t = open();
    const seen: string[] = [];
    const off = t.onItem(i => seen.push(i.kind));
    t.append({ kind: 'user', text: 'a' }); t.exchange(ex('e1', '16:36')); t.exchange(ex('e2', '16:37'));
    off(); t.append({ kind: 'user', text: 'b' });
    expect(seen).toEqual(['user', 'exchanges', 'exchanges']);
  });
});
