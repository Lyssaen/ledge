import { describe, it, expect } from 'vitest';
import type { ChatAction, ChatTurn } from '@ledge/protocol';
import { cardClosed, cardPlan, firstRow, moveRow } from '../src/tui/model/actionCard.js';
import { chatView, openCards } from '../src/tui/model/chat.js';
import { clock } from '../src/tui/model/time.js';
import { fr } from '../src/tui/i18n/fr.js';
import { glyphsFor } from '../src/tui/glyphs.js';

// The generic card in the TUI (#94, docs/mockups/ledge-action-card.html, view TUI): what the box draws comes from here.
const AT = '2026-10-26T10:42:00.000Z';
const row = (action: string, extra: Partial<ChatAction> = {}): ChatAction =>
  ({ action, args: {}, summary: action, risk: 'reversible', ...extra });
const archive = (name: string, extra: Partial<ChatAction> = {}) => row('session.archive', { vars: { session: name }, ...extra });
const decide = (extra: Partial<ChatAction> = {}) => row('session.decide', { risk: 'destructive', detail: 'rm -rf dist', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, ...extra });

describe('the action card as the TUI plans it', () => {
  it('a plan not started: every row open, « all » applies them all', () => {
    const p = cardPlan([archive('Otto'), archive('Bix'), row('team.dissolve', { risk: 'destructive', vars: { team: 'api' } })]);
    expect(p.shown).toEqual(['proposed', 'proposed', 'proposed']);
    expect(p.open).toEqual([0, 1, 2]);
    expect(p.all).toEqual({ kind: 'all', rows: [0, 1, 2], k: 0 });
  });
  it('after a failure the plan resumes at that step; after a refusal it goes on without it; the rows after are held', () => {
    const failed = cardPlan([archive('Otto', { state: 'done', doneAt: AT }), archive('Bix', { state: 'failed', code: 'failed' }), archive('Ari')]);
    expect(failed.shown).toEqual(['done', 'failed', 'held']);
    expect(failed.all).toEqual({ kind: 'resume', rows: [1, 2], k: 2 });
    const refused = cardPlan([archive('Otto', { state: 'done' }), archive('Bix', { state: 'refused', code: 'exited' }), archive('Ari')]);
    expect(refused.all).toEqual({ kind: 'skip', rows: [2], k: 2 });
  });
  it('a request that changed is stale, one shown cut is not accepted: neither is among the rows « all » applies', () => {
    const p = cardPlan([decide({ state: 'refused', code: 'changed' }), decide({ detailCut: true })]);
    expect(p.shown).toEqual(['stale', 'cut']);
    expect(p.open).toEqual([]);
  });
  it('the plan stops at a request that changed; another action\'s « changed » is a refusal, not a stale request (codes.md)', () => {
    const stale = cardPlan([archive('Otto', { state: 'done' }), decide({ state: 'refused', code: 'changed' }), archive('Ari')]);
    expect(stale.shown).toEqual(['done', 'stale', 'held']);
    expect(stale.all).toEqual({ kind: 'skip', rows: [2], k: 2 });
    const save = cardPlan([archive('Otto', { state: 'done' }), row('team.save', { vars: { team: 'api' }, state: 'refused', code: 'changed' }), archive('Ari')]);
    expect(save.shown).toEqual(['done', 'refused', 'held']);
    expect(save.rows[1]).toMatchObject({ state: 'refused', code: 'changed' });
    expect(save.all).toEqual({ kind: 'skip', rows: [2], k: 2 });
  });
  it('is closed once every row is applied or its request denied', () => {
    expect(cardClosed([archive('Otto', { state: 'done' }), decide({ state: 'denied' })])).toBe(true);
    expect(cardClosed([archive('Otto', { state: 'done' }), archive('Bix', { state: 'failed' })])).toBe(false);
    expect(cardClosed([decide({ state: 'refused', code: 'changed' })])).toBe(false);
  });
  it('the selection starts on the first row to act on and moves over the rows not settled', () => {
    const p = cardPlan([archive('Otto', { state: 'done' }), archive('Bix', { state: 'failed' }), archive('Ari'), decide({ state: 'denied' })]);
    expect(firstRow(p)).toBe(1);
    expect(moveRow(p, 1, 1)).toBe(2);
    expect(moveRow(p, 2, 1)).toBe(2);
    expect(moveRow(p, 1, -1)).toBe(1);
  });
});

