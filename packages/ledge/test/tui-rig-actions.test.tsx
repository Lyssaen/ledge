import { afterEach, describe, it, expect, vi } from 'vitest';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, Rig, ServerMessage } from '@ledge/protocol';
import { adoptChoices, rigCall } from '../src/tui/model/rigActions.js';
import { until } from './helpers.js';
import { mockupRigs, PROJECTS, startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const ESC = '\u001b';

/** The mockup's off-project rig: atlas, in OpenRig's workspace, with the two repos its seats found on the way (web is Website's). */
const atlas = (extra: Partial<Rig> = {}): Rig => ({
  id: 'atlas', name: 'atlas', machine: 'local', cwd: '/home/u/.openrig/workspace/atlas', projectId: null, offProject: true, lifecycle: 'running', kernel: false,
  seats: [{ ref: 'dev@atlas', address: '@build', name: 'dev', runtime: 'claude-code', model: 'opus', state: 'working' },
    { ref: 'review@atlas', address: '@review-a', name: 'review', runtime: 'codex', model: 'gpt-5.5', state: 'working' }],
  repos: [{ path: '/home/u/.openrig/workspace/atlas/api', name: 'api', branch: 'feat/client', remote: 'github.com/lyssaen/atlas-api', modified: 2, by: 'dev@atlas', how: 'cloned' },
    { path: '/w/website', name: 'web', branch: 'feat/WEB-20-api', modified: 1, by: 'dev@atlas', how: 'opened' }],
  ...extra
});

/** The room of the rig named `name`, on a wide terminal: 2 opens factory's, j walks down to the next rigs'. */
async function openRoom(tui: Awaited<ReturnType<typeof startTui>>, name: string) {
  await tui.resize(160, 46);
  await until(() => tui.frame().includes('factory'));
  await tui.press('2');
  const title = `▣ ${name.toUpperCase()} · RIG`;
  for (let i = 0; i < 40 && !tui.frame().includes(title); i++) await tui.press('j');
  await until(() => tui.frame().includes(title));
}

/** The daemon answers every rig.act / rig.adopt with `result`. */
const answer = (daemon: Awaited<ReturnType<typeof startTui>>['daemon'], result: { ok: boolean; code?: 'openrig_down' | 'rig_managed'; reason?: string }) =>
  daemon.onMessage(m => { if (m.type === 'rig.act' || m.type === 'rig.adopt') daemon.reply({ type: 'rig.result', rid: m.rid, ...result }); });

describe('ledge tui: a rig\'s actions through OpenRig', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('S then « Arrêter le rig » sends rig.act down after confirmation', async () => {
    const tui = await startTui({ openrig: {} });
    answer(tui.daemon, { ok: true });
    try {
      await openRoom(tui, 'factory');
      expect(tui.frame()).toMatch(/S +arrêter…/);
      await tui.press('S');
      await until(() => tui.frame().includes('ARRÊTER FACTORY ?'));
      expect(tui.frame()).toContain('◉ Arrêter le rig');
      expect(tui.frame()).toContain('○ Seulement ce siège · orch-lead');
      await new Promise(r => setTimeout(r, 50));
      expect(sent(tui.daemon.received, 'rig.act')).toEqual([]);
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'rig.act').length === 1);
      expect(sent(tui.daemon.received, 'rig.act')[0]).toMatchObject({ machine: 'local', rigId: 'factory', verb: 'down' });
      expect(sent(tui.daemon.received, 'rig.act')[0]).not.toHaveProperty('seatRef');
      await until(() => tui.frame().includes('factory s’arrête'));
      expect(tui.frame()).not.toContain('ARRÊTER FACTORY ?');
    } finally { await tui.cleanup(); }
  });

  it('S then « Seulement ce siège » stops the selected seat; esc cancels', async () => {
    const tui = await startTui({ openrig: {} });
    answer(tui.daemon, { ok: true });
    try {
      await openRoom(tui, 'factory');
      await tui.press('S');
      await until(() => tui.frame().includes('ARRÊTER FACTORY ?'));
      await tui.press(ESC);
      await until(() => !tui.frame().includes('ARRÊTER FACTORY ?'));
      expect(tui.frame()).toContain('▣ FACTORY · RIG');
      await tui.press('S');
      await until(() => tui.frame().includes('ARRÊTER FACTORY ?'));
      await tui.press('j');
      await until(() => tui.frame().includes('◉ Seulement ce siège'));
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'rig.act').length === 1);
      expect(sent(tui.daemon.received, 'rig.act')[0]).toMatchObject({ machine: 'local', rigId: 'factory', seatRef: 'orch-lead@factory', verb: 'stop' });
      await until(() => tui.frame().includes('orch-lead s’arrête'));
    } finally { await tui.cleanup(); }
  });

  it('r restarts the chosen seat after a one-line confirmation', async () => {
    const tui = await startTui({ openrig: {} });
    answer(tui.daemon, { ok: true });
    try {
      await openRoom(tui, 'factory');
      await tui.press('j');
      await until(() => tui.frame().includes('TERMINAL · BUILD · FACTORY'));
      await tui.press('r');
      await until(() => tui.frame().includes('Relancer build par OpenRig ?'));
      expect(sent(tui.daemon.received, 'rig.act')).toEqual([]);
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'rig.act').length === 1);
      expect(sent(tui.daemon.received, 'rig.act')[0]).toMatchObject({ rigId: 'factory', seatRef: 'build@factory', verb: 'restart' });
      await until(() => tui.frame().includes('build redémarre'));
    } finally { await tui.cleanup(); }
  });

  it('a stopped rig offers « Reprendre » (restore)', async () => {
    const rigs = mockupRigs().map(r => (r.id === 'factory' ? { ...r, lifecycle: 'stopped' as const, seats: r.seats.map(s => ({ ...s, state: 'stopped' as const })) } : r));
    const tui = await startTui({ openrig: { rigs } });
    answer(tui.daemon, { ok: true });
    try {
      await openRoom(tui, 'factory');
      expect(tui.frame()).toMatch(/u +reprendre/);
      expect(tui.frame()).not.toMatch(/S +arrêter…/);
      await tui.press('u');
      await until(() => sent(tui.daemon.received, 'rig.act').length === 1);
      expect(sent(tui.daemon.received, 'rig.act')[0]).toMatchObject({ rigId: 'factory', verb: 'restore' });
      await until(() => tui.frame().includes('factory reprend'));
    } finally { await tui.cleanup(); }
  });

  it('adoptChoices puts the project that already holds a repo first', () => {
    expect(adoptChoices(atlas(), PROJECTS)).toEqual([
      { projectId: 'website', label: 'Website', note: 'contient déjà web' },
      { projectId: 'ledge', label: 'Ledge' },
      { projectId: null, label: 'Laisser hors projet' }
    ]);
    expect(adoptChoices(atlas(), null)).toEqual([{ projectId: null, label: 'Laisser hors projet' }]);
  });

  it('an off-project rig shows the repos found on the way; p then ↵ adopts it', async () => {
    const tui = await startTui({ openrig: { rigs: [...mockupRigs(), atlas()] } });
    answer(tui.daemon, { ok: true });
    try {
      await openRoom(tui, 'atlas');
      const f = tui.frame();
      expect(f).toContain('▣ ATLAS · RIG · HORS PROJET');
      expect(f).toContain('DÉPÔTS TROUVÉS EN ROUTE · 2');
      expect(f).toMatch(/⎇ api +github\.com\/lyssaen\/atlas-api +cloné par dev · ⎇ feat\/client/);
      expect(f).toMatch(/⎇ web +\/w\/website +ouvert par dev · ⎇ feat\/WEB-20-api/);
      expect(f).toContain('web est déjà un dépôt du projet Website.');
      expect(f).toMatch(/p +ranger dans un projet…/);
      await tui.press('p');
      await until(() => tui.frame().includes('RANGER ATLAS DANS UN PROJET ?'));
      expect(tui.frame()).toMatch(/◉ ■ Website +contient déjà web/);
      expect(tui.frame()).toContain('○ ■ Ledge');
      expect(tui.frame()).toContain('○ Laisser hors projet');
      expect(tui.frame()).toContain('atlas garde sa pièce ; sa plaque dira « dans Website ». Il ne devient pas une seconde table de Website.');
      await tui.press('\r');
      await until(() => sent(tui.daemon.received, 'rig.adopt').length === 1);
      expect(sent(tui.daemon.received, 'rig.adopt')[0]).toMatchObject({ machine: 'local', rigId: 'atlas', projectId: 'website' });
      await until(() => tui.frame().includes('atlas rangé dans Website'));
    } finally { await tui.cleanup(); }
  });

  it('« Laisser hors projet » sends nothing; a remote off-project rig offers no p', async () => {
    const remote = atlas({ id: 'far', name: 'far', machine: 'ec2' });
    const tui = await startTui({ openrig: { rigs: [...mockupRigs(), atlas(), remote] } });
    try {
      await openRoom(tui, 'atlas');
      await tui.press('p');
      await until(() => tui.frame().includes('RANGER ATLAS DANS UN PROJET ?'));
      await tui.press('j'); await tui.press('j');
      await until(() => tui.frame().includes('◉ Laisser hors projet'));
      await tui.press('\r');
      await until(() => !tui.frame().includes('RANGER ATLAS DANS UN PROJET ?'));
      expect(sent(tui.daemon.received, 'rig.adopt')).toEqual([]);
      for (let i = 0; i < 40 && !tui.frame().includes('▣ FAR · RIG'); i++) await tui.press('j');
      await until(() => tui.frame().includes('▣ FAR · RIG'));
      expect(tui.frame()).not.toMatch(/p +ranger dans un projet…/);
      await tui.press('p');
      await new Promise(r => setTimeout(r, 100));
      expect(tui.frame()).not.toContain('RANGER FAR DANS UN PROJET ?');
    } finally { await tui.cleanup(); }
  });

  it('a refused action shows its reason', async () => {
    const tui = await startTui({ openrig: {} });
    answer(tui.daemon, { ok: false, code: 'openrig_down', reason: 'OpenRig est arrêté' });
    try {
      await openRoom(tui, 'factory');
      await tui.press('S');
      await until(() => tui.frame().includes('ARRÊTER FACTORY ?'));
      await tui.press('\r');
      await until(() => tui.frame().includes('OpenRig est arrêté'));
    } finally { await tui.cleanup(); }
  });

  it('a paired seat offers no kill or close key, and a rig_managed refusal is a toast', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await openRoom(tui, 'factory');
      await tui.press('j');
      await until(() => tui.frame().includes('TERMINAL · BUILD · FACTORY'));
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE'));
      const f = tui.frame();
      expect(f).not.toMatch(/tuer|fermer|archiver|supprimer|kill|close/i);
      // Changing its model resumes the session: OpenRig's to do, not Ledge's.
      expect(f).not.toMatch(/m +modèle/);
      tui.daemon.push({ type: 'error', message: 'this session is a seat of an OpenRig rig: stop or restart it through its rig', request: 'session.model', code: 'rig_managed' } as ServerMessage);
      await until(() => tui.frame().includes('Ce siège appartient à son rig'));
    } finally { await tui.cleanup(); }
  });
});

