import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  it('a proposed plan reads its "Changes" and "Check" as what is to do, never as done or verified', () => {
    const plan = '# Add a README\n\n## Changes\n\n- Add README.md\n\n## Check\n\n- It renders\n\n## Open questions\n\nWhich title?';
    expect(parseReply(plan).sections.map(s => s.kind)).toEqual(['done', 'verified', 'questions']);
    expect(parseReply(plan, { plan: true }).sections.map(s => s.kind)).toEqual(['other', 'other', 'questions']);
  });
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
  describe('options with a description', () => {
    const q = (list: string) => parseReply(`Quelle base ?\n\n${list}`).questions[0]!;
    it('a bold opening is the label, what follows its description (dash, colon or nothing between)', () => {
      expect(q('- **PostgreSQL** — robuste, mais demande un serveur\n- **SQLite**: zéro infra\n- **DynamoDB** managé AWS\n- **Aucune**')).toEqual({
        text: 'Quelle base ?', options: ['PostgreSQL', 'SQLite', 'DynamoDB', 'Aucune'], details: ['robuste, mais demande un serveur', 'zéro infra', 'managé AWS', '']
      });
    });
    it('a long description keeps the options: only the label counts against the length cap', () => {
      const long = 'relationnelle robuste (transactions, jointures, JSONB), mais demande un serveur à provisionner, superviser et maintenir';
      expect(q(`- **PostgreSQL** — ${long}\n- **SQLite** — fichier embarqué`)).toMatchObject({ options: ['PostgreSQL', 'SQLite'], details: [long, 'fichier embarqué'] });
      expect(q(`- PostgreSQL ${long}\n- SQLite`).options).toEqual([]); // no label to cut out: too long, plain text
    });
    it('a plain separator splits only when every item has the same one', () => {
      expect(q('- Backfill — copies the history\n- Shadow table — writes twice')).toEqual({ text: 'Quelle base ?', options: ['Backfill', 'Shadow table'], details: ['copies the history', 'writes twice'] });
      expect(q('- Keep: the cache\n- Drop: it')).toMatchObject({ options: ['Keep', 'Drop'], details: ['the cache', 'it'] });
      expect(q('- Option: keep the cache\n- Start clean')).toEqual({ text: 'Quelle base ?', options: ['Option: keep the cache', 'Start clean'] });
      expect(q('- A — one\n- B: two')).toEqual({ text: 'Quelle base ?', options: ['A — one', 'B: two'] });
      expect(q('- per-screen\n- work-area')).toEqual({ text: 'Quelle base ?', options: ['per-screen', 'work-area'] });
    });
    it('sub-items of a list-item question split the same way', () => {
      const d = parseReply('1. Where does the size live?\n   - **Per screen** — stored by id\n   - **Derived** — from the work area');
      expect(d.questions[0]).toEqual({ text: 'Where does the size live?', options: ['Per screen', 'Derived'], details: ['stored by id', 'from the work area'] });
    });
  });
  describe('real agent replies (fixtures)', () => {
    const fixture = (name: string) => parseReply(readFileSync(join(__dirname, 'fixtures/replies', `${name}.md`), 'utf8'));
    it('numbered headings are the options of the "which one" question after them; the recommendation marks one', () => {
      const d = fixture('claude-storage-headings');
      expect(d.questions).toHaveLength(1);
      expect(d.questions[0]).toMatchObject({
        text: expect.stringMatching(/^\*\*Laquelle préférez-vous \?\*\*/),
        options: ['PostgreSQL', 'MongoDB', 'DynamoDB', 'SQLite', 'En mémoire ou fichier JSON'],
        recommended: 0
      });
      expect(d.questions[0]!.details!.slice(0, 2)).toEqual(['base relationnelle', 'base documentaire']);
    });
    it('numbered bold lines are options too; an enumeration after a colon offers its items, a lone "ou" none', () => {
      const d = fixture('claude-auth-bold-paragraphs');
      expect(d.questions.map(q => q.options)).toEqual([
        ['Clé d\'API statique', 'JWT validé par un fournisseur d\'identité existant', 'OAuth2 Client Credentials', 'Authentification gérée par le service lui-même', 'mTLS ou authentification déléguée à la passerelle'],
        [],
        ['analyse', 'plan', 'implémentation', 'tests', 'revue', 'correction']
      ]);
      expect(d.questions[0]!.details![0]).toBe('header X-API-Key');
      expect(d.questions[0]!.recommended).toBeUndefined(); // the recommendation names none of the labels
    });
    it('lettered choices: options in order, ★ recommends, a parenthesis describes, the bold opening names the question', () => {
      const d = fixture('claude-decisions-lettered');
      const by = (ref: string) => d.questions.find(q => q.ref === ref)!;
      expect(by('Framework HTTP')).toEqual({
        text: '**Framework HTTP**', ref: 'Framework HTTP', options: ['Express', 'Fastify', 'NestJS'], details: ['même socle que vos autres services', '', ''], recommended: 0
      });
      // A continuation line, an "a)" inside option b, a sentence after the last option, a question in an aside.
      expect(by('Conventions').options).toEqual(['oui, via le scaffolder officiel', 'oui, mais écrites à la main', 'non, structure libre']);
      expect(by('Périmètre des endpoints pour cette première itération').options[1]).toBe('a) + liste paginée et filtrée');
      expect(by('Base locale pour le dev et les tests')).toMatchObject({ options: ['Postgres via docker compose', 'une base existante', 'pas de base'], details: ['', 'dev partagée ?', 'repository mocké'] });
      expect(by('Base locale pour le dev et les tests').recommended).toBeUndefined();
      expect(by('Tests').options).toEqual(['mocha + nyc', 'vitest', 'jest']);
      // Items without letters stay open questions.
      expect(d.questions.filter(q => !q.ref).map(q => q.options)).toEqual([[], []]);
      expect(d.questions).toHaveLength(16);
    });
    it('a numbered list of bold options feeds the "which option" item below it; "option 1" in the advice recommends', () => {
      const d = fixture('claude-search-numbered-list');
      expect(d.questions[0]).toMatchObject({
        text: 'Quelle option retenez-vous, parmi les quatre ci-dessus ?',
        options: ['Balayage direct, sans index', 'Index inversé en pur JavaScript', 'SQLite avec FTS5', 'Délégation à ripgrep'],
        recommended: 0
      });
      expect(d.questions[0]!.details![0]).toMatch(/^Au moment de search, lire tous les fichiers .*régulière\.$/); // the first sentence only
      expect(d.questions[1]!.options).toEqual([]); // "comme…, dois-je… (`add`, `list`, …), ou existe-t-il…": clauses, not options
    });
    it('a bold item may go on after its "?"; "A, ou B" keeps both sides', () => {
      const d = fixture('claude-cache-bold-items');
      expect(d.questions).toHaveLength(9);
      expect(d.questions.find(q => q.text.startsWith('**Déploiement**'))!.options).toEqual(['une seule instance', 'plusieurs répliques (Kubernetes)']);
      expect(d.questions.find(q => q.text.startsWith('**Panne'))!.options).toEqual(['servir une valeur périmée', 'renvoyer une erreur']);
      expect(d.questions.filter(q => q.options.length).length).toBe(3); // with the objective; the open questions stay open
    });
    it('decision axes: a bold item whose sub-items are options, the "my recommendation" sub-item marking one', () => {
      const d = fixture('claude-config-axes');
      expect(d.questions.map(q => [q.ref, q.options, q.recommended])).toEqual([
        ['Format du fichier', ['YAML', 'TOML', 'JSON'], 0],
        ['Emplacement et découverte', ['Fichier de projet', 'Fichier utilisateur', 'Les deux'], 0],
        ['Devenir des flags et ordre de priorité', ['Fichier seul', 'Fichier avec surcharge', 'Transition'], 1], // "Ma recommandation : B."
        ['Bibliothèque', ['Stdlib flag + parseur du format', 'koanf', 'cobra + viper'], 0], // "stdlib si…, koanf si…"
        ['Environnements multiples', ['Un seul fichier plat', 'Des profils nommés (staging, prod) dans le même fichier, sélectionnés par --env', 'Un fichier par environnement (deploy.staging.yaml)'], undefined]
      ]);
      expect(d.questions[1]!.details![2]).toBe('fusionnés (utilisateur puis projet).');
      // The sub-items that are not options stay with the question: the recommendation, a remark.
      const items = d.sections.flatMap(s => s.blocks).flatMap(b => (b.type === 'list' ? b.items : []));
      expect(items.find(it => it.q === 1)!.sub).toEqual([
        'Dans tous les cas un flag `--config <chemin>` pour forcer un fichier.',
        'Ma recommandation : fichier de projet seul, plus `--config`. On ajoutera la couche utilisateur si un besoin réel apparaît.'
      ]);
    });
  });
  it('"A or B" needs short sides: a sentence or a long clause on either side gives no options', () => {
    const opts = (q: string) => parseReply(q).questions[0]!.options;
    expect(opts('Tu préfères Postgres, MySQL ou SQLite ?')).toEqual(['Tu préfères Postgres', 'MySQL', 'SQLite']);
    expect(opts('Base : Postgres, MySQL ou SQLite ?')).toEqual(['Postgres', 'MySQL', 'SQLite']);
    expect(opts('J\'ai lu le module. Tu veux que je garde le cache ou que je reparte de zéro ?')).toEqual([]);
    expect(opts('Quelle est la référence (ex. ABC-123), ou s\'agit-il d\'un travail hors ticket, sans suivi particulier ni rattachement ?')).toEqual([]);
  });
  it('a paragraph opening on a bold question asks it; "which one" with nothing numbered above has no options', () => {
    const d = parseReply('**Laquelle préférez-vous ?** Dites-moi aussi le volume attendu.');
    expect(d.questions).toEqual([{ text: '**Laquelle préférez-vous ?** Dites-moi aussi le volume attendu.', options: [] }]);
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
