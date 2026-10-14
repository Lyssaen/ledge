import { describe, it, expect } from 'vitest';
import { parseReply, kindOf } from '../src/reply/parse';

const report = `## Three reducer findings fixed, transitions covered by a table test

Steps 1 to 6 of the plan are done and green. I stopped before the soak because it needs the daemon running for an hour.

### What I did

- Transition table test, 63 cases, all green \`src/daemon/state.test.ts\`
- [x] No double entry into waiting_permission, hook beats pane
  - The richer \`pending\` wins; it now carries \`source\` and \`tool\`.
- exited is terminal, pending cleared on SessionEnd and PaneGone

### Verified

- \`pnpm test --filter ledge\`: 112 passed, 4.8s
- \`pnpm typecheck\`: clean

\`\`\`sh
pnpm test --filter ledge
\`\`\`

### Open question

PaneGone fires 2s after tmux loses the pane. Should a session that comes back inside that window keep its pending item or start clean?

- Keep it
- Start clean

### Next steps

1. Step 7, the one-hour soak, once you answer.
2. Step 8, the adapter contract in \`docs/adapters.md\`.
`;

describe('parseReply', () => {
  it('reads the title, the lead and the sections of a structured report', () => {
    const d = parseReply(report);
    expect(d.structured).toBe(true);
    expect(d.title).toBe('Three reducer findings fixed, transitions covered by a table test');
    expect(d.lead).toMatch(/^Steps 1 to 6 of the plan/);
    expect(d.sections.map(s => [s.kind, s.title])).toEqual([
      ['done', 'What I did'], ['verified', 'Verified'], ['questions', 'Open question'], ['next', 'Next steps']
    ]);
  });
  it('keeps list items with their sub-items, checkboxes and code', () => {
    const d = parseReply(report);
    const done = d.sections[0]!.blocks[0]!;
    expect(done.type).toBe('list');
    if (done.type !== 'list') return;
    expect(done.ordered).toBe(false);
    expect(done.items.map(i => i.text)).toEqual([
      'Transition table test, 63 cases, all green `src/daemon/state.test.ts`',
      'No double entry into waiting_permission, hook beats pane',
      'exited is terminal, pending cleared on SessionEnd and PaneGone'
    ]);
    expect(done.items[1]!.checked).toBe(true);
    expect(done.items[1]!.sub).toEqual(['The richer `pending` wins; it now carries `source` and `tool`.']);
    const verified = d.sections[1]!.blocks;
    expect(verified[1]).toEqual({ type: 'code', text: 'pnpm test --filter ledge' });
    const next = d.sections[3]!.blocks[0]!;
    expect(next.type === 'list' && next.ordered).toBe(true);
  });
  it('turns a paragraph ending with ? into a question, the list under it into its options', () => {
    const d = parseReply(report);
    expect(d.questions).toEqual([{ text: 'PaneGone fires 2s after tmux loses the pane. Should a session that comes back inside that window keep its pending item or start clean?', options: ['Keep it', 'Start clean'] }]);
    const q = d.sections[2]!;
    expect(q.blocks).toHaveLength(1); // the options list was consumed by the question
    expect(q.blocks[0]).toMatchObject({ type: 'p', q: 0 });
  });
  it('reads "A or B?" and "A ou B ?" as two options; a bare question has none', () => {
    const d = parseReply('Before I start: per screen id or derived from the work area?\n\nShall I keep the old flag?\n\nStocker par écran ou dériver de la zone de travail ?');
    expect(d.questions).toEqual([
      { text: 'Before I start: per screen id or derived from the work area?', options: ['per screen id', 'derived from the work area'] },
      { text: 'Shall I keep the old flag?', options: [] },
      { text: 'Stocker par écran ou dériver de la zone de travail ?', options: ['Stocker par écran', 'dériver de la zone de travail'] }
    ]);
    expect(d.structured).toBe(true);
  });
  it('numbers list-item questions and takes their sub-items as options', () => {
    const d = parseReply('Three things to settle:\n\n1. Where does the size live?\n   - Stored per screen\n   - Derived\n2. Linked or independent?\n3. What about the old value?');
    expect(d.questions.map(q => q.options)).toEqual([['Stored per screen', 'Derived'], ['Linked', 'independent'], []]);
    expect(d.title).toBeUndefined(); // "Three things to settle:" introduces the list, it is not a title
    expect(d.sections[0]!.blocks[0]).toEqual({ type: 'p', text: 'Three things to settle:' });
    const list = d.sections[0]!.blocks[1]!;
    expect(list.type === 'list' && list.items.map(i => i.q)).toEqual([0, 1, 2]);
  });
  it('a short first line followed by more content is the title; a one-liner stays a paragraph', () => {
    const d = parseReply('Done, the tests pass.\n\nI changed `a.ts` and `b.ts`.\n\n- a.ts: the fix\n- b.ts: its test');
    expect(d.title).toBe('Done, the tests pass.');
    expect(d.lead).toBe('I changed `a.ts` and `b.ts`.');
    const one = parseReply('I created the folder as asked.');
    expect(one.title).toBeUndefined();
    expect(one.structured).toBe(false);
    expect(one.sections).toEqual([{ kind: 'other', blocks: [{ type: 'p', text: 'I created the folder as asked.' }] }]);
  });
  it('bold-only lines are headings; rules and blank runs are dropped; fences keep their text verbatim', () => {
    const d = parseReply('**Résultat**\n\nTout passe.\n\n---\n\n**À faire ensuite :**\n\n- relancer le soak\n\n```\n  indented\n\nkept\n```');
    expect(d.title).toBe('Résultat');
    expect(d.lead).toBe('Tout passe.');
    expect(d.sections.map(s => [s.kind, s.title])).toEqual([['next', 'À faire ensuite']]);
    expect(d.sections[0]!.blocks[1]).toEqual({ type: 'code', text: '  indented\n\nkept' });
  });
  it('never reads a question mark inside a code block as a question', () => {
    const d = parseReply('Ran it:\n\n```\nproceed? y\n```\n\nAll good.');
    expect(d.questions).toEqual([]);
  });
  it('classifies headings in both languages', () => {
    expect(kindOf('Ce que j’ai fait')).toBe('done');
    expect(kindOf('Changes')).toBe('done');
    expect(kindOf('Vérifié')).toBe('verified');
    expect(kindOf('Tests')).toBe('verified');
    expect(kindOf('Questions ouvertes')).toBe('questions');
    expect(kindOf('To decide')).toBe('questions');
    expect(kindOf('Reste à faire')).toBe('next');
    expect(kindOf('Follow-ups')).toBe('next');
    expect(kindOf('Context')).toBe('other');
  });
  it('reads a pipe table into a header and rows; cells keep inline markdown and escaped pipes', () => {
    const d = parseReply('Results\n\n| Suite | Result |\n|:---|---:|\n| overlay typecheck + `vitest` | pass |\n| a \\| b | 507 tests, 17 files, pass |\n\nDone.');
    expect(d.title).toBe('Results');
    expect(d.sections[0]!.blocks[0]).toEqual({ type: 'table', header: ['Suite', 'Result'], rows: [['overlay typecheck + `vitest`', 'pass'], ['a | b', '507 tests, 17 files, pass']], align: ['left', 'right'] });
    expect(d.sections[0]!.blocks[1]).toEqual({ type: 'p', text: 'Done.' });
    expect(d.structured).toBe(true);
  });
  it('a pipe line without a separator under it stays prose; a short row is padded, a long one is cut', () => {
    expect(parseReply('a | b\nc').sections[0]!.blocks[0]).toEqual({ type: 'p', text: 'a | b c' });
    const d = parseReply('| x | y |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |');
    expect(d.sections[0]!.blocks[0]).toEqual({ type: 'table', header: ['x', 'y'], rows: [['1', ''], ['2', '3']], align: ['left', 'left'] });
  });
  it('quoted lines become a quote block with their own paragraphs and lists; a heading inside reads as a paragraph', () => {
    const d = parseReply('Note\n\n> Première ligne\n> suite\n>\n> - a\n> - b\n\nAprès.');
    expect(d.sections[0]!.blocks[0]).toEqual({ type: 'quote', blocks: [{ type: 'p', text: 'Première ligne suite' }, { type: 'list', ordered: false, items: [{ text: 'a', sub: [] }, { text: 'b', sub: [] }] }] });
    expect(d.sections[0]!.blocks[1]).toEqual({ type: 'p', text: 'Après.' });
    expect(parseReply('> ## Titre\n> texte').sections[0]!.blocks[0]).toEqual({ type: 'quote', blocks: [{ type: 'p', text: 'Titre' }, { type: 'p', text: 'texte' }] });
    expect(parseReply('> Vraiment ?').questions).toHaveLength(0);
  });
  it('the separator sets each column alignment', () => {
    expect(parseReply('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |').sections[0]!.blocks[0]).toMatchObject({ type: 'table', align: ['left', 'center', 'right', 'left'] });
  });
  it('is safe on empty or odd input', () => {
    expect(parseReply('').sections).toEqual([]);
    expect(parseReply('   \n\n').structured).toBe(false);
    expect(parseReply('```\nunclosed fence').sections[0]!.blocks[0]).toEqual({ type: 'code', text: 'unclosed fence' });
  });
});
