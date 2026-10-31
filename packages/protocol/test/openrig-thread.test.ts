import { describe, it, expect } from 'vitest';
import { LedgeThreadItemSchema, ClientMessageSchema, RIG_RESULT_CODES, MANDATE_CATEGORY_LABEL, MandateCategorySchema, EXCHANGE_GROUP_MS, THREAD_PAGE } from '../src/index.js';

const AT = '2026-10-31T10:00:00.000Z';

describe('ledge thread additions (lot 4)', () => {
  it('a ledge item may name its chat turn', () => {
    expect(LedgeThreadItemSchema.parse({ kind: 'ledge', id: 'l1', at: AT, text: 'Bonjour', qid: 'q-1' })).toMatchObject({ qid: 'q-1' });
  });
  it('a user item may name its chat turn', () => {
    expect(LedgeThreadItemSchema.parse({ kind: 'user', id: 'u1', at: AT, text: 'salut', qid: 'q-1' })).toMatchObject({ qid: 'q-1' });
  });
  it('a ledge bubble may be pending, never false', () => {
    expect(LedgeThreadItemSchema.parse({ kind: 'ledge', id: 'l1', at: AT, text: '', pending: true })).toMatchObject({ pending: true });
    expect(LedgeThreadItemSchema.safeParse({ kind: 'ledge', id: 'l1', at: AT, text: '', pending: false }).success).toBe(false);
  });
  it('qid and pending stay optional', () => {
    expect(LedgeThreadItemSchema.safeParse({ kind: 'ledge', id: 'l1', at: AT, text: 'x' }).success).toBe(true);
    expect(LedgeThreadItemSchema.safeParse({ kind: 'user', id: 'u1', at: AT, text: 'x' }).success).toBe(true);
  });
  it('ledge.say may be about an escalation', () => {
    expect(ClientMessageSchema.parse({ type: 'ledge.say', rid: 'r', text: 'pourquoi ?', about: 'qi-7' })).toMatchObject({ about: 'qi-7' });
    expect(ClientMessageSchema.parse({ type: 'ledge.say', rid: 'r', text: 'x' })).not.toHaveProperty('about');
  });
  it('invalid is a rig result code', () => { expect(RIG_RESULT_CODES).toContain('invalid'); });
  it('every category has a French and an English label', () => {
    expect(MANDATE_CATEGORY_LABEL.git.fr).toBe('Git et branches');
    expect(MANDATE_CATEGORY_LABEL.critical.fr).toBe('Critique');
    expect(MANDATE_CATEGORY_LABEL.git.en).toBe('Git and branches');
    for (const c of MandateCategorySchema.options) {
      expect(MANDATE_CATEGORY_LABEL[c].fr).not.toBe('');
      expect(MANDATE_CATEGORY_LABEL[c].en).not.toBe('');
    }
  });
  it('thread constants', () => {
    expect(EXCHANGE_GROUP_MS).toBe(600_000);
    expect(THREAD_PAGE).toBe(50);
  });
});
