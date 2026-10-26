import { describe, it, expect } from 'vitest';
import { pendingKey, type ClientMessage } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupSessions, startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

describe('ledge tui: overview', () => {
  it('draws who waits, the projects by branch and the selected session’s request', async () => {
    const tui = await startTui();
    try {
      const f = tui.frame();
      expect(f).toContain('À TOI · 2');
      expect(f).toContain('2 t’attendent');
      expect(f).toMatch(/■ Ledge 3 sessions/);
      expect(f).toContain('⎇ release/LEDGE-42-v0.5.0');
      // The first one waiting is selected at start, its request and its keys on the right.
      expect(f).toContain('OTTO · CÂBLER LA LISTE DES SESSIONS');
      expect(f).toContain('Veut exécuter : npm test');
      expect(f).toMatch(/Autoriser y .*Refuser n .*Toujours A/);
    } finally { await tui.cleanup(); }
  });

  it('y allows the selected request, with the request it saw', async () => {
    const tui = await startTui();
    try {
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'session.decide').length === 1);
      const otto = mockupSessions()[0]!;
      expect(sent(tui.daemon.received, 'session.decide')[0]).toEqual({ type: 'session.decide', id: 'otto', decision: 'accept', expect: { kind: 'permission', text: 'npm test', key: pendingKey(otto.pending!) } });
      // Landed once the request goes: the toast says so.
      tui.daemon.upsert({ ...otto, state: 'working', pending: undefined });
      await until(() => tui.frame().includes('✓ Otto : autorisé'));
    } finally { await tui.cleanup(); }
  });

  it('tab goes to the next one waiting, a digit answers its question', async () => {
    const tui = await startTui();
    try {
      await tui.press('\t');
      await until(() => tui.frame().includes('Demande : Quel port pour le serveur de dev ?'));
      expect(tui.frame()).toMatch(/1 · 3000 1 .*2 · 5173 2 .*3 · 8080 3/);
      await tui.press('2');
      await until(() => sent(tui.daemon.received, 'session.reply').length === 1);
      expect(sent(tui.daemon.received, 'session.reply')[0]).toEqual({ type: 'session.reply', id: 'luna', text: '2' });
    } finally { await tui.cleanup(); }
  });

  it('j and k walk the tree; a digit on a session without question switches screens', async () => {
    const tui = await startTui();
    try {
      await tui.press('j');
      await until(() => tui.frame().includes('NOVA · RECONNEXION SSH DU FLEET'));
      await tui.press('k');
      await until(() => tui.frame().includes('OTTO · CÂBLER'));
      await tui.press('4');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
    } finally { await tui.cleanup(); }
  });

  it('a attaches this terminal to the session’s pane through the machine’s launcher', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.press('a');
      await until(() => runs.length === 1);
      expect(runs[0]).toEqual(['node', '/opt/ledge/cli.js', 'attach', 'otto']);
    } finally { await tui.cleanup(); }
  });

  it('back from an attach, the title is written again: the attached program may have set its own', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ run: async argv => { runs.push(argv); return 0; } });
    const titles = () => tui.written().split('\u001b]0;').length - 1;
    try {
      await until(() => titles() > 0);
      const before = titles();
      await tui.press('a');
      await until(() => runs.length === 1);
      await until(() => titles() === before + 1);
    } finally { await tui.cleanup(); }
  });

  it('an OMP session has nothing to attach to', async () => {
    const runs: string[][] = [];
    const tui = await startTui({ sessions: [mockupSessions()[0]!, { ...mockupSessions()[1]!, id: 'omp1', name: 'Milo', tool: 'omp', backend: 'omp-rpc', tmuxSession: null }], run: async argv => { runs.push(argv); return 0; } });
    try {
      await tui.press('j');
      await until(() => tui.frame().includes('MILO'));
      await tui.press('a');
      await until(() => tui.frame().includes('pas de terminal à attacher'));
      expect(runs).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('says it when the daemon goes away, and keeps the sessions it knew', async () => {
    const tui = await startTui();
    try {
      await tui.daemon.close();
      await until(() => tui.frame().includes('daemon injoignable'));
      expect(tui.frame()).toContain('Otto');
    } finally { await tui.cleanup(); }
  });
});
