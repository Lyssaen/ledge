import { describe, it, expect } from 'vitest';
import type { ClientMessage, Exchange, LedgeThreadItem } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupEscalations, mockupRigs, startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** The thread with the mockup's decision in it, pushed as the daemon sends it after connecting. */
const decisionInThread: LedgeThreadItem[] = [
  { kind: 'ledge', id: 'l1', at: ago(5), text: 'factory avance sur la reprise après reboot. Une décision t’attend :' },
  { kind: 'escalation', id: 'i-q117', at: ago(5), escalationId: 'q-117' }
];

describe('ledge tui: home', () => {
  it('home opens on Ledge and 1 2 3 move between Ledge, the rig and the session', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('RIGS') && tui.frame().includes('factory'));
      const f = tui.frame();
      expect(f).toContain('LEDGE');
      expect(f).toContain('Une décision t’attend · factory');
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('PROJETS · SESSIONS SEULES');
      expect(f).toMatch(/▣ factory 4\/6 au travail · dans Ledge/);
      expect(f).toMatch(/orch-lead .*Attend Ledge/);
      expect(f).toContain('review-b, design · disponibles');
      expect(f).toContain('◈ Noyau OpenRig au repos · operator, queue');
      expect(f).toContain('LEDGE · CONVERSATION');
      // The status bar counts the rigs, their agents, the standalone sessions and the machines, then who waits.
      expect(f).toContain('2 rigs · 8 agents · 4 sessions seules · 1 machine · 3 t’attendent');
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY'));
      await tui.press('1');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press('j');
      await tui.press('3');
      // The escalation is selected: 3 has no session to open.
      expect(tui.frame()).toContain('À TOI · 3');
      await tui.pick('Otto');
      await tui.press('3');
      await until(() => tui.frame().includes('Otto veut exécuter'));
    } finally { await tui.cleanup(); }
  });

  it('a paired seat opens its session with ↵; the kernel row is reachable', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.pick('build');
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE'));
    } finally { await tui.cleanup(); }
  });

  it('without OpenRig, Rigs says it is not installed', async () => {
    const tui = await startTui();
    try {
      // 44 columns wide at 100: the line goes on two.
      await until(() => tui.frame().includes('OpenRig n’est pas installé'));
      expect(tui.frame()).toContain('+ pour lancer un rig');
      expect(tui.frame()).toContain('0 rig · 0 agent · 4 sessions seules');
    } finally { await tui.cleanup(); }
  });

  it('↵ on Ledge opens the field; tab goes to the first one waiting', async () => {
    const tui = await startTui();
    try {
      await tui.press('\t');
      await until(() => tui.frame().includes('OTTO · CÂBLER LA LISTE DES SESSIONS'));
      await tui.press('1');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press('\r');
      await until(() => tui.frame().includes('alt+↵'));
    } finally { await tui.cleanup(); }
  });

  it('a `ledge ask` the daemon mirrors as an escalation is listed and counted once', async () => {
    const at = new Date(Date.now() - 120_000).toISOString();
    const tui = await startTui({ openrig: { rigs: [], escalations: [{ id: 'ask-a1b2c3d', source: 'ask', machine: 'local', from: 'Nova', intent: 'decision', summary: 'Quelle base ?', questions: [], createdAt: at, state: 'pending' }] } });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'asks', asks: [{ id: 'a1b2c3d', from: 'nova', fromName: 'Nova', question: 'Quelle base ?', options: 'sqlite, postgres', at, state: 'open' }] });
      await until(() => tui.frame().includes('Quelle base ?'));
      await new Promise(r => setTimeout(r, 100));
      const f = tui.frame();
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('3 t’attendent');
      expect(f).not.toContain('? Nova : Quelle base ?');
      expect(f).not.toContain('ledge decide');
      expect(f.split('Quelle base ?').length - 1).toBe(1);
      expect(f).toMatch(/\? Nova +● Local +Quelle base \?/);
    } finally { await tui.cleanup(); }
  });

  it('pressing 1 answers the pinned escalation once', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes('ARCHITECTURE · ORCH-LEAD@FACTORY'));
      expect(tui.frame()).toContain(' 1 · SQLite 1 ');
      await tui.press('1');
      await until(() => sent(tui.daemon.received, 'escalation.answer').length === 1);
      expect(sent(tui.daemon.received, 'escalation.answer')[0]).toMatchObject({ id: 'q-117', answers: { q1: 'sqlite' }, by: 'user' });
      await tui.press('1');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'escalation.answer')).toHaveLength(1);
    } finally { await tui.cleanup(); }
  });

  it('an escalation answered elsewhere shows Déjà répondu and ignores its keys', async () => {
    const tui = await startTui({ openrig: {} });
    tui.daemon.onMessage(m => { if (m.type === 'escalation.answer') tui.daemon.reply({ type: 'rig.result', rid: m.rid, ok: false, code: 'already_answered' }); });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes('ARCHITECTURE · ORCH-LEAD@FACTORY'));
      await tui.press('1');
      await until(() => tui.frame().includes('Déjà répondu'));
      await tui.press('2');
      await tui.press('1');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'escalation.answer')).toHaveLength(1);
      // The key was the card's: 2 did not leave for the rig either.
      expect(tui.frame()).toContain('Déjà répondu');
    } finally { await tui.cleanup(); }
  });

  it('an escalation answered elsewhere while shown: its card says by whom, its buttons go out, 1 sends nothing', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes(' 1 · SQLite 1 '));
      const [q117] = mockupEscalations();
      tui.daemon.push({ type: 'escalation.updated', escalation: { ...q117!, state: 'answered', answer: { by: 'user', answers: { q1: 'sqlite' }, at: ago(0) } } });
      await until(() => tui.frame().includes('→ SQLite · par toi'));
      expect(tui.frame()).not.toContain(' 1 · SQLite 1 ');
      await tui.press('1');
      await new Promise(r => setTimeout(r, 100));
      expect(sent(tui.daemon.received, 'escalation.answer')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('e talks about the escalation: the next message carries it', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes('ARCHITECTURE · ORCH-LEAD@FACTORY'));
      await tui.press('e');
      await until(() => tui.frame().includes('À PROPOS DE'));
      await tui.press('Pourquoi SQLite ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]).toMatchObject({ text: 'Pourquoi SQLite ?', about: 'q-117' });
      expect(sent(tui.daemon.received, 'chat.ask')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('u revisits a decided item; the daemon’s refusal ends in a toast', async () => {
    const tui = await startTui({ openrig: {} });
    tui.daemon.onMessage(m => { if (m.type === 'decision.revisit') tui.daemon.reply({ type: 'error', message: 'not supported yet', request: 'decision.revisit', code: 'unavailable' }); });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'decisions', items: [{ id: 'd-1', escalationId: 'q-9', by: 'ledge', category: 'git', summary: 'merge, pas de rebase', answers: {}, at: ago(10) }] });
      tui.daemon.push({ type: 'ledge.thread.history', items: [{ kind: 'decided', id: 'i-d1', at: ago(10), decisionId: 'd-1' }] });
      await until(() => tui.frame().includes('merge, pas de rebase'));
      await tui.press('u');
      await until(() => sent(tui.daemon.received, 'decision.revisit').length === 1);
      expect(sent(tui.daemon.received, 'decision.revisit')[0]).toMatchObject({ id: 'd-1' });
      await until(() => tui.frame().includes('pas encore possible'));
    } finally { await tui.cleanup(); }
  });

  it('a group of exchanges is asked for, drawn open as the latest, and z folds it', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'ledge.thread.history', items: [{ kind: 'exchanges', id: 'g1', at: ago(6), machine: 'local', rigId: 'factory', from: ago(12), to: ago(6), exchangeIds: ['x1'] }] });
      await until(() => sent(tui.daemon.received, 'rig.exchanges.request').some(m => m.rigId === 'factory'));
      tui.daemon.push({ type: 'rig.exchanges', machine: 'local', rigId: 'factory', items: [{ id: 'x1', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', to: 'qa@factory', kind: 'task', text: 'Vérifier la reprise après reboot.', at: ago(12) }] });
      await until(() => tui.frame().includes('Vérifier la reprise après reboot.'));
      expect(tui.frame()).toContain('z replier');
      await tui.press('z');
      await until(() => !tui.frame().includes('Vérifier la reprise après reboot.'));
      expect(tui.frame()).toContain('↵ déplier');
    } finally { await tui.cleanup(); }
  });

  it('/ opens Ledge’s field in the home, wherever the selection was', async () => {
    const tui = await startTui();
    try {
      await tui.pick('Otto');
      await tui.press('/');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION') && tui.frame().includes('alt+↵'));
      await tui.press('Qui ?');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]).toMatchObject({ text: 'Qui ?' });
      expect(sent(tui.daemon.received, 'ledge.say')[0]).not.toHaveProperty('about');
      expect(sent(tui.daemon.received, 'chat.ask')).toEqual([]);
    } finally { await tui.cleanup(); }
  });
});

