import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { RIG_ROW_REFRESH_MS, type ClientMessage, type RigRow, type ThreadItem } from '@ledge/protocol';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';
import { fr } from '../src/tui/i18n/fr.js';
import { en } from '../src/tui/i18n/en.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { cardsInView, markRig, selectedRig, threadLines, threadView } from '../src/tui/model/thread.js';
import { helpLines } from '../src/tui/screens/Help.js';
import { aboutDraft, address } from '../src/tui/model/rigLines.js';
import { cells } from '../src/tui/model/cells.js';
import { clock } from '../src/tui/model/time.js';
import { C } from '../src/tui/theme.js';

/** OpenRig's messages in a seat's thread (docs/mockups/openrig-messages/page.html, section « TUI »). */
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join(''));
const at = (m: number) => new Date(Date.parse('2026-11-02T18:01:00.000Z') + m * 60_000).toISOString();
const HANDOFF_RAW = [
  'From: pilot-lead@ledge-dev-2', 'To: design-ux@ledge-dev-2', 'Sent: 11-02 18:02Z · gen 45f7085e', '---',
  'Queue handoff: qitem-20261102190205-c0704682203041b9 - check your queue. Summary: Retouche maquette encoche : bouton lecture/pause en icône simple, pas rond, comme validé', '---',
  '↩ Reply: rig send pilot-lead@ledge-dev-2 "..."'
].join('\n');
const peers: Record<string, { id: string; name: string }> = { 'bix-1': { id: 'bix-1', name: 'Bix' }, 'ida-1': { id: 'ida-1', name: 'Ida' } };
const peer = (id: string) => peers[id];