describe('rigCall', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** A client whose fleet hands every machine's messages to onMachineMessage, as fleet.ts does. */
  const fakeClient = () => {
    const machine = new Set<(machine: string, m: ServerMessage) => void>(), local = new Set<(m: ServerMessage) => void>();
    const sentMsgs: ClientMessage[] = [];
    const client = {
      send: (m: ClientMessage) => { sentMsgs.push(m); },
      onMessage: (fn: (m: ServerMessage) => void) => { local.add(fn); return () => { local.delete(fn); }; },
      fleet: { onMachineMessage: (fn: (machine: string, m: ServerMessage) => void) => { machine.add(fn); return () => { machine.delete(fn); }; } }
    } as unknown as DaemonClient;
    return { client, sentMsgs, fromMachine: (id: string, m: ServerMessage) => machine.forEach(fn => fn(id, m)), fromFleet: (m: ServerMessage) => local.forEach(fn => fn(m)) };
  };

  it('resolves with the rig.result of its rid, from a remote machine too', async () => {
    const c = fakeClient();
    const p = rigCall(c.client, { type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'far', verb: 'down' });
    expect(c.sentMsgs).toEqual([{ type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'far', verb: 'down' }]);
    c.fromMachine('ec2', { type: 'rig.result', rid: 'other', ok: true });
    c.fromMachine('ec2', { type: 'rig.result', rid: 'r1', ok: false, code: 'unreachable', reason: 'not this machine' });
    await expect(p).resolves.toEqual({ ok: false, code: 'unreachable', reason: 'not this machine' });
  });

  it('a machine offline (the fleet\'s own refusal) ends it', async () => {
    const c = fakeClient();
    const p = rigCall(c.client, { type: 'rig.adopt', rid: 'r2', machine: 'ec2', rigId: 'far', projectId: 'website' });
    c.fromFleet({ type: 'error', message: 'ec2 is offline', request: 'rig.adopt' });
    await expect(p).resolves.toEqual({ ok: false, code: 'unreachable', reason: 'ec2 is offline' });
  });

  it('gives up after 5 s', async () => {
    vi.useFakeTimers();
    const c = fakeClient();
    const p = rigCall(c.client, { type: 'rig.act', rid: 'r3', machine: 'local', rigId: 'factory', verb: 'down' });
    vi.advanceTimersByTime(5000);
    await expect(p).resolves.toEqual({ ok: false, code: 'failed', reason: 'timeout' });
  });
});