const ALT = (k: string) => `\u001b${k}`;
const TAB = '\t', UP = '\u001b[A', DOWN = '\u001b[B', ESC = '\u001b';
/** The mockup's rigs, starter's dev-build answering to `@build` too. */
const homonyms = () => mockupRigs().map(r => (r.id === 'starter' ? { ...r, seats: r.seats.map(s => (s.name === 'dev-build' ? { ...s, address: '@build' } : s)) } : r));

describe('ledge tui: writing to Ledge', () => {
  it('the field says whom it writes to, with its suggestions above', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      // The suggestions' line is wider than the mockup's 80 columns of conversation (it runs under the rail there): past the rail.
      await tui.resize(200, 46);
      await until(() => tui.frame().includes('ÉCRIRE À LEDGE'));
      const f = tui.frame();
      expect(f).toContain('Écrire à Ledge… (@build pour un agent d’un rig)');
      expect(f).toContain('tranche dans son mandat · design, architecture et critique te reviennent');
      expect(f).toMatch(/Lance un rig… +Où en est factory \? +Qu’as-tu tranché \? +Qui a besoin de moi \? +alt\+1…4/);
      // Under 80 columns for the field, the short foot.
      await tui.resize(110, 40);
      await until(() => tui.frame().includes('design, architecture, critique te reviennent'));
    } finally { await tui.cleanup(); }
  });

  it('alt+2 asks where the most active rig is; alt+1 opens the launch instead of sending', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('Où en est factory ?'));
      await tui.press(ALT('2'));
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]).toMatchObject({ text: 'Où en est factory ?' });
      await tui.press('/');
      await tui.press(ALT('4'));
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 2);
      expect(sent(tui.daemon.received, 'ledge.say')[1]).toMatchObject({ text: 'Qui a besoin de moi ?' });
      await tui.press(ALT('1'));
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      expect(sent(tui.daemon.received, 'ledge.say')).toHaveLength(2);
    } finally { await tui.cleanup(); }
  });

  it('tab completes and ↵ sends a ledge.say', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await tui.press('/');
      await tui.press('@bu');
      await until(() => tui.frame().includes('@ UN AGENT D’UN RIG'));
      expect(tui.frame()).toMatch(/@build +factory · Reprise après reboot · Au travail/);
      expect(tui.frame()).toMatch(/↑ ↓ +choisir +tab +compléter +↵ +envoyer +esc +garder et sortir/);
      await tui.press(TAB);
      await until(() => tui.frame().includes('❯ @build ') && !tui.frame().includes('@ UN AGENT D’UN RIG'));
      // The completion keeps the focus in the field.
      await tui.press('relance les tests');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]).toMatchObject({ text: '@build relance les tests' });
      expect(sent(tui.daemon.received, 'chat.ask')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('homonyms are offered under their long address; ↑ ↓ choose, esc closes the list and keeps the text', async () => {
    const tui = await startTui({ openrig: { rigs: homonyms() } });
    try {
      await tui.resize(160, 46);
      await tui.press('/');
      await tui.press('@bu');
      await until(() => tui.frame().includes('@build@starter'));
      expect(tui.frame()).toMatch(/@build@factory +factory/);
      expect(tui.frame()).toMatch(/@build@starter +starter · dev-build/);
      await tui.press(DOWN);
      await tui.press(TAB);
      await until(() => tui.frame().includes('❯ @build@starter '));
      await tui.press('\u0015'); // ctrl+u: the field emptied
      await tui.press('@bu');
      await until(() => tui.frame().includes('@ UN AGENT D’UN RIG'));
      await tui.press(DOWN); await tui.press(UP);
      await tui.press(ESC);
      await until(() => !tui.frame().includes('@ UN AGENT D’UN RIG'));
      expect(tui.frame()).toContain('❯ @bu');
      // Still in the field: what is typed goes on.
      await tui.press('ild');
      await until(() => tui.frame().includes('❯ @build'));
    } finally { await tui.cleanup(); }
  });

  it('a refused send keeps the reason in the thread and nothing is lost', async () => {
    const tui = await startTui({ openrig: {} });
    tui.daemon.onMessage(m => {
      if (m.type !== 'ledge.say') return;
      tui.daemon.push({ type: 'ledge.thread.item', item: { kind: 'user', id: 'u1', at: new Date().toISOString(), text: m.text, to: '@build' } });
      tui.daemon.push({ type: 'ledge.thread.item', item: { kind: 'ledge', id: 'l1', at: new Date().toISOString(), text: '@build est arrêté (factory)' } });
    });
    try {
      await tui.resize(160, 46);
      await tui.press('/');
      await tui.press('@build relance les tests ciblés');
      await tui.press('\r');
      await until(() => tui.frame().includes('@build est arrêté (factory)'));
      expect(tui.frame()).toContain('relance les tests ciblés');
    } finally { await tui.cleanup(); }
  });
});

