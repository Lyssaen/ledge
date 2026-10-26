import { describe, it, expect } from 'vitest';
import type { ClientMessage } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupSessions, startTui } from './tui-fixture.js';

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
      await tui.press('j');
      await tui.press('\u001b[C');
      await until(() => sent(tui.daemon.received, 'context.set').length === 1);
      expect(sent(tui.daemon.received, 'context.set')[0]).toEqual({ type: 'context.set', prefs: { near: 0.85 } });
    } finally { await tui.cleanup(); }
  });
});