const items: ThreadItem[] = [
  { kind: 'received', id: 'm1', at: at(0), turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'bix-1',
    text: "Validation maquette encoche (qitem-…184644). Ses mots : « Tout est ok, sauf le bouton play. Je veux pas qu'il soit simple et pas rond ».",
    rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', sentAt: at(0), raw: 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nValidation…\n---\n↩ Reply: rig send pilot-lead@ledge-dev-2 "..."', packet: { id: 'pk', index: 0, count: 2 } } },
  { kind: 'notice', id: 'h1', at: at(1), turn: 1, notice: 'other', name: 'pilot-lead@ledge-dev-2', peer: 'bix-1', text: 'Queue handoff: …',
    rig: { kind: 'handoff', from: 'pilot-lead@ledge-dev-2', qitem: 'qitem-20261102190205-c0704682203041b9', summary: 'Retouche maquette encoche : bouton lecture/pause en icône simple, pas rond, comme validé', sentAt: at(1), raw: HANDOFF_RAW, packet: { id: 'pk', index: 1, count: 2 } } },
  { kind: 'sent', id: 's1', at: at(2), turn: 1, to: 'dev-front@ledge-dev-2', peer: 'ida-1', status: 'delivered',
    text: "Maquette encoche validée par l'utilisateur, avec une seule retouche : le bouton play en icône simple et carrée, voir la ligne.",
    rig: { kind: 'message', to: 'dev-front@ledge-dev-2', command: 'rig send dev-front@ledge-dev-2 "Maquette…"', raw: 'rig send dev-front@ledge-dev-2 "Maquette…"\nSent to dev-front@ledge-dev-2' } },
  { kind: 'notice', id: 'u1', at: at(19), turn: 1, notice: 'other', text: 'Blocker qitem-a resolved; parked qitem qitem-20261102-77aa4f39 is pending.',
    rig: { kind: 'unblocked', qitem: 'qitem-20261102-77aa4f39', blocker: 'qitem-a', from: 'daemon@kernel', raw: 'Blocker …' } },
  { kind: 'notice', id: 'o1', at: at(44), turn: 1, notice: 'other', text: 'Stuck sweep: design-ux on qitem-20261102-0000ffc1 (7 min)',
    rig: { kind: 'openrig', alert: 'stalled', minutes: 7, qitem: 'qitem-20261102-0000ffc1', from: 'daemon@kernel', raw: 'Stuck sweep …' } },
  { kind: 'notice', id: 'o2', at: at(44.5), turn: 1, notice: 'other', text: 'Custody not checked for qitem-20261102-0000ffc1 (9 min)',
    rig: { kind: 'openrig', alert: 'custody', minutes: 9, qitem: 'qitem-20261102-0000ffc1', from: 'daemon@kernel', raw: 'Custody raw' } },
  { kind: 'notice', id: 'o3', at: at(45), turn: 1, notice: 'other', text: 'Queue handoff: qitem-recovery-a665841e4deeba48 - check your queue. Summary: relance levée',
    rig: { kind: 'openrig', recovery: 'qitem-recovery-a665841e4deeba48', qitem: 'qitem-recovery-a665841e4deeba48', summary: 'relance levée', from: 'daemon@kernel', raw: 'Recovery raw' } },
  { kind: 'received', id: 'm2', at: at(46), turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'bix-1', text: "L'utilisateur retient l'option A pour la bulle (« 3. A »).\nDétails : la bulle reste à droite, sous l'encoche, et la flèche suit le pointeur de la souris. Merci de mettre la maquette à jour avant ce soir, puis de prévenir Ida.",
    rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', count: 2, raw: 'first\n\nsecond' } },
  { kind: 'notice', id: 'x1', at: at(49), turn: 1, notice: 'other', text: 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?',
    rig: { kind: 'unreadable', raw: 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?' } },
  { kind: 'received', id: 'm3', at: at(50), turn: 1, from: 'operator-agent@kernel', text: 'Le noyau redémarre à 20:00.',
    rig: { kind: 'message', from: 'operator-agent@kernel', to: 'design-ux@ledge-dev-2', raw: 'From: operator-agent@kernel…' } },
  { kind: 'notice', id: 'h2', at: at(51), turn: 1, notice: 'other', outgoing: true, text: 'rig queue handoff …',
    rig: { kind: 'handoff', to: 'dev-front@ledge-dev-2', summary: 'Relire l’encoche fermée', qitem: 'qitem-20261102-9999aa11', command: 'rig queue handoff …', raw: 'rig queue handoff …' } },
  { kind: 'notice', id: 'h3', at: at(51.2), turn: 1, notice: 'other', outgoing: true, status: 'refused', text: 'rig queue handoff …',
    rig: { kind: 'handoff', to: 'review-qa@ledge-dev-2', summary: 'Relire la retouche du bouton play', command: 'rig queue handoff qitem-x --to review-qa@ledge-dev-2',
      raw: 'rig queue handoff qitem-x --to review-qa@ledge-dev-2\n\nError: destination review-qa@ledge-dev-2 is not a known seat of this rig (see rig ps)\nexit 1' } },
  { kind: 'prompt', id: 'p2', at: at(51.5), turn: 2, text: 'Regarde aussi le mobile.' }
];
const o = { t: fr, g: glyphsFor({}), width: 80, diffs: false, unfolded: false, peer };
const lines = text(threadLines(items, o));
const find = (s: string) => lines.find(l => l.includes(s))!;
const after = (s: string, n = 1) => lines[lines.findIndex(l => l.includes(s)) + n]!;

describe('tui OpenRig messages in a thread', () => {
  it('prints the sample thread at 80 columns, every line at most the width', () => {
    // Printed for the report: the whole sample thread, as the TUI draws it.
    if (process.env.PRINT_RIG_THREAD) { const rows: Record<string, RigRow> = {
      'qitem-20261102190205-c0704682203041b9': { id: 'qitem-20261102190205-c0704682203041b9', state: 'done', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', createdAt: at(1), claimedAt: at(1.4), updatedAt: at(2), at: at(3) },
      'qitem-20261102-9999aa11': { id: 'qitem-20261102-9999aa11', state: 'pending', from: 'design-ux@ledge-dev-2', to: 'dev-front@ledge-dev-2', createdAt: at(51), updatedAt: at(51), at: at(52) } };
    const v = threadView(items, { ...o, row: q => rows[q] }); writeFileSync(process.env.PRINT_RIG_THREAD, text(markRig(v, 'm2', glyphsFor({}))).join('\n')); }
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(80);
  });

  it('a received message: ✉ « reçu de » the sender’s Ledge name, its seat · rig, the time right; quoted on 3 lines at most; its keys', () => {
    const head = find('reçu de Bix pilot-lead');
    expect(head).toMatch(new RegExp(`^  ✉ reçu de Bix pilot-lead · ledge-dev-2 +${clock(at(0))}$`));
    expect(cells(head)).toBe(80);
    expect(after('reçu de Bix pilot-lead · ledge-dev-2')).toMatch(/^ {6}« Validation maquette encoche/);
    expect(lines.filter(l => l === '      r répondre · b brut')).toHaveLength(2);
    // Cut at three lines, « … » inside the quote.
    const m2 = lines.findIndex(l => l.includes('reçu 2 fois'));
    expect(lines.slice(m2 + 1, m2 + 4).every(l => l.startsWith('      '))).toBe(true);
    expect(lines[m2 + 3]).toMatch(/… »$/);
    expect(lines[m2 + 4]).toBe('      r répondre · b brut');
  });

  it('the colours: ✉ violet, the name bold, the seat faint, the count yellow', () => {
    const v = threadLines(items, o).find(l => l.some(s => s.text.includes('reçu 2 fois')))!;
    expect(v[1]).toMatchObject({ text: '✉', color: C.violet });
    expect(v.find(s => s.text === 'Bix')).toMatchObject({ bold: true });
    expect(v.find(s => s.text.includes('reçu 2 fois'))!.color).toBe(C.yellow);
  });

  it('a sender without a Ledge session: its seat as the name, its rig faint, no r', () => {
    expect(find('operator-agent')).toMatch(/^  ✉ reçu de operator-agent kernel +\d\d:\d\d$/);
    expect(after('operator-agent', 2)).toBe('      b brut');
  });

  it('a row handed to the seat: ▤ « ligne confiée par » Bix, « état non suivi », the id’s end; its summary bold on one line; its journal', () => {
    expect(find('ligne confiée par')).toMatch(new RegExp(`^  ▤ ligne confiée par Bix  état non suivi  …3041b9 +${clock(at(1))}$`));
    const summary = after('ligne confiée par');
    expect(summary).toMatch(/^ {6}Retouche maquette encoche : bouton lecture\/pause en icône simple, pas ron…$/);
    expect(cells(summary)).toBeLessThanOrEqual(80);
    expect(after('ligne confiée par', 2)).toBe(`      confiée ${clock(at(1))} · b brut`);
    const v = threadLines(items, o).find(l => l.some(s => s.text.startsWith('    ')) && l.some(s => s.text.startsWith('Retouche')))!;
    expect(v.find(s => s.text.startsWith('Retouche'))).toMatchObject({ bold: true });
  });

  it('a row the seat passed: « ligne passée à » the destination', () => {
    expect(find('ligne passée à')).toMatch(/^  ▤ ligne passée à dev-front  état non suivi  …99aa11 +\d\d:\d\d$/);
    expect(after('ligne passée à')).toBe('      Relire l’encoche fermée');
    expect(after('ligne passée à', 2)).toMatch(/^ {6}passée \d\d:\d\d · b brut$/);
  });

  it('the seat’s own rig send: ✉ « envoyé à » Ida, her seat faint, ✓ remis; quoted on one line', () => {
    expect(find('envoyé à')).toMatch(/^  ✉ envoyé à Ida dev-front {2}✓ remis +\d\d:\d\d$/);
    expect(after('envoyé à')).toMatch(/^ {6}« Maquette encoche validée.*… »$/);
    expect(after('envoyé à', 2)).toBe('');
    const sending = text(threadLines([{ ...items[2]!, status: 'sending' } as ThreadItem], o));
    expect(sending[0]).toMatch(/envoi… +\d\d:\d\d$/);
    const failed = threadLines([{ ...items[2]!, status: 'failed' } as ThreadItem], o)[0]!;
    expect(failed.find(s => s.text.includes('échec'))).toMatchObject({ text: '✗ échec', color: C.red });
  });

  it('OpenRig’s notices: a blocker cleared in violet, a stuck sweep in yellow, the others in a row folded on one faint line', () => {
    expect(find('blocage levé')).toMatch(/^ {2}· OpenRig blocage levé : la ligne …4f39 est de nouveau à faire +\d\d:\d\d$/);
    expect(find('sans suite')).toMatch(/^ {2}· OpenRig ligne …ffc1 prise il y a 7 min, sans suite +\d\d:\d\d$/);
    const stalled = threadLines(items, o).find(l => l.some(s => s.text.includes('sans suite')))!;
    expect(stalled.every(s => !s.text.trim() || s.color === C.yellow || /\d\d:\d\d/.test(s.text))).toBe(true);
    expect(find('repliés')).toMatch(new RegExp(`^ {2}· 2 avis OpenRig repliés · Custody not checked for qitem-20261102-0000… {2}${clock(at(45))}$`));
    // Short enough, their first lines joined with « , ».
    const short = text(threadLines([{ ...items[5]!, text: 'Custody not checked' } as ThreadItem, items[6]!], o));
    expect(short[0]).toMatch(/^ {2}· 2 avis OpenRig repliés · Custody not checked, relance levée +\d\d:\d\d$/);
    // Notices stand together, no blank between them.
    const u = lines.findIndex(l => l.includes('blocage levé'));
    expect(lines.slice(u, u + 3).every(l => l.startsWith('  · '))).toBe(true);
    // Unfolded (space), each one has its line.
    const all = text(threadLines(items, { ...o, unfolded: true }));
    expect(all.some(l => l.includes('repliés'))).toBe(false);
    expect(all.find(l => l.includes('relance levée'))).toMatch(/^ {2}· OpenRig relance levée +\d\d:\d\d$/);
  });

  it('a notice of OpenRig alone is not folded', () => {
    const one = text(threadLines([items[5]!], o));
    expect(one[0]).toMatch(/^ {2}· OpenRig Custody not checked for qitem-20261102-0000ffc1 \(9 min\) +\d\d:\d\d$/);
  });

  it('an unreadable block: said so, faint, then the block as is, its header on one line', () => {
    expect(find('illisible')).toMatch(/^  \? message OpenRig illisible, affiché tel quel +\d\d:\d\d$/);
    expect(after('illisible')).toBe('      From: pilot-lead@ledge-dev-2 / To: design-ux@ledge-dev-2 / ---');
    expect(after('illisible', 2)).toBe('      Relance : la maquette est-elle prête ?');
  });

  it('the user’s own words stay « Vous »', () => {
    expect(lines).toContain('  Regarde aussi le mobile.');
    expect(lines.some(l => /^Vous {2}\d\d:\d\d$/.test(l))).toBe(true);
  });

  it('the cards stand apart by a blank line', () => {
    const i = lines.findIndex(l => l.includes('ligne confiée par'));
    expect(lines[i - 1]).toBe('');
    expect(lines[lines.findIndex(l => l.includes('illisible')) - 1]).toBe('');
  });

  it('b opens the raw in a faint box at the width; pasted blocks show their packet’s raws joined', () => {
    const v = threadView(items, { ...o, raws: new Set(['h1']) });
    const ls = text(v.lines);
    const top = ls.findIndex(l => l.startsWith('      ┌ '));
    expect(ls[top]).toMatch(/^ {6}┌ 2 messages collés ensemble · brut ─+┐$/);
    expect(cells(ls[top]!)).toBe(80);
    const bottom = ls.findIndex(l => l.startsWith('      └'));
    expect(ls[bottom]).toMatch(/^ {6}└─+ b fermer ┘$/);
    expect(cells(ls[bottom]!)).toBe(80);
    const inside = ls.slice(top + 1, bottom);
    for (const l of inside) { expect(l).toMatch(/^ {6}│ .* │$/); expect(cells(l)).toBe(80); }
    // Both blocks of the packet, the message first, the handoff wrapped to the box.
    expect(inside[0]).toMatch(/│ From: pilot-lead@ledge-dev-2 +│/);
    expect(inside.some(l => l.includes('Queue handoff: qitem-20261102190205-c0704682203041b9'))).toBe(true);
    expect(inside.some(l => l.includes('↩ Reply: rig send pilot-lead@ledge-dev-2 "..."'))).toBe(true);
    expect(v.lines.slice(top, bottom + 1).every(l => l.filter(s => s.text.trim()).every(s => s.color === C.faint))).toBe(true);
    // A block alone: « brut ».
    expect(text(threadView(items, { ...o, raws: new Set(['s1']) }).lines).find(l => l.includes('┌'))).toMatch(/^ {6}┌ brut ─+┐$/);
  });

  it('the element b and r act on is the lowest OpenRig one in view; r is given only with the sender’s Ledge session', () => {
    const v = threadView(items, o);
    expect(selectedRig(v, 0, v.lines.length - 1)).toBe('h3');
    const m1 = v.keys.indexOf('m1');
    expect(selectedRig(v, 0, m1 + 1)).toBe('m1');
    expect(v.rig.get('m1')!.reply).toEqual({ peer: { id: 'bix-1', name: 'Bix' }, text: items[0]!.kind === 'received' ? items[0]!.text : '' });
    expect(v.rig.get('m3')!.reply).toBeUndefined();
    expect(v.rig.get('h1')!.reply).toBeUndefined();
    // Nothing of OpenRig in view: none.
    expect(selectedRig(v, v.lines.length - 2, v.lines.length - 1)).toBeUndefined();
  });

  it('r’s draft: « À propos de : « <first non-empty line, 80 characters at most> » », then a blank line', () => {
    expect(aboutDraft('\n  Validation maquette encoche.\nSuite', fr, glyphsFor({}))).toBe('À propos de : « Validation maquette encoche. »\n\n');
    expect(aboutDraft('Validation', en, glyphsFor({}))).toBe('About: “Validation”\n\n');
    const long = aboutDraft('x'.repeat(120), fr, glyphsFor({}));
    expect(long).toBe(`À propos de : « ${'x'.repeat(79)}… »\n\n`);
  });

  it('English', () => {
    const e = text(threadLines(items, { ...o, t: en }));
    expect(e.find(l => l.startsWith('  ✉ from Bix'))).toBeTruthy();
    expect(e).toContain('      r reply · b raw');
    expect(e.find(l => l.includes('row handed by Bix'))).toMatch(/state not tracked/);
    expect(e.find(l => l.includes('row passed to dev-front'))).toBeTruthy();
    expect(e.find(l => l.includes('received 2 times'))).toBeTruthy();
    expect(e.find(l => l.includes('blocker cleared: row …4f39 is to do again'))).toBeTruthy();
    expect(e.find(l => l.includes('row …ffc1 taken 7 min ago, no progress'))).toBeTruthy();
    expect(e.find(l => l.includes('2 OpenRig notices folded'))).toBeTruthy();
    expect(e.find(l => l.includes('unreadable OpenRig message, shown as is'))).toBeTruthy();
    expect(text(threadView(items, { ...o, t: en, raws: new Set(['h2']) }).lines).find(l => l.includes('└'))).toMatch(/ b close ┘$/);
  });

  it('without colour or in ASCII, the glyphs become @, = and -', () => {
    for (const g of [glyphsFor({ NO_COLOR: '1' }), glyphsFor({ LEDGE_TUI_ASCII: '1' })]) {
      const a = text(threadLines(items, { ...o, g }));
      expect(a.find(l => l.includes('reçu de Bix'))).toMatch(/^  @ reçu de/);
      expect(a.find(l => l.includes('ligne confiée par'))).toMatch(/^  = ligne confiée par/);
      expect(a.find(l => l.includes('blocage levé'))).toMatch(/^ {2}- OpenRig/);
      expect(a.find(l => l.includes('repliés'))).toMatch(/^ {2}- 2 avis/);
    }
    // ASCII: the raw's box too.
    const box = text(threadView(items, { ...o, g: glyphsFor({ LEDGE_TUI_ASCII: '1' }), raws: new Set(['s1']) }).lines);
    expect(box.find(l => l.includes('brut -'))).toMatch(/^ {6}\+ brut -+\+$/);
    // NO_COLOR alone keeps the rest of the Unicode glyphs; an empty NO_COLOR is no NO_COLOR.
    expect(glyphsFor({ NO_COLOR: '1' }).ok).toBe('✓');
    expect(glyphsFor({ NO_COLOR: '' }).rigMessage).toBe('✉');
  });

  it('a narrow thread drops the rig before the seat and keeps every line in the width', () => {
    const n = text(threadLines(items, { ...o, width: 46 }));
    for (const l of n) expect(cells(l)).toBeLessThanOrEqual(46);
    expect(n.find(l => l.includes('reçu de Bix') && l.includes('reçu 2 fois'))).toMatch(/^  ✉ reçu de Bix pilot-lead {2}reçu 2 fois +\d\d:\d\d$/);
  });

  it('the selected OpenRig element: ▸ in coral in its two reserved cells, on its first line; nothing else moves', () => {
    const v = threadView(items, o), g = glyphsFor({});
    const marked = markRig(v, 'm2', g);
    const head = v.heads.get('m2')!;
    expect(text([marked[head]!])[0]).toMatch(/^▸ ✉ reçu de Bix pilot-lead · ledge-dev-2 {2}reçu 2 fois +\d\d:\d\d$/);
    expect(marked[head]![0]).toMatchObject({ text: '▸ ', color: C.coral });
    // Only that line changed, and by its two first cells.
    expect(text(marked).filter((l, i) => l !== text(v.lines)[i])).toHaveLength(1);
    expect(text([marked[head]!])[0]!.slice(2)).toBe(text([v.lines[head]!])[0]!.slice(2));
    // A notice, a folded run, a card: each has a head; the user's prompt none.
    for (const k of ['m1', 'h1', 's1', 'u1', 'o1', 'o2', 'm2', 'x1', 'm3', 'h2', 'h3']) expect(v.heads.has(k), k).toBe(true);
    expect(v.heads.has('o3')).toBe(false);
    expect(text([markRig(v, 'u1', g)[v.heads.get('u1')!]!])[0]).toMatch(/^▸ · OpenRig blocage levé/);
    expect(markRig(v, undefined, g)).toBe(v.lines);
    // ASCII: >.
    const a = glyphsFor({ LEDGE_TUI_ASCII: '1' }), va = threadView(items, { ...o, g: a });
    expect(text([markRig(va, 'm1', a)[va.heads.get('m1')!]!])[0]).toMatch(/^> @ reçu de Bix/);
  });

  it('a handoff OpenRig did not take: « non transmise » in red, the log says what OpenRig printed, cut', () => {
    const v = threadLines(items, o);
    const head = v.find(l => l.some(s => s.text.includes('review-qa')))!;
    expect(text([head])[0]).toMatch(/^ {2}▤ ligne passée à review-qa {2}non transmise +\d\d:\d\d$/);
    expect(head.find(s => s.text === 'non transmise')).toMatchObject({ color: C.red });
    const log = after('ligne passée à review-qa', 2);
    expect(log).toMatch(/^ {6}passée \d\d:\d\d · OpenRig : Error: destination review-qa@.+… · b brut$/);
    expect(cells(log)).toBeLessThanOrEqual(80);
    // Nothing printed after the command: said so.
    const bare = text(threadLines([{ ...items.find(i => i.id === 'h3')!, rig: { kind: 'handoff', to: 'review-qa@ledge-dev-2', raw: 'rig queue handoff qitem-x --to review-qa@ledge-dev-2\n\n' } } as ThreadItem], o));
    expect(bare).toContain(`      passée ${clock(at(51.2))} · non transmise par OpenRig · b brut`);
    // The whole output in the raw.
    const raw = text(threadView(items, { ...o, raws: new Set(['h3']) }).lines);
    expect(raw.some(l => l.includes('exit 1'))).toBe(true);
    expect(text(threadLines(items, { ...o, t: en })).find(l => l.includes('row passed to review-qa'))).toMatch(/not handed off/);
  });

  it('the help says ↵, r and b', () => {
    const h = text(helpLines([[fr.help.session, [['↵', fr.help.writeHere], ['r', fr.help.replySender], ['b', fr.help.rigRaw]]]], 120));
    expect(h.some(l => l.startsWith('↵') && l.includes('écrire à cette session'))).toBe(true);
    expect(en.help.rigRaw).toBe("show or hide an OpenRig message's raw text");
    expect(fr.help.replySender).toBe("répondre à l'expéditeur du message sélectionné");
  });

  it('reads an address as its seat and rig', () => {
    expect(address('pilot-lead@ledge-dev-2')).toEqual({ seat: 'pilot-lead', rig: 'ledge-dev-2' });
    expect(address('<unknown sender>')).toEqual({ seat: '<unknown sender>' });
    expect(address('a@r, b@r')).toEqual({ seat: 'a@r, b@r' });
  });
});

describe('ledge tui: keys b and r on OpenRig’s messages', () => {
  const T = (s: number) => new Date(Date.parse('2026-10-09T18:00:00.000Z') + s * 1000).toISOString();
  const thread: ThreadItem[] = [
    { kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Documente le protocole' },
    { kind: 'received', id: 'm1', at: T(1), turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'nova', text: '\nRelis la section Protocol avant ce soir.\nMerci.',
      rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', raw: 'From: pilot-lead@ledge-dev-2\nTo: docs@ledge-dev-2\n---\nRelis la section Protocol avant ce soir.\n---\n↩ Reply: rig send pilot-lead@ledge-dev-2 "..."' } }
  ];
  const openBix = async (tui: Awaited<ReturnType<typeof startTui>>) => {
    await tui.press('j'); await tui.press('j');
    await until(() => tui.frame().includes('BIX · DOCUMENTER'));
    await tui.press('\r');
    await until(() => tui.frame().includes('reçu de Nova'));
  };

  it('b opens and closes the raw of the OpenRig element in view; the key bar says b and r', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', thread);
    try {
      await openBix(tui);
      expect(tui.frame()).toContain('r répondre · b brut');
      expect(tui.frame()).toMatch(/▸ ✉ reçu de Nova/);
      expect(tui.frame()).toMatch(/↵ +écrire/);
      expect(tui.frame()).toMatch(/r +répondre à Nova/);
      expect(tui.frame()).toMatch(/b +brut/);
      await tui.press('b');
      await until(() => tui.frame().includes('┌ brut'));
      expect(tui.frame()).toContain('│ ↩ Reply: rig send pilot-lead@ledge-dev-2 "..."');
      expect(tui.frame()).toMatch(/└─+ b fermer ┘/);
      await tui.press('b');
      await until(() => !tui.frame().includes('┌ brut'));
    } finally { await tui.cleanup(); }
  });

  it('r opens the sender’s session on its composer, the message quoted, a blank line, the cursor below; ↵ still writes here', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', thread);
    tui.daemon.thread('nova', []);
    try {
      await openBix(tui);
      await tui.press('r');
      await until(() => tui.frame().includes('RÉPONDRE À NOVA'));
      // The cursor on the third line: after the quote and a blank line.
      expect(tui.frame()).toContain('ligne 3/3');
      expect(tui.frame()).toContain('À propos de : « Relis la section Protocol avant ce soir. »');
      await tui.press('Oui, je relis.');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]).toEqual({ type: 'session.reply', id: 'nova', text: 'À propos de : « Relis la section Protocol avant ce soir. »\n\nOui, je relis.' });
    } finally { await tui.cleanup(); }
  });

  it('no r toward a sender without a Ledge session: r writes here, as always', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', [thread[0]!, { ...thread[1]!, peer: undefined } as ThreadItem]);
    try {
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('BIX · DOCUMENTER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('reçu de pilot-lead'));
      expect(tui.frame()).not.toContain('r répondre ·');
      expect(tui.frame()).toMatch(/↵ +écrire +b +brut/);
      await tui.press('r');
      await until(() => tui.frame().includes('RÉPONDRE À BIX'));
    } finally { await tui.cleanup(); }
  });
});

describe('tui OpenRig task cards: the row’s state, read live', () => {
  const Q = 'qitem-20261102190205-c0704682203041b9';
  const rowAt = (state: string, more: Partial<RigRow> = {}): RigRow => ({ id: Q, state, from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', createdAt: at(1), updatedAt: at(2), at: at(3), ...more });
  const card = (row: RigRow | undefined, item: ThreadItem = items[1]!) => threadLines([item], { ...o, row: q => (q === row?.id ? row : undefined), seat: a => (a === 'dev-front@ledge-dev-2' ? 'Ida' : undefined) });

  it('each state in its words and colour, its short log under', () => {
    const cases: Array<[RigRow, RegExp, string, RegExp]> = [
      [rowAt('pending'), /Bix {2}en attente {2}…3041b9/, C.faint, new RegExp(`^ {6}confiée ${clock(at(1))} · pas encore prise · b brut$`)],
      [rowAt('in-progress', { claimedAt: at(1.5) }), /Bix {2}prise {2}…3041b9/, C.blue, new RegExp(`^ {6}confiée ${clock(at(1))} · prise ${clock(at(1.5))} · b brut$`)],
      [rowAt('done', { claimedAt: at(1.5), updatedAt: at(2) }), /Bix {2}✓ terminée {2}…3041b9/, C.green, new RegExp(`^ {6}confiée ${clock(at(1))} · prise ${clock(at(1.5))} · terminée ${clock(at(2))} · b brut$`)],
      [rowAt('handed-off', { handedOffTo: 'dev-front@ledge-dev-2' }), /Bix {2}passée à Ida {2}…3041b9/, C.violet, /confiée \d\d:\d\d · b brut$/],
      [rowAt('blocked', { claimedAt: at(1.5), blockedOn: 'qitem-20261102-77aa4f39aa' }), /Bix {2}bloquée {2}…3041b9/, C.yellow, /prise \d\d:\d\d · attend la ligne …4f39aa · b brut$/],
      [rowAt('parked'), /Bix {2}parked {2}…3041b9/, C.faint, /confiée \d\d:\d\d · b brut$/]
    ];
    for (const [row, head, color, log] of cases) {
      const ls = card(row), tx = text(ls);
      expect(tx[0], row.state).toMatch(head);
      expect(ls[0]!.find(s => /en attente|prise|terminée|passée à|bloquée|parked/.test(s.text))!.color, row.state).toBe(color);
      expect(tx[2], row.state).toMatch(log);
    }
    // handed-off to a seat without a Ledge session: its seat.
    expect(text(card(rowAt('handed-off', { handedOffTo: 'review-qa@ledge-dev-2' })))[0]).toMatch(/passée à review-qa/);
    // Not read: « état non suivi », the item's time.
    expect(text(card(undefined))[0]).toMatch(/état non suivi/);
  });

  it('the card the seat passed: « passée HH:MM » first; refused stays « non transmise »', () => {
    const out = items.find(i => i.id === 'h2')!;
    const row = { ...rowAt('done', { claimedAt: at(52), updatedAt: at(53) }), id: 'qitem-20261102-9999aa11', createdAt: at(51) };
    const tx = text(threadLines([out], { ...o, row: q => (q === row.id ? row : undefined) }));
    expect(tx[0]).toMatch(/^ {2}▤ ligne passée à dev-front {2}✓ terminée {2}…99aa11/);
    expect(tx[2]).toBe(`      passée ${clock(at(51))} · prise ${clock(at(52))} · terminée ${clock(at(53))} · b brut`);
    const refused = items.find(i => i.id === 'h3')!;
    expect(text(threadLines([refused], { ...o, row: () => row }))[0]).toMatch(/non transmise/);
    // English.
    expect(text(threadLines([out], { ...o, t: en, row: q => (q === row.id ? row : undefined) }))[0]).toMatch(/✓ done/);
  });

  it('the cards in view are the rows to read; a refused card and the other elements are none', () => {
    const v = threadView(items, o);
    expect([...v.cards.values()]).toEqual([Q, 'qitem-20261102-9999aa11']);
    expect(cardsInView(v, 0, v.lines.length - 1)).toEqual([Q, 'qitem-20261102-9999aa11']);
    const h1 = v.keys.indexOf('h1');
    expect(cardsInView(v, h1 + 4, v.lines.length - 1)).toEqual(['qitem-20261102-9999aa11']);
    expect(cardsInView(v, 0, h1 - 2)).toEqual([]);
  });
});

describe('ledge tui: a task card reads its row while in view', () => {
  const T = (s: number) => new Date(Date.parse('2026-10-09T18:00:00.000Z') + s * 1000).toISOString();
  const Q = 'qitem-20261009180001-aaaabbbbcccc0001';
  const handoff = (id: string, qitem: string, s: number): ThreadItem => ({ kind: 'notice', id, at: T(s), turn: 1, notice: 'other', name: 'pilot-lead@ledge-dev-2', text: 'Queue handoff: …',
    rig: { kind: 'handoff', from: 'pilot-lead@ledge-dev-2', qitem, summary: `Relire ${id}`, raw: 'From: …' } });
  const row = (state: string, more: Partial<RigRow> = {}): RigRow => ({ id: Q, state, from: 'pilot-lead@ledge-dev-2', to: 'docs@ledge-dev-2', createdAt: T(1), updatedAt: T(3), at: T(4), ...more });
  const open = async (tui: Awaited<ReturnType<typeof startTui>>) => {
    await tui.press('j'); await tui.press('j');
    await until(() => tui.frame().includes('BIX · DOCUMENTER'));
    await tui.press('\r');
    await until(() => tui.frame().includes('ligne confiée par'));
  };

  it('no answer, then pending, in progress, done, as OpenRig answers each ask (now, then every 30 s while in view)', async () => {
    // Only the 30 s refresh is driven by hand: the rest of the TUI runs on real time.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const tui = await startTui({ daemonExtras: { openrigRows: true } });
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Va' }, handoff('h1', Q, 1)]);
    const asks = () => sent(tui.daemon.received, 'openrig.row');
    // The next ask (the first, then one per RIG_ROW_REFRESH_MS), answered.
    const answer = async (n: number, r: RigRow | undefined, error?: string) => {
      if (n > 1) vi.advanceTimersByTime(RIG_ROW_REFRESH_MS);
      await until(() => asks().length === n);
      const ask = asks()[n - 1]!;
      expect(ask.qitem).toBe(Q);
      tui.daemon.push({ type: 'openrig.rowState', requestId: ask.requestId, qitem: Q, ...(r ? { row: r } : {}), ...(error ? { error } : {}) });
    };
    try {
      await open(tui);
      await until(() => asks().length === 1);
      expect(tui.frame()).toContain('état non suivi');
      await answer(1, row('pending'));
      await until(() => tui.frame().includes('en attente'));
      expect(tui.frame()).toContain('pas encore prise');
      await answer(2, row('in-progress', { claimedAt: T(2) }));
      await until(() => /pilot-lead +prise/.test(tui.frame()));
      await answer(3, row('done', { claimedAt: T(2) }));
      await until(() => tui.frame().includes('✓ terminée'));
      expect(tui.frame()).toMatch(/confiée \d\d:\d\d · prise \d\d:\d\d · terminée \d\d:\d\d · b brut/);
      // An error answer: not tracked again.
      await answer(4, undefined, 'not_found');
      await until(() => tui.frame().includes('état non suivi'));
    } finally { await tui.cleanup(); vi.useRealTimers(); }
  });

  it('asks nothing of a daemon that does not answer rows', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Va' }, handoff('h1', Q, 1)]);
    try {
      await open(tui);
      await new Promise(r => setTimeout(r, 200));
      expect(sent(tui.daemon.received, 'openrig.row')).toEqual([]);
      expect(tui.frame()).toContain('état non suivi');
    } finally { await tui.cleanup(); }
  });

  it('asks only for the cards in view', async () => {
    const tui = await startTui({ daemonExtras: { openrigRows: true } });
    const old = 'qitem-20261009180001-0ld0ld0ld0ld';
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Va' }, handoff('h0', old, 1),
      ...Array.from({ length: 60 }, (_, i) => ({ kind: 'message' as const, id: `m${i}`, at: T(2 + i), turn: 1, text: `Ligne ${i}` })), handoff('h1', Q, 70)]);
    try {
      await open(tui);
      await until(() => sent(tui.daemon.received, 'openrig.row').length >= 1);
      await new Promise(r => setTimeout(r, 200));
      expect(sent(tui.daemon.received, 'openrig.row').map(m => m.qitem)).toEqual([Q]);
    } finally { await tui.cleanup(); }
  });
});