/** factory's exchanges as the daemon keeps them (oldest first). */
const factoryExchanges = (): Exchange[] => {
  const at = (min: number) => new Date(Date.now() - (60 - min) * 60_000).toISOString();
  return [
    { id: 'o-1', machine: 'local', rigId: 'factory', from: 'ledge', to: 'orch-lead@factory', kind: 'ledge', text: 'Reprise après reboot : priorité aux sessions.', at: at(20) },
    { id: 'q-114', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', to: 'build@factory', kind: 'task', text: 'Patch daemon : relire la file au démarrage.', at: at(22) },
    { id: 'q-118', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', to: 'qa@factory', kind: 'task', text: 'Vérifier la reprise sur deux rigs.', at: at(36) },
    { id: 'o-2', machine: 'local', rigId: 'factory', from: 'build@factory', to: 'review-a@factory', kind: 'message', text: 'Candidat prêt (3f2a1c0), tests verts.', at: at(42) }
  ];
};
/** The daemon answers `rig.exchanges.request` with `items` for that rig. */
const answerExchanges = (daemon: Awaited<ReturnType<typeof startTui>>['daemon'], items: Record<string, Exchange[]>) =>
  daemon.onMessage(m => { if (m.type === 'rig.exchanges.request') daemon.push({ type: 'rig.exchanges', machine: 'local', rigId: m.rigId, items: items[m.rigId] ?? [] }); });

describe('ledge tui: a rig\'s room and the kernel\'s', () => {
  it('the rig room draws its plate, seats, exchanges, queue and terminal', async () => {
    const started = new Date(2026, 9, 30, 14, 2).toISOString();
    const rigs = mockupRigs().map(r => (r.id === 'factory' ? { ...r, branch: 'feat/rigs', spec: 'factory', launch: { planId: 'p1', goal: 'g', lead: 'orch-lead@factory', startedAt: started } } : r));
    const tui = await startTui({ openrig: { rigs } });
    answerExchanges(tui.daemon, { factory: factoryExchanges() });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY · RIG · DANS LEDGE'));
      await until(() => tui.frame().includes('Patch daemon'));
      const f = tui.frame();
      expect(f).toContain('● 4/6 au travail ████████░░░░  ⎇ feat/rigs · spec factory · 6 sièges · depuis 14:02 · Local · lead orch-lead');
      expect(f).toMatch(/SIÈGE +NOM +ÉTAT +AGENT +CONTEXTE +SUR/);
      expect(f).toMatch(/@lead +orch-lead +◆ Attend Ledge +Claude Code · opus/);
      expect(f).toMatch(/@build +build +● Au travail .*Reprise après reboot/);
      expect(f).toContain('ÉCHANGES · FACTORY · RIG SEND');
      expect(f).toMatch(/ledge → orch-lead/);
      expect(f).toContain('FILE OPENRIG · FACTORY · 3');
      expect(f).toMatch(/q-117 ◆ ledge à toi/);
      expect(f).toContain('TERMINAL · ORCH-LEAD · FACTORY');
      expect(f).toContain('Pas encore de terminal suivi.');
      expect(f).toMatch(/j k +sièges/);
      expect(tui.daemon.received).toContainEqual(expect.objectContaining({ type: 'rig.exchanges.request', rigId: 'factory' }));
      // j: the next seat, build, paired to a session: its terminal.
      tui.daemon.preview('build', ['● Bash(pnpm vitest)', '  ⎿  12 passed']);
      await tui.press('j');
      await until(() => tui.frame().includes('TERMINAL · BUILD · FACTORY'));
      await until(() => tui.frame().includes('12 passed'));
      // ↵ opens its session.
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE'));
    } finally { await tui.cleanup(); }
  });

  it('w opens Ledge\'s field with the seat address', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY · RIG'));
      for (let i = 0; i < 3; i++) await tui.press('j');
      await until(() => tui.frame().includes('TERMINAL · REVIEW-A · FACTORY'));
      await tui.press('w');
      await until(() => tui.frame().includes('❯ @review-a '));
      expect(tui.frame()).toContain('LEDGE · CONVERSATION');
      await tui.press('relis 3f2a1c0');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]).toMatchObject({ text: '@review-a relis 3f2a1c0' });
    } finally { await tui.cleanup(); }
  });

  it('a attaches the seat through OpenRig\'s terminal command', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ openrig: {}, run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY · RIG'));
      await tui.press('a');
      await until(() => runs.length === 1);
      expect(runs[0]!.join(' ')).toContain('orch-lead@factory');
    } finally { await tui.cleanup(); }
  });

  it('an unreachable rig turns its actions off', async () => {
    const rigs = mockupRigs().map(r => (r.id === 'factory' ? { ...r, lifecycle: 'unreachable' as const } : r));
    const runs: string[][] = [];
    const tui = await startTui({ openrig: { rigs }, run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY · RIG'));
      expect(tui.frame()).toMatch(/○ injoignable/);
      expect(tui.frame()).not.toMatch(/a +attacher/);
      await tui.press('w');
      await tui.press('a');
      await new Promise(r => setTimeout(r, 100));
      expect(tui.frame()).toContain('▣ FACTORY · RIG');
      expect(tui.frame()).not.toContain('❯ @lead');
      expect(runs).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('the kernel room shows operator and queue, and the hidden seats as +2', async () => {
    const tui = await startTui({ openrig: { status: { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' } } });
    answerExchanges(tui.daemon, {
      factory: factoryExchanges(),
      kernel: [{ id: 'o-9', machine: 'local', rigId: 'kernel', from: 'ledge', to: 'operator@kernel', kind: 'ledge', text: 'Remonte factory et starter.', at: new Date().toISOString() }]
    });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('◈ Noyau OpenRig'));
      for (let i = 0; i < 40 && !tui.frame().includes('LA MÉCANIQUE'); i++) await tui.press('k');
      await until(() => tui.frame().includes('◈ NOYAU OPENRIG · LA MÉCANIQUE'));
      await until(() => tui.frame().includes('Remonte factory et starter.') && tui.frame().includes('q-118'));
      const f = tui.frame();
      expect(f).toMatch(/● daemon en marche · 127\.0\.0\.1:7433 · OpenRig 0\.6\.14 · .*humain : ledge@external/);
      expect(f).toMatch(/@operator +operator +○ Disponible +Codex/);
      expect(f).toMatch(/@queue +queue/);
      expect(f).toMatch(/\+2 rangés +advisor \(doublon de Ledge\) · human \(remplacé par Ledge\)/);
      expect(f).toContain('ORDRES DE LEDGE À L’OPERATOR');
      expect(f).toContain('FILE OPENRIG · TOUT · 3');
      expect(f).toMatch(/q-118 ▤ qa@factory +en cours/);
      expect(f).toMatch(/q-117 ◆ ledge@external +à toi/);
      expect(f).toContain('TERMINAL · OPERATOR · NOYAU');
      expect(tui.daemon.received).toContainEqual(expect.objectContaining({ type: 'rig.exchanges.request', rigId: 'kernel' }));
    } finally { await tui.cleanup(); }
  });
});
