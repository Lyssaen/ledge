import { describe, it, expect } from 'vitest';
import type { ClientMessage } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

describe('tui: m writes to the whole project of the selected session', () => {
  it('m opens the field titled with the project, ↵ sends session.broadcast to it and the toast tells who got it', async () => {
    const tui = await startTui();
    try {
      await tui.resize(160, 40);
      await until(() => tui.frame().includes('Otto') && tui.frame().includes('Ledge'));
      expect(tui.frame()).toMatch(/m +écrire à tout le projet/);
      await tui.press('m');
      await until(() => tui.frame().includes('ÉCRIRE À TOUT LE PROJET LEDGE'));
      // ↵ on an empty field sends nothing.
      await tui.press('\r');
      expect(sent(tui.daemon.received, 'session.broadcast')).toEqual([]);
      await tui.press('Pause café');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.broadcast').length === 1);
      const m = sent(tui.daemon.received, 'session.broadcast')[0]!;
      expect(m).toMatchObject({ type: 'session.broadcast', to: { project: 'ledge' }, text: 'Pause café' }); // the project's id, as the TUI resolved it
      await until(() => !tui.frame().includes('ÉCRIRE À TOUT LE PROJET'));
      tui.daemon.push({ type: 'session.broadcast.result', rid: m.rid, sent: [{ id: 'nova', name: 'Nova' }, { id: 'bix', name: 'Bix' }], refused: [{ name: 'Zed', reason: "Zed s'est terminée" }] });
      await until(() => tui.frame().includes('Envoyé à Nova, Bix'));
      expect(tui.frame()).toContain("Zed s'est terminée");
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('a refusal of nobody is told, esc leaves the field with nothing sent, a session without project gets a toast', async () => {
    const tui = await startTui();
    try {
      await until(() => tui.frame().includes('Otto') && tui.frame().includes('Ledge'));
      await tui.press('m');
      await until(() => tui.frame().includes('ÉCRIRE À TOUT LE PROJET'));
      await tui.press('Salut');
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('ÉCRIRE À TOUT LE PROJET'));
      expect(sent(tui.daemon.received, 'session.broadcast')).toEqual([]);
      await tui.press('m');
      await until(() => tui.frame().includes('ÉCRIRE À TOUT LE PROJET'));
      await tui.press('Salut');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.broadcast').length === 1);
      const m = sent(tui.daemon.received, 'session.broadcast')[0]!;
      tui.daemon.push({ type: 'session.broadcast.result', rid: m.rid, sent: [], refused: [], reason: "personne d'autre dans le projet Ledge" });
      await until(() => tui.frame().includes("Non envoyé : personne d'autre dans le projet Ledge"));
    } finally { await tui.cleanup(); }
  }, 20_000);

  it("a session that is in no project: a toast, no field", async () => {
    const tui = await startTui({ sessions: [fakeSession('solo', { name: 'Solo', cwd: '/w/elsewhere', repo: 'elsewhere', repoPath: '/w/elsewhere', project: 'elsewhere', state: 'idle' })] });
    try {
      await until(() => tui.frame().includes('Solo'));
      await tui.press('m');
      await until(() => tui.frame().includes("cette session n'est dans aucun projet"));
      expect(tui.frame()).not.toContain('ÉCRIRE À TOUT LE PROJET');
      expect(sent(tui.daemon.received, 'session.broadcast')).toEqual([]);
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('every machine silent: said in words, not as the code', async () => {
    const tui = await startTui();
    try {
      await until(() => tui.frame().includes('Otto') && tui.frame().includes('Ledge'));
      await tui.press('m');
      await until(() => tui.frame().includes('ÉCRIRE À TOUT LE PROJET'));
      await tui.press('Salut');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'session.broadcast').length === 1);
      const m = sent(tui.daemon.received, 'session.broadcast')[0]!;
      tui.daemon.push({ type: 'session.broadcast.result', rid: m.rid, sent: [], refused: [], reason: 'silent' });
      await until(() => tui.frame().includes("Non envoyé : aucune machine n'a répondu"));
      expect(tui.frame()).not.toContain('Non envoyé : silent');
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('a local daemon that does not take a broadcast: no m in the key bar, m does nothing', async () => {
    const tui = await startTui({ broadcast: false });
    try {
      await tui.resize(160, 40);
      await until(() => tui.frame().includes('Otto') && tui.frame().includes('Ledge'));
      expect(tui.frame()).not.toMatch(/m +écrire à tout le projet/);
      await tui.press('m');
      await new Promise(r => setTimeout(r, 200));
      expect(tui.frame()).not.toContain('ÉCRIRE À TOUT LE PROJET');
      expect(tui.frame()).not.toContain("cette session n'est dans aucun projet");
      expect(sent(tui.daemon.received, 'session.broadcast')).toEqual([]);
    } finally { await tui.cleanup(); }
  }, 20_000);
});
