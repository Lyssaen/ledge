import { describe, it, expect } from 'vitest';
import type { ChatAction, ChatTurn, ClientMessage } from '@ledge/protocol';
import { daemonStore } from '@ledge/fleet';
import { until } from './helpers.js';
import { mockupSessions, PROJECTS, startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const T = (s: number) => new Date(Date.parse('2026-10-09T18:00:00.000Z') + s * 1000).toISOString();
const ESC = '\u001b';

describe('ledge tui: session', () => {
  it('asks for the thread, shows it, and sends a reply typed after r', async () => {
    const bix = mockupSessions()[2]!;
    const tui = await startTui();
    tui.daemon.thread('bix', [
      { kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Documente le protocole' },
      { kind: 'tool', id: 't1', at: T(1), turn: 1, tool: 'Edit', label: 'docs/protocol.md', status: 'success', durationMs: 300, files: [] },
      { kind: 'reply', id: 'r1', at: T(2), turn: 1, text: 'Section Protocol mise à jour.' }
    ]);
    try {
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('BIX · DOCUMENTER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('Section Protocol mise à jour.'));
      expect(sent(tui.daemon.received, 'session.thread')).toEqual([{ type: 'session.thread', id: 'bix' }]);
      expect(tui.frame()).toMatch(/✓ Edit +docs\/protocol\.md/);
      await tui.press('r');
      await tui.press('Ajoute un exemple');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]).toEqual({ type: 'session.reply', id: 'bix', text: 'Ajoute un exemple' });
      tui.daemon.upsert({ ...bix, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
    } finally { await tui.cleanup(); }
  });

  it('r on a permission explains a refusal to the agent', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r');
      await tui.press('Lance seulement le test de la liste');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.decide').length === 1);
      expect(sent(tui.daemon.received, 'session.decide')[0]).toMatchObject({ id: 'otto', decision: 'deny', note: 'Lance seulement le test de la liste' });
    } finally { await tui.cleanup(); }
  });

  it('a reply longer than the field shows its end, where the cursor is', async () => {
    const tui = await startTui();
    try {
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('BIX · DOCUMENTER'));
      await tui.press('\r');
      await tui.press('r');
      await tui.press(`${'d'.repeat(150)}FIN`);
      await until(() => tui.frame().includes('dFIN'));
    } finally { await tui.cleanup(); }
  });

  it('m changes the model of a running session', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('m');
      await until(() => sent(tui.daemon.received, 'models.list').length === 1);
      const ask = sent(tui.daemon.received, 'models.list')[0]!;
      tui.daemon.push({ type: 'models.listing', requestId: ask.requestId, tool: 'claude', models: [{ id: 'opus', label: 'Opus', efforts: ['low', 'high'] }, { id: 'sonnet', label: 'Sonnet' }] });
      await until(() => tui.frame().includes('Sonnet'));
      await tui.press('\u001b[B\u001b[B'); // ↓ ↓ : par défaut → Opus → Sonnet
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.model').length === 1);
      expect(sent(tui.daemon.received, 'session.model')[0]).toEqual({ type: 'session.model', id: 'otto', model: 'sonnet', effort: null });
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: the session thread (#95 lot A)', () => {
  const many = (n: number) => [
    { kind: 'prompt' as const, id: 'p1', at: T(0), turn: 1, text: 'Relis tout' },
    ...Array.from({ length: n }, (_, i) => ({ kind: 'tool' as const, id: `t${i}`, at: T(1 + i), turn: 1, tool: 'Read', label: `src/fichier-${i}.ts`, status: 'success' as const, durationMs: 100, files: [] }))
  ];
  const openBix = async (tui: Awaited<ReturnType<typeof startTui>>) => {
    await tui.press('j'); await tui.press('j');
    await until(() => tui.frame().includes('BIX · DOCUMENTER'));
    await tui.press('\r');
    await until(() => tui.frame().includes('fichier-'));
  };

  it('says in the bottom border what is above, then what is below once scrolled; new lines keep the view, G follows again', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', many(40));
    try {
      await openBix(tui);
      await until(() => /↑ \d+ plus haut ─╯/.test(tui.frame()));
      await tui.press('k'); await tui.press('k'); await tui.press('k');
      await until(() => /↑ \d+ plus haut · ↓ 3 · G fin/.test(tui.frame()));
      const top = tui.frame().match(/fichier-\d+/)![0];
      tui.daemon.threadItem('bix', { kind: 'tool', id: 'new', at: T(60), turn: 1, tool: 'Read', label: 'src/nouveau.ts', status: 'success', durationMs: 100, files: [] });
      await until(() => /↓ 4 · G fin/.test(tui.frame()));
      expect(tui.frame().match(/fichier-\d+/)![0]).toBe(top);
      await tui.press('G');
      await until(() => tui.frame().includes('nouveau.ts') && /↑ \d+ plus haut ─╯/.test(tui.frame()));
    } finally { await tui.cleanup(); }
  });

  it('a resize keeps the element being read at the top', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Relis tout' },
      ...Array.from({ length: 30 }, (_, i) => ({ kind: 'message' as const, id: `m${i}`, at: T(1 + i), turn: 1, text: `Message ${i} : ${'des mots qui se replient selon la largeur '.repeat(2)}fin` }))]);
    try {
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('BIX · DOCUMENTER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('Message 29'));
      for (let i = 0; i < 12; i++) await tui.press('k');
      const first = () => tui.frame().split('\n').find(l => /Message \d+/.test(l))?.match(/Message \d+/)?.[0];
      const before = first();
      await tui.resize(70, 30);
      await until(() => first() === before);
      await tui.resize(100, 30);
      await until(() => first() === before);
    } finally { await tui.cleanup(); }
  });

  it('below 60×16 says the window is too small, who waits and that the draft is kept; the draft is still there after', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press('Pas ce test');
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite : 52×14'));
      expect(tui.frame()).toContain('il faut au moins 60×16');
      expect(tui.frame()).toContain('Otto attend ton accord · brouillon gardé');
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('Pas ce test'));
    } finally { await tui.cleanup(); }
  });

  it('below 60×16, a question waiting says so, not « attend ton accord »', async () => {
    const [otto, ...rest] = mockupSessions();
    const tui = await startTui({ sessions: [{ ...otto!, state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } }, ...rest] });
    try {
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite'));
      expect(tui.frame()).toContain('Otto a une question');
    } finally { await tui.cleanup(); }
  });

  it('below 60×16 the screen keys do nothing: the request is not in view; esc and q still work', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite'));
      for (const k of ['y', 'n', 'A', '1', 'i', 'a']) await tui.press(k);
      await new Promise(r => setTimeout(r, 100));
      expect(tui.daemon.received.filter(m => m.type === 'session.decide' || m.type === 'session.interrupt')).toEqual([]);
      expect(runs).toEqual([]);
      await tui.press('\u001b');
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('PROJETS'));
    } finally { await tui.cleanup(); }
  });

  it('at 60×16 a four-line request keeps the field whole: the request, then the field, the thread takes what is left', async () => {
    const long = `rm -rf coverage node_modules/.vite && ${'pnpm --filter @ledge/ledge test -- --run --coverage --reporter=verbose && '.repeat(4)}echo fin`;
    const otto = mockupSessions()[0]!;
    const tui = await startTui({ sessions: [{ ...otto, pending: { ...otto.pending!, text: long } }, ...mockupSessions().slice(1)] });
    try {
      await tui.resize(60, 16);
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter (Bash) :'));
      const read = tui.frame().split('\n');
      expect(read.length).toBe(16);
      expect(read.filter(l => /^│ {3}\S/.test(l)).length).toBe(4);
      const write = read.findIndex(l => l.includes('ÉCRIRE'));
      expect(write).toBeGreaterThan(-1);
      expect(read[write + 1]).toContain('Répondre à Otto');
      expect(read[write + 2]).toMatch(/^╰─+╯$/);
      await tui.press('r');
      await until(() => tui.frame().includes('REFUSER EN EXPLIQUANT'));
      const reply = tui.frame().split('\n');
      expect(reply.length).toBe(16);
      expect(reply.filter(l => /^│ {3}\S/.test(l)).length).toBe(4);
      const field = reply.findIndex(l => l.includes('REFUSER EN EXPLIQUANT'));
      expect(reply[field + 1]).toContain('❯');
      // The field one line high, the thread has the rows left.
      expect(reply.some(l => l.includes('OTTO · CÂBLER'))).toBe(true);
    } finally { await tui.cleanup(); }
  });

  it('the request folds under an indent, four lines at most; the key bar drops keys from the end and keeps « ? aide »; the crumb shortens', async () => {
    const long = `rm -rf coverage node_modules/.vite && ${'pnpm --filter @ledge/ledge test -- --run --coverage --reporter=verbose && '.repeat(4)}echo fin`;
    const otto = mockupSessions()[0]!;
    const tui = await startTui({ sessions: [{ ...otto, pending: { ...otto.pending!, text: long } }, ...mockupSessions().slice(1)] });
    try {
      await tui.resize(64, 30);
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter (Bash) :'));
      const box = tui.frame().split('\n').filter(l => /^│ {3}\S/.test(l));
      expect(box.length).toBe(4);
      expect(box[3]).toMatch(/… \+\d+ +│$/);
      const bar = tui.frame().split('\n').at(-1)!;
      expect(bar).toMatch(/\? +aide/);
      expect(bar).not.toContain('interrompre');
      expect(tui.frame().split('\n')[0]).not.toContain('release/LEDGE-42');
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: ask Ledge', () => {
  it('sends the question, streams the answer and launches the card’s session on ↵', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · OPÉRATEUR · VOIT 4 SESSIONS'));
      await tui.press('Qui a besoin de moi ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      const { qid } = sent(tui.daemon.received, 'chat.ask')[0]!;
      expect(sent(tui.daemon.received, 'chat.ask')[0]!.text).toBe('Qui a besoin de moi ?');
      tui.daemon.push({ type: 'chat.step', qid, step: { kind: 'sessions' } });
      tui.daemon.push({ type: 'chat.delta', qid, text: 'Otto attend ton accord.' });
      await until(() => tui.frame().includes('Otto attend ton accord.'));
      tui.daemon.push({ type: 'chat.done', qid, text: 'Otto attend ton accord. Je peux lancer une session.', at: T(9), proposals: [{ cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Corrige les tests de l’overlay' }] });
      await until(() => tui.frame().includes('Corrige les tests de l’overlay'));
      await tui.press('\t');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      expect(sent(tui.daemon.received, 'session.launch')[0]).toMatchObject({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', rows: [0] });
    } finally { await tui.cleanup(); }
  });

  it('a question longer than the field shows its end, where the cursor is', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press(`${'q'.repeat(150)}FIN`);
      await until(() => tui.frame().includes('qFIN'));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: the action card (#94, docs/mockups/ledge-action-card.html, view TUI)', () => {
  // Today's: the fleet keeps the day's conversation only.
  const NOW = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const AT = NOW(30);
  const row = (action: string, extra: Partial<ChatAction> = {}): ChatAction => ({ action, args: {}, summary: action, risk: 'reversible', ...extra });
  const plan = (states: Array<Partial<ChatAction>> = [{}, {}, {}]): ChatAction[] => [
    row('session.model', { vars: { session: 'Nova', model: 'Opus 5.5', effort: 'élevé' }, session: 'nova', ...states[0] }),
    row('session.archive', { vars: { session: 'Otto' }, session: 'otto', ...states[1] }),
    row('team.dissolve', { risk: 'destructive', vars: { team: 'ledge-roles' }, detail: 'Ses 6 sessions retournent à la table commune.', ...states[2] })
  ];
  const decide = (extra: Partial<ChatAction> = {}) => row('session.decide', { risk: 'destructive', session: 'nova', detail: 'rm -rf packages/ledge/dist', vars: { session: 'Nova', decision: 'accept', kind: 'permission' }, ...extra });
  const turn = (actions: ChatAction[], extra: Partial<ChatTurn> = {}): ChatTurn => ({ qid: 'q1', question: 'Range tout', askedAt: NOW(1), answeredAt: NOW(2), answer: 'Voici le plan.', steps: [], actions, ...extra });
  /** The Ask screen with this turn in the conversation, the card focused (tab). */
  async function ask(t: ChatTurn) {
    const tui = await startTui();
    await tui.press('/');
    await until(() => tui.frame().includes('LEDGE · OPÉRATEUR'));
    tui.daemon.push({ type: 'chat.history', turns: [t] });
    await until(() => tui.frame().includes('Voici le plan.'));
    await tui.press('\t');
    return tui;
  }

  it('a plan: numbered rows, their risk in words; ↵ applies the line, ↓ moves, a asks to confirm in the card, y confirms, ↵ never does', async () => {
    const tui = await ask(turn(plan()));
    try {
      await until(() => tui.frame().includes('PLAN · 3 ACTIONS'));
      expect(tui.frame()).toContain('1 ○ Passer Nova sur Opus 5.5, effort élevé');
      expect(tui.frame()).toContain('3 ○ Dissoudre l’équipe ledge-roles');
      expect(tui.frame()).toContain('irréversible');
      expect(tui.frame()).toContain('Ses 6 sessions retournent à la table commune.');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 1);
      expect(sent(tui.daemon.received, 'chat.act')[0]).toMatchObject({ qid: 'q1', rows: [0] });
      expect(sent(tui.daemon.received, 'chat.act')[0]).not.toHaveProperty('confirmed');
      // The daemon answers with the day's history: the card is free again.
      tui.daemon.push({ type: 'chat.history', turns: [turn(plan())] });
      await new Promise(r => setTimeout(r, 50));
      await tui.press('a');
      await until(() => tui.frame().includes('CONFIRMER · 3 ACTIONS, 1 IRRÉVERSIBLE'));
      expect(tui.frame()).toContain('╔');
      await tui.press('\r');
      expect(sent(tui.daemon.received, 'chat.act')).toHaveLength(1);
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 2);
      expect(sent(tui.daemon.received, 'chat.act')[1]).toMatchObject({ qid: 'q1', rows: [0, 1, 2], confirmed: true });
    } finally { await tui.cleanup(); }
  });

  it('esc cancels a confirmation without sending; ↓ then ↵ on an irreversible row asks for it alone', async () => {
    const tui = await ask(turn(plan()));
    try {
      await until(() => tui.frame().includes('PLAN · 3 ACTIONS'));
      await tui.press(DOWN); await tui.press(DOWN);
      await tui.press('\r');
      await until(() => tui.frame().includes('CONFIRMER · DISSOUDRE L’ÉQUIPE LEDGE-ROLES'));
      await tui.press('\u001b');
      await until(() => tui.frame().includes('PLAN · 3 ACTIONS'));
      expect(sent(tui.daemon.received, 'chat.act')).toEqual([]);
      expect(sent(tui.daemon.received, 'chat.ignore')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('a failed step says why and offers to retry; the rows after it are not applied', async () => {
    const tui = await ask(turn(plan([{ state: 'done', doneAt: AT }, { state: 'failed', code: 'failed' }, {}])));
    try {
      await until(() => tui.frame().includes('Échec : l’action est partie, mais n’a pas abouti.'));
      expect(tui.frame()).toContain('pas appliquée');
      expect(tui.frame()).toContain('Réessayer');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 1);
      expect(sent(tui.daemon.received, 'chat.act')[0]).toMatchObject({ rows: [1] });
    } finally { await tui.cleanup(); }
  });

  it('a permission: its request quoted; n denies at once, ↵ asks to confirm the acceptance', async () => {
    const tui = await ask(turn([decide()]));
    try {
      await until(() => tui.frame().includes('PERMISSION · NOVA'));
      expect(tui.frame()).toContain('rm -rf packages/ledge/dist');
      await tui.press('n');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 1);
      expect(sent(tui.daemon.received, 'chat.act')[0]).toMatchObject({ qid: 'q1', rows: [0], deny: true });
      tui.daemon.push({ type: 'chat.history', turns: [turn([decide()])] });
      await new Promise(r => setTimeout(r, 50));
      await tui.press('\r');
      await until(() => tui.frame().includes('CONFIRMER · ACCEPTER LA DEMANDE DE PERMISSION DE NOVA'));
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 2);
      expect(sent(tui.daemon.received, 'chat.act')[1]).toMatchObject({ rows: [0], confirmed: true });
    } finally { await tui.cleanup(); }
  });

  it('a request shown cut: marked, never accepted from the card; o opens the session, n still denies', async () => {
    const tui = await ask(turn([decide({ detail: 'ligne\n'.repeat(20) + 'fin…', detailCut: true })]));
    try {
      await until(() => tui.frame().includes('… (tronqué, voir la session : o)'));
      expect(tui.frame()).toContain('coupée');
      await tui.press('\r');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'chat.act')).toEqual([]);
      await tui.press('n');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 1);
      expect(sent(tui.daemon.received, 'chat.act')[0]).toMatchObject({ rows: [0], deny: true });
      await tui.press('o');
      await until(() => tui.frame().includes('NOVA · RECONNEXION SSH DU FLEET'));
    } finally { await tui.cleanup(); }
  });

  it('esc ignores the card everywhere; a faded line stays; ctrl+r opens it again, focused', async () => {
    const tui = await ask(turn(plan()));
    try {
      await until(() => tui.frame().includes('PLAN · 3 ACTIONS'));
      await tui.press('\u001b');
      await until(() => sent(tui.daemon.received, 'chat.ignore').length === 1);
      expect(sent(tui.daemon.received, 'chat.ignore')[0]).toEqual({ type: 'chat.ignore', qid: 'q1' });
      tui.daemon.push({ type: 'chat.history', turns: [turn(plan(), { ignoredAt: AT })] });
      await until(() => !tui.frame().includes('PLAN · 3 ACTIONS'));
      expect(tui.frame()).toContain('plan de 3 actions ignoré à');
      expect(tui.frame()).toContain('revoir : ctrl+r');
      // The bar says it too: the focus is back on the question.
      await until(() => /ctrl\+r\s+revoir/.test(tui.frame()));
      await tui.press('\u0012');
      await until(() => sent(tui.daemon.received, 'chat.ignore').length === 2);
      expect(sent(tui.daemon.received, 'chat.ignore')[1]).toEqual({ type: 'chat.ignore', qid: 'q1', undo: true });
      tui.daemon.push({ type: 'chat.history', turns: [turn(plan())] });
      await until(() => tui.frame().includes('PLAN · 3 ACTIONS'));
      // Focused: ↵ applies its line straight away.
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.act').length === 1);
    } finally { await tui.cleanup(); }
  });
});

const ALT_ENTER = '\u001b\r';
const CTRL = { left: '\u001b[1;5D', right: '\u001b[1;5C', a: '\u0001', e: '\u0005', w: '\u0017', u: '\u0015', j: '\n', n: '\u000e', c: '\u0003' };
const UP = '\u001b[A', DOWN = '\u001b[B', LEFT = '\u001b[D', DEL = '\u001b[3~';
const paste = (text: string) => `\u001b[200~${text}\u001b[201~`;
/** The rows of the box whose title is `title`, between its borders. */
const boxRows = (frame: string, title: string) => {
  const lines = frame.split('\n'), i = lines.findIndex(l => l.includes(title));
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (!l.startsWith('│')) break; out.push(l.replace(/^│ ?/, '').replace(/ ?│$/, '').trimEnd()); }
  return out;
};
const bottom = (frame: string, title: string) => { const lines = frame.split('\n'); return lines.slice(lines.findIndex(l => l.includes(title))).find(l => l.startsWith('╰')) ?? ''; };

describe('ledge tui: the field (#95 lot B)', () => {
  /** Bix's session open, its field open. */
  async function replying() {
    const tui = await startTui();
    await tui.press('j'); await tui.press('j');
    await until(() => tui.frame().includes('BIX · DOCUMENTER'));
    await tui.press('\r');
    await tui.press('r');
    await until(() => tui.frame().includes('RÉPONDRE À BIX'));
    return tui;
  }

  it('says whom one writes to; alt+↵ and ctrl+j add a line, ↵ sends the lines as they are', async () => {
    const tui = await replying();
    try {
      await tui.press('Oui, replie aussi les notices.'); await tui.press(ALT_ENTER);
      await tui.press('- garde DIFF_MAX'); await tui.press(CTRL.j);
      await tui.press('- ajoute un test');
      await until(() => tui.frame().includes('- ajoute un test'));
      expect(boxRows(tui.frame(), 'RÉPONDRE À BIX')).toEqual(['❯ Oui, replie aussi les notices.', '  - garde DIFF_MAX', '  - ajoute un test']);
      expect(bottom(tui.frame(), 'RÉPONDRE À BIX')).toContain('ligne 3/3 · alt+↵ nouvelle ligne');
      expect(tui.frame().split('\n').at(-1)).toMatch(/alt\+↵ +nouvelle ligne/);
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]!.text).toBe('Oui, replie aussi les notices.\n- garde DIFF_MAX\n- ajoute un test');
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
      // Where the terminal tells keys apart (kitty protocol): shift+↵ and ctrl+j.
      await tui.press('r'); await tui.press('un'); await tui.press('\u001b[13;2u'); await tui.press('deux'); await tui.press('\u001b[106;5u'); await tui.press('trois');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 2);
      expect(sent(tui.daemon.received, 'session.reply')[1]!.text).toBe('un\ndeux\ntrois');
    } finally { await tui.cleanup(); }
  });

  it('moves the cursor by character, word, line start and end, row; deletes forward, the word before, everything', async () => {
    const tui = await replying();
    try {
      await tui.press('garde DIFF_MAX à 30'); await tui.press(ALT_ENTER); await tui.press('ajoute un test');
      await tui.press(CTRL.left); await tui.press('vrai ');                  // ajoute un vrai test
      await tui.press(CTRL.a); await tui.press('+ ');                         // + ajoute un vrai test
      await tui.press(UP); await tui.press(CTRL.e); await tui.press(' lignes'); // garde DIFF_MAX à 30 lignes
      await tui.press(CTRL.w); await tui.press('lignes max');
      await tui.press(CTRL.a); await tui.press(DEL); await tui.press('G');   // Garde …
      await tui.press(DOWN); await tui.press(CTRL.e); await tui.press(LEFT); await tui.press(LEFT); await tui.press(LEFT); await tui.press(LEFT); await tui.press('!');
      await until(() => tui.frame().includes('+ ajoute un vrai !test'));
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]!.text).toBe('Garde DIFF_MAX à 30 lignes max\n+ ajoute un vrai !test');
      await tui.press('r'); await tui.press('à effacer'); await tui.press(CTRL.u);
      await until(() => !tui.frame().includes('à effacer'));
    } finally { await tui.cleanup(); }
  });

  it('a paste keeps its lines without sending; a long one shows in full and the field scrolls, 6 rows (8 in 120×32)', async () => {
    const lines = Array.from({ length: 14 }, (_, i) => `ligne ${i + 1} du log`);
    const tui = await replying();
    try {
      await tui.resize(80, 24);
      await tui.press(paste(lines.join('\r\n')));
      await until(() => tui.frame().includes('ligne 14 du log'));
      expect(sent(tui.daemon.received, 'session.reply')).toEqual([]);
      expect(tui.frame()).not.toContain('⏎');
      expect(boxRows(tui.frame(), 'RÉPONDRE À BIX')).toEqual(lines.slice(-6).map((l, i) => `${i === 0 ? '  ' : '  '}${l}`));
      expect(bottom(tui.frame(), 'RÉPONDRE À BIX')).toContain('↑ 8 lignes · 14 lignes collées');
      await tui.resize(120, 32);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX').length === 8);
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]!.text).toBe(lines.join('\n'));
    } finally { await tui.cleanup(); }
  });

  it('↑ goes back through what was asked, ↓ comes down to the draft as it was; esc goes back to it', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      for (const [i, q] of ['Qui travaille sur la TUI ?', 'Et les tests ?'].entries()) {
        await tui.press(q); await tui.press('\r');
        await until(() => sent(tui.daemon.received, 'chat.ask').length === i + 1);
        tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[i]!.qid, text: 'Oui.', at: T(i) });
        await until(() => !tui.frame().includes('Ledge lit…'));
      }
      await tui.press('Et Luna');
      await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et les tests ?');
      expect(bottom(tui.frame(), 'QUESTION')).toContain('historique 2/2 · ↓ ton brouillon');
      expect(tui.frame().split('\n').at(-1)).toMatch(/↵ +renvoyer.*esc +revenir au brouillon/);
      await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Qui travaille sur la TUI ?');
      await tui.press(DOWN); await tui.press(DOWN);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et Luna');
      expect(bottom(tui.frame(), 'QUESTION')).not.toContain('historique');
      await tui.press(UP); await tui.press(UP); await tui.press(ESC);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et Luna');
    } finally { await tui.cleanup(); }
  });

  it('a session keeps its replies: ↑ in an empty field brings the last one back', async () => {
    const tui = await replying();
    try {
      await tui.press('Ajoute un exemple'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      await tui.press('r'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Ajoute un exemple');
    } finally { await tui.cleanup(); }
  });

  it('the draft outlives esc, ctrl+c and another screen; read, it shows dimmed in « Écrire »', async () => {
    const tui = await replying();
    try {
      await tui.press('Pas ce test'); await tui.press(ALT_ENTER); await tui.press('ni celui-là');
      await tui.press(ESC);
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
      expect(tui.frame()).toContain('Brouillon gardé : r pour reprendre.');
      expect(boxRows(tui.frame(), 'ÉCRIRE · BROUILLON')).toEqual(['❯ Pas ce test']);
      expect(bottom(tui.frame(), 'ÉCRIRE · BROUILLON')).toContain('2 lignes · r pour reprendre');
      await tui.press(ESC);
      await until(() => !tui.frame().includes('ÉCRIRE · BROUILLON'));
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
      await tui.press('r');
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX').join('\n') === '❯ Pas ce test\n  ni celui-là');
      await tui.press(CTRL.c);
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
    } finally { await tui.cleanup(); }
  });

  it('r on a permission: « Refuser en expliquant à Otto »', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r');
      await until(() => tui.frame().includes('REFUSER EN EXPLIQUANT À OTTO'));
    } finally { await tui.cleanup(); }
  });

  it('ctrl+n asks first: n or esc keeps the conversation, y clears it; the draft stays', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Qui a besoin de moi ?'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, text: 'Otto.', at: T(1) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('Et Luna');
      await tui.press(CTRL.n);
      await until(() => tui.frame().includes('NOUVELLE CONVERSATION ?'));
      expect(tui.frame()).toMatch(/La conversation du jour \(1 question, depuis \d\d:\d\d\) sera effacée\. Ton brouillon reste\./);
      expect(tui.frame()).toMatch(/Garder.*n · esc/);
      await tui.press('n');
      await until(() => !tui.frame().includes('NOUVELLE CONVERSATION ?'));
      await tui.press(CTRL.n); await tui.press(ESC);
      await until(() => !tui.frame().includes('NOUVELLE CONVERSATION ?'));
      expect(sent(tui.daemon.received, 'chat.reset')).toEqual([]);
      expect(boxRows(tui.frame(), 'QUESTION')[0]).toBe('❯ Et Luna');
      await tui.press(CTRL.n); await tui.press('y');
      await until(() => sent(tui.daemon.received, 'chat.reset').length === 1);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et Luna');
    } finally { await tui.cleanup(); }
  });

  it('ctrl+c with a draft does not quit: it says so, and a second one within 2 s does', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Et Luna, elle');
      await tui.press(CTRL.c);
      await until(() => tui.frame().includes('Brouillon en cours : ctrl+c encore pour quitter quand même (il sera perdu).'));
      await tui.press(' attend');
      await until(() => tui.frame().includes('Et Luna, elle attend'));
      // Past 2 s the line goes, and ctrl+c asks again.
      await until(() => !tui.frame().includes('Brouillon en cours'), 3000);
      await tui.press(CTRL.c);
      await until(() => tui.frame().includes('Brouillon en cours'));
      await tui.press(CTRL.c);
      // Gone: what is typed goes nowhere.
      await tui.press(' quoi');
      expect(tui.frame()).not.toContain('attend quoi');
    } finally { await tui.cleanup(); }
  });

  it('the history leaves the draft alone: ctrl+c out of an entry, or that entry sent again, the draft is as it was', async () => {
    const tui = await replying();
    try {
      await tui.press('Ancienne réponse'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
      await tui.press('r'); await tui.press('Mon brouillon'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Ancienne réponse');
      await tui.press(CTRL.c);
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
      expect(boxRows(tui.frame(), 'ÉCRIRE · BROUILLON')).toEqual(['❯ Mon brouillon']);
      // The entry edited and sent again: the draft stays for later.
      await tui.press('r'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Ancienne réponse');
      await tui.press(' bis'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 2);
      expect(sent(tui.daemon.received, 'session.reply')[1]!.text).toBe('Ancienne réponse bis');
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
      expect(boxRows(tui.frame(), 'ÉCRIRE · BROUILLON')).toEqual(['❯ Mon brouillon']);
    } finally { await tui.cleanup(); }
  });

  it('an entry edited and refused at once (a reply still in flight): the field keeps it, edits and all; esc brings the draft back', async () => {
    const tui = await replying();
    try {
      await tui.press('Ancienne réponse'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      // Not landed yet: the next reply is refused.
      await tui.press('r'); await tui.press('Mon brouillon'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Ancienne réponse');
      await tui.press(' bis'); await tui.press('\r');
      await until(() => tui.frame().includes('Un envoi pour Bix est déjà en cours.'));
      expect(sent(tui.daemon.received, 'session.reply')).toHaveLength(1);
      expect(boxRows(tui.frame(), 'RÉPONDRE À BIX')[0]).toBe('❯ Ancienne réponse bis');
      await tui.press(ESC);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Mon brouillon');
    } finally { await tui.cleanup(); }
  });

  it('an entry sent again, refused later: the draft kept is not replaced', async () => {
    const tui = await replying();
    try {
      await tui.press('Ancienne réponse'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'idle', lastActivityAt: T(6) });
      await tui.press('r'); await tui.press('Mon brouillon'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Ancienne réponse');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 2);
      tui.daemon.refuse('session busy', 'bix', 'session.reply');
      await until(() => tui.frame().includes('session busy'));
      await tui.press('r');
      await until(() => tui.frame().includes('RÉPONDRE À BIX'));
      expect(boxRows(tui.frame(), 'RÉPONDRE À BIX')[0]).toBe('❯ Mon brouillon');
    } finally { await tui.cleanup(); }
  });

  it('a note past 4,000 characters is not sent and stays in the field, with why', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press(`${'n'.repeat(4000)}FIN`); await tui.press('\r');
      await until(() => tui.frame().includes('Note trop longue'));
      expect(tui.frame()).not.toContain('ne prend pas de note');
      expect(sent(tui.daemon.received, 'session.decide')).toEqual([]);
      expect(tui.frame()).toContain('nFIN');
    } finally { await tui.cleanup(); }
  });

  it('a reply typed, refused later: a draft typed since stays, the reply is one ↑ away', async () => {
    const tui = await replying();
    try {
      await tui.press('Première'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      await tui.press('r'); await tui.press('Nouveau brouillon');
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Nouveau brouillon');
      tui.daemon.refuse('session busy', 'bix', 'session.reply');
      await until(() => tui.frame().includes('session busy'));
      expect(boxRows(tui.frame(), 'RÉPONDRE À BIX')[0]).toBe('❯ Nouveau brouillon');
      await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ Première');
    } finally { await tui.cleanup(); }
  });

  it('a note refused at once says why as a reply would: offline first, « no note » only when the tool takes none', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press('non');
      tui.daemon.upsert({ ...mockupSessions()[0]!, offline: true });
      await until(() => daemonStore.getState().sessions.find(x => x.id === 'local:otto')?.offline === true);
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto est hors ligne.'));
      expect(tui.frame()).not.toContain('ne prend pas de note');
      expect(sent(tui.daemon.received, 'session.decide')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  // The other branches of the same answer: one test a row, the session changed (upsert) between the note and Enter.
  it.each([
    ['read only', { source: 'hook_only' as const }, 'Otto est en lecture seule : répondez dans son terminal.'],
    ['the request gone', { state: 'idle' as const, pending: undefined }, 'Rien à répondre pour Otto.'],
    ['a tool that takes no note', { tool: 'omp' as const }, 'Otto ne prend pas de note ici.']
  ])('a note refused at once: %s', async (_, change, why) => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press('non');
      tui.daemon.upsert({ ...mockupSessions()[0]!, ...change });
      await until(() => daemonStore.getState().sessions.find(x => x.id === 'local:otto')?.[Object.keys(change)[0] as 'tool'] === Object.values(change)[0]);
      await tui.press('\r');
      await until(() => tui.frame().includes(why));
      expect(sent(tui.daemon.received, 'session.decide')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('a note refused at once: a send under way', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press('non'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.decide').length === 1);
      // Not landed yet: a second note waits behind it.
      await tui.press('r'); await tui.press('encore'); await tui.press('\r');
      await until(() => tui.frame().includes('Un envoi pour Otto est déjà en cours.'));
      expect(sent(tui.daemon.received, 'session.decide')).toHaveLength(1);
    } finally { await tui.cleanup(); }
  });

  it('Ask offline: an entry of the history, retouched, stays in the field; esc brings the draft back', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Qui a besoin de moi ?'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, text: 'Otto.', at: T(1) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('Et Luna'); await tui.press(UP); await tui.press(' bis');
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Qui a besoin de moi ? bis');
      await tui.daemon.close();
      await new Promise(r => setTimeout(r, 800));
      await tui.press('\r');
      await until(() => tui.frame().includes('Le daemon local est hors ligne'));
      expect(boxRows(tui.frame(), 'QUESTION')[0]).toBe('❯ Qui a besoin de moi ? bis');
      expect(sent(tui.daemon.received, 'chat.ask')).toHaveLength(1);
      await tui.press(ESC);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et Luna');
    } finally { await tui.cleanup(); }
  });

  it('Ask: ctrl+n while going through the history, then « garder »: the draft is back, not the entry', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Qui a besoin de moi ?'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, text: 'Otto.', at: T(1) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('Et Luna'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Qui a besoin de moi ?');
      await tui.press(CTRL.n);
      await until(() => tui.frame().includes('NOUVELLE CONVERSATION ?'));
      await tui.press('n');
      await until(() => !tui.frame().includes('NOUVELLE CONVERSATION ?'));
      expect(boxRows(tui.frame(), 'QUESTION')[0]).toBe('❯ Et Luna');
    } finally { await tui.cleanup(); }
  });

  it('a fix and ↵ read together (« okk », then ⌫↵): the reply sent is no draft any more', async () => {
    const tui = await replying();
    try {
      await tui.press('okk'); await tui.press('\u007f\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]!.text).toBe('ok');
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
      expect(tui.frame()).not.toContain('ÉCRIRE · BROUILLON');
    } finally { await tui.cleanup(); }
  });

  it('Ask: a fix and ↵ read together: the question asked leaves the field', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Qui a besoin de moi ??'); await tui.press('\u007f\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      expect(sent(tui.daemon.received, 'chat.ask')[0]!.text).toBe('Qui a besoin de moi ?');
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, text: 'Otto.', at: T(1) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('X');
      await until(() => boxRows(tui.frame(), 'QUESTION')[0]?.startsWith('❯ X') === true);
    } finally { await tui.cleanup(); }
  });

  it('Ask: an entry of the history asked again, the field is back to the draft', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press('Qui a besoin de moi ?'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[0]!.qid, text: 'Otto.', at: T(1) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('Et Luna'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Qui a besoin de moi ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 2);
      expect(sent(tui.daemon.received, 'chat.ask')[1]!.text).toBe('Qui a besoin de moi ?');
      tui.daemon.push({ type: 'chat.done', qid: sent(tui.daemon.received, 'chat.ask')[1]!.qid, text: 'Otto.', at: T(2) });
      await until(() => !tui.frame().includes('Ledge lit…'));
      await tui.press('X');
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ Et LunaX');
    } finally { await tui.cleanup(); }
  });

  it('keys read together all count (ssh, a busy machine): ab, ←, cd, ⌫ in one write is « acb »', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await tui.press(`ab${LEFT}cd\u007f`);
      await until(() => boxRows(tui.frame(), 'QUESTION')[0] === '❯ acb');
    } finally { await tui.cleanup(); }
  });

  it('going through the history, ↑ climbs the rows of an entry of several lines before the entry above', async () => {
    const tui = await replying();
    try {
      await tui.press('un'); await tui.press(ALT_ENTER); await tui.press('deux'); await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      tui.daemon.upsert({ ...mockupSessions()[2]!, state: 'working', lastActivityAt: T(5) });
      await until(() => tui.frame().includes('✓ Réponse envoyée à Bix'));
      await tui.press('r'); await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[1] === '  deux');
      await tui.press(UP); await tui.press('X');
      await until(() => boxRows(tui.frame(), 'RÉPONDRE À BIX')[0] === '❯ unX');
    } finally { await tui.cleanup(); }
  });

  it('ctrl+c quits at once when the only draft was for a session gone since', async () => {
    const tui = await replying();
    try {
      await tui.press('Pour plus tard'); await tui.press(ESC);
      await until(() => tui.frame().includes('ÉCRIRE · BROUILLON'));
      await tui.press(ESC);
      tui.daemon.remove('bix');
      await until(() => !tui.frame().includes('Bix'));
      await tui.press(CTRL.c);
      await new Promise(r => setTimeout(r, 100));
      expect(tui.frame()).not.toContain('Brouillon en cours');
      // Gone: a key goes nowhere.
      await tui.press('/');
      expect(tui.frame()).not.toContain('QUESTION');
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: lot A, second review', () => {
  it('below 60×16 the new session screen does nothing but esc: ctrl+s launches nothing out of view', async () => {
    const tui = await startTui();
    tui.daemon.options.autoLaunch = true;
    try {
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press('Ajoute un test');
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite'));
      await tui.press('\u0013');
      await tui.press('\r');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'session.launch')).toEqual([]);
      await tui.press(ESC);
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('PROJETS'));
    } finally { await tui.cleanup(); }
  });

  it('below 60×16 Ask does nothing with ctrl+n or tab', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · OPÉRATEUR'));
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite'));
      await tui.press('\u000e');
      await tui.press('\t');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'chat.reset')).toEqual([]);
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('LEDGE · OPÉRATEUR'));
      expect(tui.frame()).toContain('alt+↵');
    } finally { await tui.cleanup(); }
  });

  it('below 60×16, writing, esc leaves the field and keeps the draft', async () => {
    const tui = await startTui();
    try {
      await tui.press('\r');
      await until(() => tui.frame().includes('Otto veut exécuter'));
      await tui.press('r'); await tui.press('Pas ce test');
      await until(() => tui.frame().includes('garder et sortir'));
      await tui.resize(52, 14);
      await until(() => tui.frame().includes('Fenêtre trop petite'));
      await tui.press(ESC);
      await new Promise(r => setTimeout(r, 100));
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('Otto veut exécuter'));
      expect(tui.frame()).not.toContain('garder et sortir');
      expect(tui.frame()).toContain('Pas ce test');
    } finally { await tui.cleanup(); }
  });

  it('a long question folded: its lines start at the edge, none loses its end, « +n » shows', async () => {
    const [otto, ...rest] = mockupSessions();
    const text = `Quel port ${'longuement '.repeat(60)}fin ?`;
    const tui = await startTui({ sessions: [{ ...otto!, state: 'waiting_input', pending: { kind: 'question', text, options: ['3000', '5173'], source: 'hook' } }, ...rest] });
    try {
      await tui.resize(80, 30);
      await tui.press('\r');
      await until(() => tui.frame().includes('Quel port'));
      const rows = tui.frame().split('\n').filter(l => l.includes('longuement'));
      expect(rows.length).toBe(4);
      for (const l of rows) expect(l).toMatch(/^│ \S/);
      expect(rows.slice(0, 3).every(l => /longuement {0,2}│$/.test(l))).toBe(true);
      expect(rows[3]).toMatch(/… \+\d+ *│$/);
    } finally { await tui.cleanup(); }
  });

  it('scrolled to the top of the thread, the border says only what is below', async () => {
    const tui = await startTui();
    tui.daemon.thread('bix', [{ kind: 'prompt', id: 'p1', at: T(0), turn: 1, text: 'Relis tout' },
      ...Array.from({ length: 40 }, (_, i) => ({ kind: 'tool' as const, id: `t${i}`, at: T(1 + i), turn: 1, tool: 'Read', label: `src/fichier-${i}.ts`, status: 'success' as const, durationMs: 100, files: [] }))]);
    try {
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('BIX · DOCUMENTER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('fichier-'));
      for (let i = 0; i < 4; i++) await tui.press('\u001b[5~');
      await until(() => tui.frame().includes('Relis tout'));
      expect(tui.frame()).toMatch(/─ ↓ \d+ · G fin ─╯/);
      expect(tui.frame()).not.toContain('↑ 0');
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: ask Ledge scrolls, in Markdown (#95 lot C)', () => {
  const OP = 'LEDGE · OPÉRATEUR';
  // Of today: the fleet keeps only the day's conversation.
  const at = (i: number) => new Date(Date.now() - (60 - i) * 1000).toISOString();
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({
    qid: `h${i}`, question: `Question ${i} ?`, askedAt: at(i), steps: [], answeredAt: at(i),
    answer: `## Réponse ${i}\n- **un** point\n- \`deux\`\n\nFin ${i}.`
  }));

  it('PgUp PgDn scroll the conversation from the field, which keeps the keys; the border says what is above and below', async () => {
    const tui = await startTui();
    try {
      await tui.resize(80, 24);
      await tui.press('/');
      tui.daemon.push({ type: 'chat.history', turns: turns(6) });
      await until(() => tui.frame().includes('Fin 5.'));
      expect(tui.frame()).not.toContain('## Réponse');
      expect(tui.frame()).toContain('Réponse 5');
      expect(bottom(tui.frame(), OP)).toMatch(/↑ \d+ lignes plus haut · PgUp/);
      expect(tui.frame()).toContain('PgUp PgDn');
      await tui.press('\u001b[5~');
      await until(() => /↑ \d+ plus haut · ↓ \d+ · G fin/.test(bottom(tui.frame(), OP)));
      expect(tui.frame()).not.toContain('Fin 5.');
      await tui.press('Et');
      await until(() => tui.frame().includes('❯ Et'));
      await tui.press('\u001b[6~');
      await until(() => tui.frame().includes('Fin 5.'));
    } finally { await tui.cleanup(); }
  });

  it('tab goes to the conversation: j k G and its keys; an answer written meanwhile does not move the view; esc gives the question back', async () => {
    const tui = await startTui();
    try {
      await tui.resize(80, 24);
      await tui.press('/');
      tui.daemon.push({ type: 'chat.history', turns: turns(6) });
      await until(() => tui.frame().includes('Fin 5.'));
      await tui.press('Qui ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
      const { qid } = sent(tui.daemon.received, 'chat.ask')[0]!;
      tui.daemon.push({ type: 'chat.delta', qid, text: 'Otto attend.' });
      await until(() => tui.frame().includes('Otto attend.'));
      await tui.press('\t');
      await until(() => tui.frame().includes(' G  fin'));
      expect(tui.frame()).toContain('arrêter la réponse');
      for (let i = 0; i < 12; i++) await tui.press('k');
      await until(() => bottom(tui.frame(), OP).includes('↓ Ledge répond · G pour suivre'));
      const before = boxRows(tui.frame(), OP);
      tui.daemon.push({ type: 'chat.delta', qid, text: '\n\n- une ligne de plus' });
      await new Promise(r => setTimeout(r, 250));
      expect(boxRows(tui.frame(), OP)).toEqual(before);
      await tui.press('G');
      await until(() => tui.frame().includes('une ligne de plus'));
      await tui.press('\u001b');
      await until(() => tui.frame().includes('alt+↵'));
      await tui.press('x');
      await until(() => tui.frame().includes('❯ x'));
    } finally { await tui.cleanup(); }
  });

  it('↑ in the field goes back through the conversation’s questions, not only this run’s', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      tui.daemon.push({ type: 'chat.history', turns: turns(2) });
      await until(() => tui.frame().includes('Fin 1.'));
      await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION').some(l => l.includes('Question 1 ?')));
      await tui.press(UP);
      await until(() => boxRows(tui.frame(), 'QUESTION').some(l => l.includes('Question 0 ?')));
    } finally { await tui.cleanup(); }
  });

  it('a link is clickable: its text goes out inside OSC 8', async () => {
    const tui = await startTui();
    try {
      await tui.press('/');
      tui.daemon.push({ type: 'chat.history', turns: [{ ...turns(1)[0]!, answer: 'la [PR #212](https://github.com/x/pull/212)' }] });
      await until(() => tui.frame().includes('#212'));
      expect(tui.frame().replace(/\u001b\]8;;[^\u0007]*\u0007/g, '')).toContain('la PR #212 ↗');
      expect(tui.written()).toContain('\u001b]8;;https://github.com/x/pull/212\u0007PR');
    } finally { await tui.cleanup(); }
  });

  it('a link wrapped on two lines keeps the box borders where they are', async () => {
    const tui = await startTui();
    try {
      await tui.resize(80, 24);
      await tui.press('/');
      const answer = 'Voir [la longue description de la PR numéro deux cent douze dans le dépôt, avec toutes ses remarques](https://github.com/x/pull/212) et ==surligné== fin.';
      tui.daemon.push({ type: 'chat.history', turns: [{ ...turns(1)[0]!, answer }] });
      await until(() => tui.frame().includes('fin.'));
      const rows = tui.frame().replace(/\u001b\]8;;[^\u0007]*\u0007/g, '').split('\n').filter(l => l.includes('│'));
      expect(rows.length).toBeGreaterThan(0);
      for (const l of rows) expect([...l].length, l).toBe(80);
    } finally { await tui.cleanup(); }
  });

  it('the help fits 80×24 from its top: the bar, the « Saisie » group, j k for the rest', async () => {
    const tui = await startTui();
    try {
      await tui.resize(80, 24);
      await tui.press('?');
      await until(() => tui.frame().includes('Saisie'));
      const lines = tui.frame().split('\n');
      expect(lines[0]).toContain('ledge');
      expect(lines[2]).toContain('Partout');
      expect(bottom(tui.frame(), 'AIDE')).toMatch(/↓ \d+ plus bas/);
      await tui.press('j');
      await until(() => /↑ 1 plus haut/.test(bottom(tui.frame(), 'AIDE')));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: new session', () => {
  it('launches what the form says on ctrl+s and selects the new session', async () => {
    const tui = await startTui();
    tui.daemon.options.autoLaunch = true;
    try {
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press('Ajoute un test pour la reconnexion ssh');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      const m = sent(tui.daemon.received, 'session.launch')[0]!;
      expect(m).toMatchObject({ tool: 'claude', cwd: '/w/ledge', prompt: 'Ajoute un test pour la reconnexion ssh' });
      expect(m.name).toMatch(/^\S+$/);
      await until(() => tui.frame().includes(`✓ ${m.name} est lancée`));
      // Back on the overview, the new session selected.
      await until(() => tui.frame().includes('À TOI') && tui.frame().includes(m.name!.toUpperCase()));
    } finally { await tui.cleanup(); }
  });

  it('says what is missing instead of launching', async () => {
    const tui = await startTui();
    try {
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press('\u0013');
      await until(() => tui.frame().includes('Écrivez une instruction.'));
      expect(sent(tui.daemon.received, 'session.launch')).toEqual([]);
      await tui.press(ESC);
      await until(() => tui.frame().includes('À TOI'));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: settings', () => {
  it('switches to English at once and saves it', async () => {
    const tui = await startTui();
    try {
      await tui.press(',');
      await until(() => tui.frame().includes('RÉGLAGES'));
      await tui.press('\u001b[C'); // →
      await until(() => tui.frame().includes('SETTINGS'));
      expect(tui.saved).toEqual(['en']);
      expect(tui.frame()).toContain('Setting saved.');
      await tui.press(ESC);
      await until(() => tui.frame().includes('YOURS · 2'));
      expect(tui.frame()).toContain('Wants to run: npm test');
    } finally { await tui.cleanup(); }
  });

  it('a save that fails still applies the language and says so', async () => {
    const tui = await startTui({ save: () => { throw new Error('read-only file system'); } });
    try {
      await tui.press(',');
      await tui.press('\u001b[C');
      await until(() => tui.frame().includes('Setting applied, but not saved: read-only file system'));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: teams (roles spec §3.9)', () => {
  it('the overview draws ▭ the common table and ▣ a team with its seats’ roles; J joins, R resumes', async () => {
    const sessions = mockupSessions().map(s => (s.id === 'nova' ? { ...s, team: 'team-a1b2', role: 'build' } : s));
    const tui = await startTui({ sessions });
    try {
      tui.daemon.push({ type: 'teams', teams: [
        { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'nova' }, { role: 'qa', sessionId: null }], createdAt: T(0), updatedAt: T(0) },
        { id: 'team-c3d4', name: 'mobile', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'resting', seats: [], createdAt: T(1), updatedAt: T(1) }
      ] });
      await until(() => tui.frame().includes('▣ ledge-roles'));
      expect(tui.frame()).toContain('▭ table commune');
      expect(tui.frame()).toContain('@build');
      expect(tui.frame()).toContain('au repos · R pour reprendre');
      await tui.press('R');
      await until(() => sent(tui.daemon.received, 'team.resume').length === 1);
      expect(sent(tui.daemon.received, 'team.resume')[0]).toEqual({ type: 'team.resume', team: 'team-c3d4' });
      // Otto (selected first) joins ledge-roles in its first free role.
      await tui.press('J');
      await until(() => tui.frame().includes('OTTO REJOINT QUELLE ÉQUIPE'));
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'team.join').length === 1);
      expect(sent(tui.daemon.received, 'team.join')[0]).toEqual({ type: 'team.join', team: 'team-a1b2', session: 'otto', role: 'qa' });
    } finally { await tui.cleanup(); }
  });

  it('ctrl+t turns the new session form into a team: the template, its preview, ctrl+s launches it', async () => {
    const tui = await startTui();
    tui.daemon.onMessage(m => {
      if (m.type === 'roles.list') tui.daemon.push({ type: 'roles.listing', requestId: m.requestId, roles: [{ id: 'lead', label: 'Chef', prompt: '', source: 'home', path: '/h/lead.md' }, { id: 'review', label: 'Relecteur', prompt: '', autonomy: 'auto', source: 'home', path: '/h/review.md' }], templates: [{ id: 'workshop', name: 'workshop', seats: [{ role: 'lead' }, { role: 'review', tool: 'codex' }], source: 'home', path: '/h/w.yaml' }], problems: [] });
      if (m.type === 'team.launch') tui.daemon.push({ type: 'team.launched', rid: m.rid, team: { id: 'team-e5f6', name: 'workshop', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [], createdAt: T(0), updatedAt: T(0) } });
    });
    try {
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await tui.press('\u0014'); // ctrl+t
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE'));
      await until(() => tui.frame().includes('L’équipe workshop s’installera à une nouvelle table de la pièce Ledge.'));
      expect(tui.frame()).toContain('@review travaillera sans demander.');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'team.launch').length === 1);
      expect(sent(tui.daemon.received, 'team.launch')[0]).toMatchObject({ cwd: '/w/ledge', template: 'workshop', name: 'workshop' });
      await until(() => tui.frame().includes('✓ Équipe workshop lancée'));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: « Équipes » (6), the roles and templates catalog (#97)', () => {
  const listing = (requestId?: string) => ({
    type: 'roles.listing' as const, requestId,
    roles: [
      { id: 'build', label: 'Builder', prompt: '## Rôle\nTu implémentes une étape à la fois.', tool: 'claude' as const, model: 'opus', effort: 'high', autonomy: 'edits' as const, source: 'repo' as const, path: '/w/ledge/.ledge/roles/build.md' },
      { id: 'review', label: 'Relecteur', prompt: 'Tu relis sans modifier le code.', tool: 'codex' as const, source: 'repo' as const, path: '/w/ledge/.ledge/roles/review.md', shadows: '/h/.ledge/roles/review.md' },
      { id: 'lead', label: 'Lead', prompt: 'Tu découpes le travail.', source: 'home' as const, path: '/h/.ledge/roles/lead.md' }
    ],
    templates: [{ id: 'workshop', name: 'workshop', seats: [{ role: 'lead' }, { role: 'build' }, { role: 'review', model: 'gpt-5.5-mini' }], source: 'repo' as const, path: '/w/ledge/.ledge/teams/workshop.yaml' }],
    problems: [{ path: '/w/ledge/.ledge/roles/Design.md', reason: 'nom de fichier invalide' }]
  });
  const answer = (tui: Awaited<ReturnType<typeof startTui>>) => tui.daemon.onMessage(m => {
    // A repository's files are its own: a folder's roles are read in it.
    if (m.type === 'roles.list') tui.daemon.push(m.cwd ? { ...listing(m.requestId), roles: listing().roles.map(r => (r.source === 'repo' ? { ...r, path: r.path.replace('/w/ledge', m.cwd!) } : r)) } : { ...listing(m.requestId), roles: listing().roles.filter(r => r.source === 'home'), templates: [], problems: [] });
  });

  it('6 lists the selected session’s repository roles then the home’s; j k move, the detail follows; ← → shows the templates', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('dépôt · .ledge/roles'));
      expect(sent(tui.daemon.received, 'roles.list')[0]).toMatchObject({ cwd: '/w/ledge' });
      expect(tui.frame()).toContain('perso · ~/.ledge/roles');
      expect(tui.frame()).toContain('@BUILD · BUILDER');
      expect(tui.frame()).toContain('Tu implémentes une étape à la fois.');
      await tui.press('j');
      await until(() => tui.frame().includes('@REVIEW · RELECTEUR'));
      expect(tui.frame()).toContain('remplace /h/.ledge/roles/review.md');
      expect(tui.frame()).toContain('▣ workshop');
      await tui.press('\u001b[C'); // →
      await until(() => tui.frame().includes('dépôt · .ledge/teams'));
      expect(tui.frame()).toContain('gpt-5.5-mini');
    } finally { await tui.cleanup(); }
  });

  it('! shows the ignored files; c changes the folder and reads the roles again', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('1 fichier ignoré'));
      await tui.press('!');
      await until(() => tui.frame().includes('nom de fichier invalide'));
      expect(tui.frame()).toContain('/w/ledge/.ledge/roles/Design.md');
      await tui.press('!');
      const before = sent(tui.daemon.received, 'roles.list').length;
      await tui.press('c');
      await until(() => sent(tui.daemon.received, 'roles.list').length === before + 1);
      expect(sent(tui.daemon.received, 'roles.list').at(-1)!.cwd).not.toBe('/w/ledge');
    } finally { await tui.cleanup(); }
  });

  it('↵ opens « Nouvelle session » with the role, and launches it with the role', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      await tui.press('j');
      await until(() => tui.frame().includes('@REVIEW · RELECTEUR'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      expect(tui.frame()).toContain('@review');
      await tui.press('Relis la PR');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      expect(sent(tui.daemon.received, 'session.launch')[0]).toMatchObject({ tool: 'codex', cwd: '/w/ledge', role: 'review', prompt: 'Relis la PR' });
    } finally { await tui.cleanup(); }
  });

  it('the role’s model and effort fill the form, as the daemon applies them; another agent takes its own, the role’s come back with it', async () => {
    const tui = await startTui();
    answer(tui);
    tui.daemon.onMessage(m => {
      if (m.type === 'models.list') tui.daemon.push({ type: 'models.listing', requestId: m.requestId, tool: m.tool, models: m.tool === 'claude' ? [{ id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus', efforts: ['low', 'high'] }] : [{ id: 'gpt-5.5', label: 'GPT-5.5' }] });
    });
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await until(() => tui.frame().includes('◂ Opus ▸'));
      expect(tui.frame()).toContain('◂ high ▸');
      expect(tui.frame()).toContain('Local · Claude Code · opus · high');
      await tui.press('Implémente');
      await tui.press('\t'); // to Agent
      await tui.press('\u001b[C'); // → Codex
      await until(() => tui.frame().includes('GPT-5.5'));
      expect(tui.frame()).not.toContain('◂ Opus ▸');
      await tui.press('\u001b[D'); // ← back to Claude Code
      await until(() => tui.frame().includes('◂ Opus ▸'));
      expect(tui.frame()).toContain('◂ high ▸');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      expect(sent(tui.daemon.received, 'session.launch')[0]).toMatchObject({ tool: 'claude', role: 'build', model: 'opus', effort: 'high', prompt: 'Implémente' });
    } finally { await tui.cleanup(); }
  });

  it('the role read in a folder is dropped when the launch goes elsewhere, and comes back with the folder', async () => {
    const tui = await startTui();
    // /w/website has no role of its own: only the home's.
    tui.daemon.onMessage(m => {
      if (m.type === 'roles.list') tui.daemon.push(m.cwd === '/w/ledge' ? listing(m.requestId) : { ...listing(m.requestId), roles: listing().roles.filter(r => r.source === 'home'), templates: [], problems: [] });
    });
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      await tui.press('j');
      await until(() => tui.frame().includes('@REVIEW · RELECTEUR'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      expect(tui.frame()).toContain('@review Relecteur');
      await tui.press('Relis la PR');
      for (let i = 0; i < 4; i++) await tui.press('\t'); // to Projet
      await tui.press('\u001b[C'); // → Website
      await until(() => tui.frame().includes('n’est lu que dans /w/ledge'));
      expect(tui.frame()).not.toContain('@review Relecteur');
      await tui.press('\u001b[D'); // ← back to Ledge
      await until(() => tui.frame().includes('@review Relecteur'));
      await tui.press('\u001b[C');
      await until(() => tui.frame().includes('n’est lu que dans /w/ledge'));
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      const launched = sent(tui.daemon.received, 'session.launch')[0]!;
      expect(launched).toMatchObject({ cwd: '/w/website', prompt: 'Relis la PR' });
      expect(launched.role).toBeUndefined();
    } finally { await tui.cleanup(); }
  });

  it('a role read under « Perso seulement » is asked again in the folder launched: shadowed there by the repository’s, that one is shown and launched, with its defaults', async () => {
    const tui = await startTui();
    const home = { id: 'review', label: 'Relecteur perso', prompt: 'Tu relis.', autonomy: 'ask' as const, source: 'home' as const, path: '/h/.ledge/roles/review.md' };
    const lead = { id: 'lead', label: 'Lead', prompt: 'Tu découpes.', source: 'home' as const, path: '/h/.ledge/roles/lead.md' };
    const repo = { id: 'review', label: 'Relecteur auto', prompt: 'Tu modifies.', tool: 'codex' as const, autonomy: 'auto' as const, source: 'repo' as const, path: '/w/ledge/.ledge/roles/review.md', shadows: home.path };
    tui.daemon.onMessage(m => {
      if (m.type === 'roles.list') tui.daemon.push({ type: 'roles.listing', requestId: m.requestId, roles: m.cwd === '/w/ledge' ? [repo, lead] : [home, lead], templates: [], problems: [] });
    });
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@REVIEW · RELECTEUR AUTO'));
      for (const _ of [0, 1]) await tui.press('c'); // /w/website, then « Perso seulement »
      await until(() => tui.frame().includes('PERSO SEULEMENT') && tui.frame().includes('@REVIEW · RELECTEUR PERSO'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await until(() => tui.frame().includes('@review Relecteur auto · celui de /w/ledge'));
      expect(sent(tui.daemon.received, 'roles.list').at(-1)).toMatchObject({ cwd: '/w/ledge' });
      expect(tui.frame()).not.toContain('Relecteur perso');
      // Its agent, as the daemon will launch it.
      expect(tui.frame()).toMatch(/◉ Codex/);
      await tui.press('Relis');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      expect(sent(tui.daemon.received, 'session.launch')[0]).toMatchObject({ cwd: '/w/ledge', role: 'review', tool: 'codex' });
    } finally { await tui.cleanup(); }
  });

  it('a role read under « Perso seulement » that the folder does not shadow is launched with it, once the folder said so', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      for (const _ of [0, 1]) await tui.press('c');
      await until(() => tui.frame().includes('PERSO SEULEMENT') && tui.frame().includes('@LEAD · LEAD'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      await until(() => tui.frame().includes('@lead Lead'));
      await tui.press('Découpe');
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'session.launch').length === 1);
      expect(sent(tui.daemon.received, 'session.launch')[0]).toMatchObject({ cwd: '/w/ledge', role: 'lead' });
    } finally { await tui.cleanup(); }
  });

  it('↵ on a template opens the team mode with it', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      await tui.press('\u001b[C'); // →
      await until(() => tui.frame().includes('▣ WORKSHOP'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE ÉQUIPE'));
      await until(() => tui.frame().includes('L’équipe workshop s’installera'));
      await tui.press('\u0013'); // ctrl+s
      await until(() => sent(tui.daemon.received, 'team.launch').length === 1);
      expect(sent(tui.daemon.received, 'team.launch')[0]).toMatchObject({ cwd: '/w/ledge', template: 'workshop' });
    } finally { await tui.cleanup(); }
  });

  it('c steps through every folder to « Perso seulement » and back to the first, the order kept', async () => {
    const projects = { ...PROJECTS, projects: [...PROJECTS.projects, { id: 'docs', name: 'Docs', color: 'violet', repos: [{ machine: 'local', path: '/w/docs' }] }] as typeof PROJECTS.projects };
    const tui = await startTui({ projects });
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      const cwds: Array<string | undefined> = [];
      for (let i = 0; i < 4; i++) {
        const before = sent(tui.daemon.received, 'roles.list').length;
        await tui.press('c');
        await until(() => sent(tui.daemon.received, 'roles.list').length === before + 1);
        cwds.push(sent(tui.daemon.received, 'roles.list').at(-1)!.cwd);
        if (i === 2) await until(() => tui.frame().includes('PERSO SEULEMENT'));
      }
      expect(cwds).toEqual(['/w/website', '/w/docs', undefined, '/w/ledge']);
    } finally { await tui.cleanup(); }
  });

  it('esc closes the ignored files and stays on « Équipes »', async () => {
    const tui = await startTui();
    answer(tui);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('1 fichier ignoré'));
      await tui.press('!');
      await until(() => tui.frame().includes('nom de fichier invalide'));
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('nom de fichier invalide'));
      expect(tui.frame()).toContain('@BUILD · BUILDER');
    } finally { await tui.cleanup(); }
  });

  for (const [env, editor] of [[{ VISUAL: 'code -w', EDITOR: 'nano' }, ['code', '-w']], [{ EDITOR: 'nano' }, ['nano']], [{}, ['vi']]] as const) {
    it(`o opens the role’s file, then the template’s, in ${editor.join(' ')} (${Object.keys(env).join(', ') || 'neither VISUAL nor EDITOR'})`, async () => {
      const runs: string[][] = [];
      const tui = await startTui({ env, run: async argv => { runs.push(argv); return 0; } });
      answer(tui);
      try {
        await tui.press('6');
        await until(() => tui.frame().includes('@BUILD · BUILDER'));
        await tui.press('o');
        await until(() => runs.length === 1);
        await tui.press('\u001b[C'); // →
        await until(() => tui.frame().includes('▣ WORKSHOP'));
        await tui.press('o');
        await until(() => runs.length === 2);
        expect(runs).toEqual([[...editor, '/w/ledge/.ledge/roles/build.md'], [...editor, '/w/ledge/.ledge/teams/workshop.yaml']]);
      } finally { await tui.cleanup(); }
    });
  }

  it('a daemon that does not answer roles.list in 4 s is said; r asks the same folder again', async () => {
    const tui = await startTui();
    try {
      await tui.press('6');
      await until(() => sent(tui.daemon.received, 'roles.list').length === 1);
      expect(tui.frame()).not.toContain('r  relire');
      await until(() => tui.frame().includes('Le daemon n’a pas répondu.'), 10_000);
      expect(tui.frame()).toContain('r  relire');
      answer(tui);
      await tui.press('r');
      await until(() => sent(tui.daemon.received, 'roles.list').length === 2);
      expect(sent(tui.daemon.received, 'roles.list')[1]).toMatchObject({ cwd: '/w/ledge' });
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      expect(tui.frame()).not.toContain('Le daemon n’a pas répondu.');
    } finally { await tui.cleanup(); }
  });

  it('a project on another machine is read there (#99): c reaches it, the title names the machine, roles.list carries it, o is not offered', async () => {
    const projects = { ...PROJECTS, projects: [...PROJECTS.projects, { id: 'srv', name: 'App', color: 'violet', repos: [{ machine: 'server', path: '/srv/applications/catalog' }] }] as typeof PROJECTS.projects };
    const runs: string[][] = [];
    const tui = await startTui({ projects, run: async argv => { runs.push(argv); return 0; } });
    // The remote machine is the same mock reached through /ssh/srv: its snapshot names the alias, as a daemon behind ssh does.
    Object.assign(tui.daemon.extras, { sshAlias: 'srv' });
    tui.daemon.machines([{ id: 'local', label: 'Local' }, { id: 'server', label: 'serveur', ssh: 'srv' }]);
    answer(tui);
    const asked: Array<Record<string, unknown>> = [];
    const send = tui.client.send.bind(tui.client);
    tui.client.send = m => { if (m.type === 'roles.list') asked.push(m); send(m); };
    try {
      await tui.resize(160, 30);
      await until(() => tui.frame().includes('serveur ●'));
      await tui.press('6');
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      // Two machines: the local folder names its machine too, the first ask goes without machineId (local, as before).
      expect(tui.frame()).toContain('LEDGE /W/LEDGE · ● LOCAL');
      expect(asked[0]).toMatchObject({ cwd: '/w/ledge' });
      expect(asked[0]!.machineId).toBeUndefined();
      for (let i = 0; i < 4 && asked.at(-1)!.cwd !== '/srv/applications/catalog'; i++) {
        const before = asked.length;
        await tui.press('c');
        await until(() => asked.length === before + 1);
      }
      expect(asked.at(-1)).toMatchObject({ cwd: '/srv/applications/catalog', machineId: 'server' });
      await until(() => tui.frame().includes('APP /SRV/APPLICATIONS/CATALOG · ● SERVEUR') && tui.frame().includes('@BUILD · BUILDER'));
      // Narrower, the folder is cut before the machine, which stays.
      await tui.resize(100, 30);
      await until(() => tui.frame().includes('… · ● SERVEUR'));
      expect(tui.frame()).not.toContain('APP /SRV/APPLICATIONS/CATALOG');
      expect(tui.frame()).toContain('sur serveur');
      expect(tui.frame()).not.toContain('o  ouvrir le fichier');
      await tui.press('o');
      await new Promise(r => setTimeout(r, 100));
      expect(runs).toEqual([]);
      // Teams are the local daemon's: a template read there is shown, not launched.
      await tui.press('\u001b[C'); // →
      await until(() => tui.frame().includes('▣ WORKSHOP'));
      expect(tui.frame()).not.toContain('lancer cette équipe');
      await tui.press('\u001b[D'); // ←
      await until(() => tui.frame().includes('@BUILD · BUILDER'));
      await tui.press('\r');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      expect(tui.frame()).toMatch(/· serveur · Claude Code/);
    } finally { await tui.cleanup(); }
  });

  it('a machine offline is said with r to read again, a daemon too old is said (#99)', async () => {
    const tui = await startTui();
    let error: 'offline' | 'outdated' = 'offline';
    tui.daemon.onMessage(m => { if (m.type === 'roles.list') tui.daemon.push({ type: 'roles.listing', requestId: m.requestId, roles: [], templates: [], problems: [], error }); });
    try {
      await tui.resize(160, 30);
      await tui.press('6');
      await until(() => tui.frame().includes('Local est hors ligne.'));
      expect(tui.frame()).toContain('r  relire');
      expect(tui.frame()).not.toContain('Aucun rôle ici');
      error = 'outdated';
      await tui.press('r');
      await until(() => tui.frame().includes('Le daemon de Local est trop ancien pour le catalogue.'));
      expect(tui.frame()).not.toContain('r  relire');
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: a session near its context limit (context handover spec §3.2)', () => {
  it('« À toi » lists it, the card shows its context, H hands it over', async () => {
    const sessions = mockupSessions().map(s => (s.id === 'nova' ? { ...s, role: 'build', context: { used: 230_000, window: 272_000, at: T(0) } } : s));
    const tui = await startTui({ sessions });
    tui.daemon.onMessage(m => { if (m.type === 'session.handover') tui.daemon.push({ type: 'session.handover.result', rid: m.rid, ok: true }); });
    try {
      await until(() => tui.frame().includes('◔ Nova @build · ctx 85 %'));
      await tui.press('j');
      await until(() => tui.frame().includes('ctx 85 %'));
      await tui.press('H');
      await until(() => sent(tui.daemon.received, 'session.handover').length === 1);
      expect(sent(tui.daemon.received, 'session.handover')[0]).toMatchObject({ id: 'nova' });
      await until(() => tui.frame().includes('Nova écrit son bilan'));
    } finally { await tui.cleanup(); }
  });
});

describe('ledge tui: « Contexte max » (context handover spec §3.2)', () => {
  it('the settings show the daemon\'s threshold; → raises it by 5 % and sends it', async () => {
    const tui = await startTui();
    try {
      tui.daemon.push({ type: 'context.prefs', prefs: { near: 0.8 } });
      await tui.press(',');
      await until(() => tui.frame().includes('Contexte max'));
      await until(() => tui.frame().includes('◂ 80 % ▸'));
      // Langue, Thème, then Contexte max.
      await tui.press('j'); await tui.press('j');
      await tui.press('\u001b[C');
      await until(() => sent(tui.daemon.received, 'context.set').length === 1);
      expect(sent(tui.daemon.received, 'context.set')[0]).toEqual({ type: 'context.set', prefs: { near: 0.85 } });
    } finally { await tui.cleanup(); }
  });
});