describe('the conversation and the cards of a turn with an action card', () => {
  const g = glyphsFor({});
  const turn = (extra: Partial<ChatTurn>): ChatTurn => ({ qid: 'q1', question: 'Range Otto', askedAt: AT, answeredAt: AT, answer: 'Oui.', steps: [], ...extra });
  const text = (t: ChatTurn) => chatView([t], null, { t: fr, g, width: 100 }).lines.map(l => l.map(s => s.text).join(''));

  it('gives the turn an action card while a row is left to do', () => {
    expect(openCards([turn({ actions: [archive('Otto')] })])).toEqual([{ kind: 'action', qid: 'q1' }]);
    expect(openCards([turn({ actions: [archive('Otto', { state: 'failed' })] })])).toEqual([{ kind: 'action', qid: 'q1' }]);
    expect(openCards([turn({ actions: [archive('Otto', { state: 'done', doneAt: AT })] })])).toEqual([]);
  });
  it('an ignored turn has no card at all, and says so in the conversation, with the key that opens it again', () => {
    const ignored = turn({ ignoredAt: AT, actions: [archive('Otto'), archive('Bix')], proposals: [{ cwd: '/w/a', project: 'a', tool: 'claude' }] });
    expect(openCards([ignored])).toEqual([]);
    expect(text(ignored)).toContain(`  · plan de 2 actions ignoré à ${clock(AT)}, rien n’a été envoyé · revoir : ctrl+r`);
    expect(text(turn({ ignoredAt: AT, actions: [archive('Otto')] }))).toContain(`  · carte ignorée à ${clock(AT)}, rien n’a été envoyé · revoir : ctrl+r`);
  });
  it('a plan ignored once begun says what went and that the rest is ignored, not that nothing was sent', () => {
    const begun = text(turn({ ignoredAt: AT, actions: [archive('Otto', { state: 'done', doneAt: AT }), archive('Bix'), archive('Ari')] }));
    expect(begun).toContain(`  · plan de 3 actions : 1 appliquée, le reste ignoré à ${clock(AT)} · revoir : ctrl+r`);
    expect(begun).not.toContain('rien n’a été envoyé');
    const both = text(turn({ ignoredAt: AT, actions: [archive('Otto', { state: 'done' }), archive('Bix', { state: 'done' }), decide({ state: 'denied', doneAt: AT }), archive('Ari')] }));
    expect(both).toContain(`  · plan de 4 actions : 2 appliquées, 1 refus envoyé, le reste ignoré à ${clock(AT)} · revoir : ctrl+r`);
  });
  it('once applied, the box goes and a line stays: the plan, or the row', () => {
    expect(text(turn({ actions: [archive('Otto', { state: 'done', doneAt: AT }), archive('Bix', { state: 'done', doneAt: AT })] }))).toContain(`  ✓ Plan appliqué à ${clock(AT)}`);
    expect(text(turn({ actions: [archive('Otto', { state: 'done', doneAt: AT })] }))).toContain(`  ✓ Archiver Otto · ${clock(AT)}`);
  });
  it('a denied request leaves its line and the request, faded', () => {
    const lines = text(turn({ actions: [decide({ state: 'denied', doneAt: AT })] }));
    expect(lines).toContain(`  ✓ Refus envoyé à Nova · ${clock(AT)} : la commande n’a pas été lancée`);
    expect(lines).toContain('    rm -rf dist');
  });
});
