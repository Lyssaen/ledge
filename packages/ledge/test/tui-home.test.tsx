import { describe, it, expect } from 'vitest';
import type { ClientMessage, LedgeThreadItem } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupEscalations, startTui } from './tui-fixture.js';

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
      await until(() => tui.frame().includes('QUESTION'));
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
      await until(() => sent(tui.daemon.received, 'chat.ask').length === 1);
    } finally { await tui.cleanup(); }
  });
});
