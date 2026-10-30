import { describe, it, expect } from 'vitest';
import { AskIdSchema, ClientMessageSchema, ServerMessageSchema, askShown } from '../src/index.js';

describe('asks', () => {
  it('AskIdSchema takes a + 6 hex only', () => {
    expect(AskIdSchema.safeParse('a1b2c3d4').success).toBe(false);
    expect(AskIdSchema.safeParse('a1b2c').success).toBe(false);
    expect(AskIdSchema.safeParse('a1b2c3d').success).toBe(true);
    expect(AskIdSchema.safeParse('t1b2c3').success).toBe(false);
  });
  it('ask.create and ask.answer are client messages, asks / ask.updated / ask.result server messages', () => {
    expect(ClientMessageSchema.safeParse({ type: 'ask.answer', rid: 'r', id: 'a1b2c3d', text: 'B' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'ask.answer', rid: 'r', id: 'a1b2c3d', text: '  ' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'ask.create', rid: 'r', by: 's1', question: 'Q ?', options: 'A, B' }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'ask.result', rid: 'r', code: 'closed', reason: 'déjà répondue' }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'asks', asks: [] }).success).toBe(true);
  });
  it('only an open ask is shown', () => {
    expect(['open', 'answered', 'dropped'].map(state => askShown({ state: state as 'open' }))).toEqual([true, false, false]);
  });
});
