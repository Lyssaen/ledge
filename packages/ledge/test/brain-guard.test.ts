import { describe, expect, it } from 'vitest';
import type { Escalation } from '@ledge/protocol';
import { criticalIn, guardDecide, validAnswers } from '../src/daemon/brain/guard.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';

const esc = (over: Partial<Escalation> = {}): Escalation => ({ id: 'q1', source: 'rig', machine: 'local', from: 'dev@rig', intent: 'decision', summary: 'Merger la branche', questions: [
  { id: 'q1', question: 'Que faire ?', options: [{ id: 'merge', label: 'Merge' }, { id: 'wait', label: 'Attendre' }] }], createdAt: '2026-10-31T10:00:00.000Z', state: 'pending', ...over });
const options = (labels: string[]): Escalation['questions'] => [{ id: 'q1', question: 'Que faire ?', options: labels.map((label, i) => ({ id: String.fromCharCode(97 + i), label })) }];
const mandate = parseMandate(DEFAULT_MANDATE);
const gitEsc = esc();

describe('guardDecide', () => {
  it('critical keywords in an option reclassify a git decide into an ask, longest word first', () => {
    const e = esc({ questions: options(['Pousser en force-push sur main', 'Merge']) });
    expect(guardDecide(e, 'git', { q1: 'b' }, mandate)).toEqual({ ok: false, convert: 'ask', category: 'critical', reason: 'contient « force-push »' });
  });
  it.each(['rm -rf build', 'DROP TABLE sessions', 'déployer en prod', 'rotate the secret', 'supprimer la branche', 'git reset   --hard', 'use --force'])('« %s » is critical', summary => {
    expect(criticalIn(esc({ summary }))).not.toBeNull();
  });
  it.each(['rotate the api-token', 'GITHUB_TOKEN leak', 'client_secret', 'pre-prod deploy', 'db_prod', 'hard-delete rows', 'prod-db', 'deploy to prod.', 'run (rm) now'])('« %s » is critical (joined or next to punctuation)', summary => {
    expect(criticalIn(esc({ summary }))).not.toBeNull();
  });
  it('the longest word is reported', () => {
    expect(criticalIn(esc({ summary: 'git push --force' }))).toBe('--force');
    expect(criticalIn(esc({ summary: 'use force-push' }))).toBe('force-push');
  });
  it('scans detail, question text and labels', () => {
    expect(criticalIn(esc({ detail: 'a token leaks' }))).toBe('token');
    expect(criticalIn(esc({ questions: [{ id: 'q1', question: 'Supprimer ?', options: [{ id: 'a', label: 'oui' }, { id: 'b', label: 'non' }] }] }))).toBe('supprimer');
  });
  it('words inside other words are not critical', () => {
    expect(criticalIn(esc({ summary: 'Format the product page, deleted rows, undelete' }))).toBeNull();
  });
  it('architecture and design are never decided', () => {
    expect(guardDecide(gitEsc, 'architecture', {}, mandate)).toEqual({ ok: false, convert: 'ask', category: 'architecture', reason: 'te revient' });
    expect(guardDecide(gitEsc, 'design', {}, mandate)).toMatchObject({ ok: false, category: 'design' });
  });
  it('an unknown category becomes an ask without category', () => {
    expect(guardDecide(gitEsc, 'ops', {}, mandate)).toEqual({ ok: false, convert: 'ask', category: undefined, reason: 'catégorie inconnue' });
  });
  it('a category the user took back, or an unreadable mandate, becomes an ask', () => {
    expect(guardDecide(gitEsc, 'git', {}, { ...mandate, self: ['tests'] })).toMatchObject({ ok: false, category: 'git', reason: 'te revient' });
    expect(guardDecide(gitEsc, 'git', { q1: 'merge' }, parseMandate(''))).toMatchObject({ ok: false, convert: 'ask' });
  });
  it('a valid git decide passes', () => {
    expect(guardDecide(gitEsc, 'git', { q1: 'merge' }, mandate)).toEqual({ ok: true, category: 'git' });
  });
});

describe('validAnswers', () => {
  it('null when each question has a valid option', () => { expect(validAnswers(gitEsc, { q1: 'merge' })).toBeNull(); });
  it('a reason for a missing, unknown or impossible answer', () => {
    expect(validAnswers(gitEsc, {})).toEqual(expect.any(String));
    expect(validAnswers(gitEsc, { q1: 'nope' })).toEqual(expect.any(String));
    expect(validAnswers(esc({ questions: [] }), {})).toEqual(expect.any(String));
  });
});
