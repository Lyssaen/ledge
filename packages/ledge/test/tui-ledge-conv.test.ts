import { describe, it, expect } from 'vitest';
import type { Escalation, Exchange, LedgeDecision } from '@ledge/protocol';
import type { ThreadRow } from '@ledge/ui/chat/ledge/threadModel';
import { convLines, decisionKeys, type ConvOpts } from '../src/tui/model/ledgeConv.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { fr } from '../src/tui/i18n/fr.js';
import { C } from '../src/tui/theme.js';
import type { Line } from '../src/tui/model/cells.js';

const NOW = '2026-10-31T16:48:00.000Z';
const ago = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString();
const text = (l: Line) => l.map(s => s.text).join('');
const opts = (o: Partial<ConvOpts> = {}): ConvOpts => ({ t: fr, g: glyphsFor({}), width: 120, open: new Set(), answer: () => ({ state: 'idle' }), now: NOW, ...o });

const question = 'Sessions : passer du fichier JSON à SQLite ?';
const escalation = (extra: Partial<Escalation> = {}): Escalation => ({
  id: 'q-117', source: 'rig', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', intent: 'decision', summary: question,
  questions: [{ id: 'q1', question, options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Garder le JSON' }] }],
  createdAt: ago(4), state: 'pending', category: 'architecture', advice: 'SQLite. Tu as écarté deux fois les fichiers plats.', ...extra
});
const escRow = (e: Escalation): ThreadRow => ({ kind: 'escalation', item: { kind: 'escalation', id: 'i-esc', at: ago(3), escalationId: e.id }, escalation: e });
const exchange = (id: string, at: string, from: string, to: string, kind: Exchange['kind'], body: string): Exchange => ({ id, machine: 'local', rigId: 'factory', from, to, kind, text: body, at });
const group = (id: string, from: string, to: string, exchanges: Exchange[]): ThreadRow =>
  ({ kind: 'exchanges', item: { kind: 'exchanges', id, at: to, machine: 'local', rigId: 'factory', from, to, exchangeIds: exchanges.map(x => x.id) }, exchanges, missing: 0 });

describe('ledge tui: Ledge’s conversation', () => {
  it('an escalation draws inside a double box with its options and keys', () => {
    const { lines, keys } = convLines([escRow(escalation())], opts());
    const all = lines.map(text);
    expect(all.some(l => l.includes('╔═ ARCHITECTURE · ORCH-LEAD@FACTORY · IL Y A 4 MIN'))).toBe(true);
    expect(all.some(l => l.includes(' 1 · SQLite 1 ') && l.includes(' 2 · Garder le JSON 2 '))).toBe(true);
    expect(all.some(l => l.includes('Mon avis : SQLite.'))).toBe(true);
    expect(all.some(l => l.includes(' En parler e '))).toBe(true);
    expect(all.some(l => l.includes('◖ Ledge'))).toBe(true);
    // Every line is the escalation's: scrolled, it stays on it.
    expect(new Set(keys)).toEqual(new Set(['i-esc']));
    // The recommended option is the primary button.
    const buttons = lines.find(l => text(l).includes(' 1 · SQLite '))!;
    expect(buttons.find(s => s.text === ' 1 · SQLite ')?.bg).toBe(C.primary);
    expect(buttons.find(s => s.text === ' 2 · Garder le JSON ')?.bg).toBe(C.key);
  });

  it('decisionKeys numbers options across questions', () => {
    const e = escalation({ questions: [
      { id: 'a', question: 'A ?', options: [{ id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2', recommended: true }] },
      { id: 'b', question: 'B ?', options: [{ id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }] }
    ] });
    expect(decisionKeys(e)).toEqual([
      { key: '1', questionId: 'a', optionId: 'a1', label: 'A1', recommended: false },
      { key: '2', questionId: 'a', optionId: 'a2', label: 'A2', recommended: true },
      { key: '3', questionId: 'b', optionId: 'b1', label: 'B1', recommended: false },
      { key: '4', questionId: 'b', optionId: 'b2', label: 'B2', recommended: false }
    ]);
  });

  it('an escalation answered elsewhere says so and its buttons go out', () => {
    const refused = convLines([escRow(escalation())], opts({ answer: () => ({ state: 'refused', code: 'already_answered' }) })).lines;
    expect(refused.some(l => text(l).includes('Déjà répondu'))).toBe(true);
    const off = refused.find(l => text(l).includes(' 1 · SQLite '))!;
    expect(off.filter(s => /SQLite|JSON|^[12] $/.test(s.text)).every(s => s.bg === undefined)).toBe(true);
    const answered = convLines([escRow(escalation({ state: 'answered', answer: { by: 'ledge', answers: { q1: 'sqlite' }, at: ago(1) } }))], opts()).lines.map(text);
    expect(answered.some(l => l.includes('→ SQLite · par Ledge'))).toBe(true);
  });

  it('a user message to a seat starts with the address in violet', () => {
    const row: ThreadRow = { kind: 'user', item: { kind: 'user', id: 'u1', at: ago(2), text: '@build relance les tests', to: '@build' }, to: '@build' };
    const { lines } = convLines([row], opts());
    expect(lines.some(l => text(l).trimStart().startsWith('toi · '))).toBe(true);
    const said = lines.find(l => text(l).includes('relance les tests'))!;
    const address = said.find(s => s.text.includes('@build'))!;
    expect(address).toMatchObject({ color: C.violet, bold: true });
    // Aligned on the right, on the selection's background.
    expect(text(said).endsWith(' ')).toBe(true);
    expect(text(said).length).toBe(120);
    expect(said.find(s => s.text.includes('relance'))?.bg).toBe(C.sel);
  });

  it('the latest exchange group is open and the others folded', () => {
    const old = group('g1', ago(30), ago(28), [exchange('x1', ago(30), 'build@starter', 'dev-review@starter', 'message', 'Encoche corrigée.')]);
    const latest = group('g2', ago(12), ago(6), [
      exchange('x2', ago(12), 'orch-lead@factory', 'qa@factory', 'task', 'Vérifier la reprise après reboot.'),
      exchange('x3', ago(6), 'orch-lead@factory', 'ledge', 'ledge', 'Sessions : JSON ou SQLite ?')
    ]);
    const o = opts({ rig: () => ({ name: 'factory', color: C.yellow }) });
    const all = convLines([old, latest], o).lines.map(text);
    const heads = all.filter(l => l.includes('▣ factory'));
    expect(heads[0]).toMatch(/^▸ ▣ factory · 1 échange · /);
    expect(heads[0]).toContain('↵ déplier');
    expect(heads[1]).toMatch(/^▾ ▣ factory · 2 échanges entre agents · \d\d:\d\d → \d\d:\d\d/);
    expect(heads[1]).toContain('z replier');
    expect(all.some(l => /^│ \d\d:\d\d {2}orch-lead → qa +▤ Vérifier la reprise/.test(l))).toBe(true);
    expect(all.some(l => l.includes('◆ Sessions : JSON ou SQLite ?'))).toBe(true);
    expect(all.some(l => l.includes('Encoche corrigée.'))).toBe(false);
    // z on a group flips it from its default.
    const flipped = convLines([old, latest], { ...o, open: new Set(['g1', 'g2']) }).lines.map(text);
    expect(flipped.some(l => l.includes('Encoche corrigée.'))).toBe(true);
    expect(flipped.some(l => l.includes('Vérifier la reprise'))).toBe(false);
  });

  it('a decision Ledge took: the line, its rule and « Revenir dessus u »', () => {
    const decision: LedgeDecision = { id: 'd-1', escalationId: 'q-9', by: 'ledge', category: 'git', summary: 'merge, pas de rebase', answers: {}, rule: 'du 26/10 · force-push refusé.', at: ago(10) };
    const row: ThreadRow = { kind: 'decided', item: { kind: 'decided', id: 'i-d1', at: ago(10), decisionId: 'd-1' }, decision, to: 'build' };
    const all = convLines([row], opts()).lines.map(text);
    expect(all.some(l => l.includes('J’ai tranché pour build : merge, pas de rebase.'))).toBe(true);
    expect(all.some(l => l.includes('Règle du 26/10 · force-push refusé.'))).toBe(true);
    expect(all.some(l => l.includes(' Revenir dessus u '))).toBe(true);
  });

  it('the day, centred; Ledge’s bubble in Markdown, a pending one ending with the caret', () => {
    const rows: ThreadRow[] = [
      { kind: 'day', day: '2026-10-31', label: 'Aujourd’hui' },
      { kind: 'ledge', item: { kind: 'ledge', id: 'l1', at: ago(1), text: 'factory **avance**', pending: true } }
    ];
    const all = convLines(rows, opts()).lines.map(text);
    expect(all[0]).toMatch(/^─+ AUJOURD’HUI ─+$/);
    expect(all[0]!.length).toBe(120);
    expect(all.some(l => l.startsWith('╭') && l.endsWith('╮'))).toBe(true);
    expect(all.some(l => l.includes('factory avance'))).toBe(true);
    expect(all.some(l => l.includes('▍'))).toBe(true);
  });
});
