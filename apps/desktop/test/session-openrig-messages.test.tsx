import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { DaemonInfo, RigInfo, ThreadItem } from '@ledge/protocol';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { activeCount } from '../src/nav/agents';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { loadWorkspace } from '../src/session/lazy';
import { aboutLine } from '../src/session/RigItems';
import { listSessions, PROJECTS, type MockDaemon } from './helpers';

/* OpenRig's messages in a seat's thread (docs/mockups/ledge-openrig-messages.html, validated 2026-11-02): the daemon's
   interpreted items (`rig`) render as bubbles, task cards and notices, never as « Vous ». */
const daemons: MockDaemon[] = [];
afterEach(async () => { cleanup(); localStorage.clear(); for (const d of daemons.splice(0)) await d.close(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Fil de la session' }));
const at = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();
const ROWS: DaemonInfo = { version: '0.38.0', install: 'npm', systemd: true, openrigRows: true };
const HANDOFF = 'qitem-20261102190205-c0704682203041b9';
const rig = (kind: RigInfo['kind'], extra: Partial<RigInfo> = {}): RigInfo => ({ kind, from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', sentAt: at(0), gen: '45f7085e', raw: `From: pilot-lead@ledge-dev-2\nraw ${kind}`, ...extra });
const received = (id: string, s: number, text: string, extra: Partial<RigInfo> = {}): ThreadItem => ({ kind: 'received', id, at: at(s), turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'bix', text, rig: rig('message', extra) });
const notice = (id: string, s: number, text: string, r: RigInfo, extra: Partial<Extract<ThreadItem, { kind: 'notice' }>> = {}): ThreadItem => ({ kind: 'notice', id, at: at(s), turn: 1, notice: 'other', text, rig: r, ...extra });

async function openOtto(items: ThreadItem[], daemon: DaemonInfo | null = ROWS) {
  await loadWorkspace();
  localStorage.setItem('desktop.lang', 'fr');
  localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  if (daemon) d.extras.daemon = daemon;
  const sessions = listSessions().map(s => s.id === 'otto' ? { ...s, rig: { seat: 'design-ux@ledge-dev-2', name: 'ledge-dev-2' } } : s.id === 'bix' ? { ...s, state: 'idle' as const, rig: { seat: 'pilot-lead@ledge-dev-2', name: 'ledge-dev-2' } } : s);
  for (const s of sessions) d.upsert(s);
  d.thread('otto', items);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions))));
  const user = userEvent.setup();
  await user.click(within(side.getByRole('tree')).getByRole('button', { name: /^Otto/ }));
  await screen.findByRole('tabpanel', { name: 'Fil de la session' });
  return { d, user };
}

describe('OpenRig messages in a seat’s thread', () => {
  it('a message is the sender’s bubble, never « Vous »; Reply opens the sender’s composer, prefixed', async () => {
    const body = 'Validation maquette encoche (qitem-20261102184644). Ses mots : « Tout est ok, sauf le bouton play. Je veux pas qu’il soit simple et pas rond ».';
    const { user } = await openOtto([received('r1', 0, body)]);
    const card = (await thread().findByText(/Validation maquette encoche/)).closest<HTMLElement>('[data-message="r1"]')!;
    expect(card).toHaveAttribute('data-rig', 'message');
    expect(thread().queryByText('Vous')).toBeNull();
    expect(card).toHaveTextContent(/De.*Bix.*pilot-lead/);
    // Same rig as the thread's session: no rig tag.
    expect(card.querySelector('.rigtag')).toBeNull();
    expect(within(card).getByRole('button', { name: 'voir son fil' })).toBeVisible();
    // The raw, one click away.
    const raw = within(card).getByText('Message brut').closest('details')!;
    expect(raw).not.toHaveAttribute('open');
    expect(raw.querySelector('pre')).toHaveTextContent('From: pilot-lead@ledge-dev-2');
    // « Répondre à Bix » (decision 1): Bix's page, its field focused, the prefix and a blank line, the cursor under it.
    await user.click(within(card).getByRole('button', { name: 'Répondre à Bix' }));
    const field = await screen.findByRole('textbox', { name: 'Répondre à l’agent' });
    const prefix = `À propos de : « ${aboutLine(body)} »\n\n`;
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(prefix));
    expect(document.activeElement).toBe(field);
    expect((field as HTMLTextAreaElement).selectionStart).toBe(prefix.length);
    expect(aboutLine(body).length).toBeLessThanOrEqual(80);
    expect(aboutLine(body).endsWith('…')).toBe(true);
  });

  it('a sender Ledge does not know: its seat, its rig, no Reply nor « voir son fil »', async () => {
    await openOtto([{ kind: 'received', id: 'r2', at: at(0), turn: 1, from: 'operator-agent@kernel', text: '« Oui, now » : lance la maquette.', rig: rig('message', { from: 'operator-agent@kernel' }) }]);
    const card = (await thread().findByText(/lance la maquette/)).closest<HTMLElement>('[data-message="r2"]')!;
    expect(card).toHaveTextContent(/De.*operator-agent.*operator-agent.*kernel/);
    expect(card.querySelector('.rigtag')).toHaveTextContent('kernel');
    expect(within(card).queryByRole('button', { name: /Répondre/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'voir son fil' })).toBeNull();
  });

  it('a row handed to this seat is a task card with its live state; no « Ouvrir la ligne »', async () => {
    const { d } = await openOtto([notice('n1', 0, 'Queue handoff…', rig('handoff', { qitem: HANDOFF, summary: 'Retouche maquette encoche : bouton lecture/pause en icône simple sans disque' }), { peer: 'bix', name: 'pilot-lead@ledge-dev-2' })]);
    const card = (await thread().findByText(/Retouche maquette encoche/)).closest<HTMLElement>('[data-rig="handoff"]')!;
    expect(card).toHaveTextContent('Ligne confiée par Bix');
    expect(card).toHaveTextContent('…704682'.replace('704682', HANDOFF.slice(-6)));
    let m: { requestId: string; qitem: string } | undefined;
    await waitFor(() => { m = d.received.find((x): x is Extract<typeof x, { type: 'openrig.row' }> => x.type === 'openrig.row'); expect(m).toBeDefined(); });
    expect(m!.qitem).toBe(HANDOFF);
    d.reply({ type: 'openrig.rowState', requestId: m!.requestId, qitem: HANDOFF, row: { id: HANDOFF, state: 'in-progress', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', createdAt: at(2), claimedAt: at(3), updatedAt: at(3), at: at(4), summary: 'Retouche' } });
    await waitFor(() => expect(card.querySelector('[data-state]')).toHaveAttribute('data-state', 'taken'));
    expect(card.querySelector('[data-state]')).toHaveTextContent('prise');
    expect(card).toHaveTextContent(/De Bix pilot-lead/);
    expect(card).toHaveTextContent(/Tenue par Otto design-ux/);
    expect(card).toHaveTextContent(/confiée \d\d:\d\d · prise \d\d:\d\d/);
    expect(screen.queryByRole('button', { name: /Ouvrir la ligne/ })).toBeNull();
  });

  it('without a daemon that answers rows, the card says « état non suivi » and asks nothing', async () => {
    const { d } = await openOtto([notice('n1', 0, 'Queue handoff…', rig('handoff', { qitem: HANDOFF, summary: 'Une ligne' }), { peer: 'bix' })], null);
    const card = (await thread().findByText('Une ligne')).closest<HTMLElement>('[data-rig="handoff"]')!;
    expect(card.querySelector('[data-state]')).toHaveAttribute('data-state', 'unknown');
    expect(card.querySelector('[data-state]')).toHaveTextContent('état non suivi');
    expect(card).toHaveTextContent(/confiée \d\d:\d\d · Ledge ne relit pas cette ligne/);
    await new Promise(r => setTimeout(r, 100));
    expect(d.received.filter(m => m.type === 'openrig.row')).toEqual([]);
  });

  it('what the seat sends: a sent bubble « À … ✓ remis » and a « Ligne passée à… » card, the command in the raw', async () => {
    await openOtto([
      { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Préviens dev-front' },
      { kind: 'sent', id: 's1', at: at(5), turn: 1, to: 'dev-front@ledge-dev-2', text: 'Maquette encoche validée par l’utilisateur.', status: 'delivered', rig: { kind: 'message', to: 'dev-front@ledge-dev-2', command: 'rig send dev-front@ledge-dev-2 "…"', raw: 'rig send dev-front@ledge-dev-2 "…"\nSent to dev-front@ledge-dev-2' } },
      notice('o1', 6, 'rig queue handoff', { kind: 'handoff', to: 'pilot-lead@ledge-dev-2', summary: 'Maquette rendue : 6 questions ouvertes', qitem: 'qitem-20261102184644-9135ca8ab464cdb0', command: 'rig queue handoff …', raw: 'rig queue handoff …' }, { outgoing: true })
    ], null);
    const bubble = (await thread().findByText(/Maquette encoche validée/)).closest<HTMLElement>('[data-message="s1"]')!;
    expect(bubble).toHaveClass('sent');
    expect(bubble).toHaveTextContent(/À.*dev-front.*✓remis/);
    expect(within(bubble).getByText('Commande')).toBeVisible();
    const card = thread().getByText(/6 questions ouvertes/).closest<HTMLElement>('[data-rig="handoff"]')!;
    expect(card).toHaveClass('out');
    expect(card).toHaveTextContent('Ligne passée à Bix');
    expect(card).toHaveTextContent(/passée \d\d:\d\d · Ledge ne relit pas cette ligne/);
    // In its exchange, after the prompt (where the agent ran it), not before it.
    const rows = [...card.closest('.turn')!.querySelectorAll('.prompt-block, [data-message="s1"], [data-rig="handoff"]')];
    expect(rows.map(r => r.matches('.prompt-block') ? 'prompt' : r.getAttribute('data-message') ?? 'card')).toEqual(['prompt', 's1', 'card']);
  });

  it('a handoff OpenRig did not take: « non transmise » in red, OpenRig’s reason in the log, the output in the raw', async () => {
    await openOtto([
      { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Passe la ligne' },
      notice('o2', 6, 'rig queue handoff', { kind: 'handoff', to: 'pilot-lead@ledge-dev-2', summary: 'Relire la maquette', command: 'rig queue handoff qitem-x --to pilot-lead@ledge-dev-2', raw: 'rig queue handoff qitem-x --to pilot-lead@ledge-dev-2\nError: qitem qitem-x is not claimed by dev-front@ledge-dev-2\n  at handoff' }, { outgoing: true, status: 'refused' })
    ], null);
    const card = (await thread().findByText('Relire la maquette')).closest<HTMLElement>('[data-rig="handoff"]')!;
    expect(card.querySelector('[data-state]')).toHaveAttribute('data-state', 'notHanded');
    expect(card.querySelector('[data-state]')).toHaveTextContent('non transmise');
    expect(card).toHaveTextContent(/passée \d\d:\d\d · OpenRig : Error: qitem qitem-x is not claimed by dev-front@ledge-dev-2/);
    expect(card.querySelector('pre')).toHaveTextContent('at handoff');
  });

  it('notices: a row unblocked in violet, a stuck sweep in amber, quiet ones folded to one line', async () => {
    const { user } = await openOtto([
      notice('u1', 0, 'Blocker … resolved', rig('unblocked', { from: 'daemon@kernel', qitem: 'qitem-20261102184941-4389f392504db9e3', blocker: 'qitem-20261102184222-c844fa05df894750' })),
      notice('a1', 1, 'Stuck sweep: stalled-after-claim on qitem-20261102193758-ffc1de6e4e82e13b (7 min)', rig('openrig', { from: 'daemon@kernel', alert: 'stalled', qitem: 'qitem-20261102193758-ffc1de6e4e82e13b', minutes: 7 })),
      notice('q1', 2, 'Custody not checked', rig('openrig', { from: 'daemon@kernel', alert: 'custody', qitem: 'qitem-20261102193758-ffc1de6e4e82e13b', minutes: 9 })),
      notice('q2', 3, 'relance levée', rig('openrig', { from: 'daemon@kernel' }))
    ]);
    const unblocked = (await thread().findByText(/Blocage levé/)).closest<HTMLElement>('[data-rig="unblocked"]')!;
    expect(unblocked).toHaveClass('task');
    expect(unblocked).toHaveTextContent('Blocage levé : la ligne …9e3 est de nouveau à faire'.replace('…9e3', '…' + '4389f392504db9e3'.slice(-4)));
    expect(unblocked).toHaveTextContent('Elle attendait la ligne …' + 'c844fa05df894750'.slice(-4) + ', qui est close.');
    const stalled = thread().getByText(/sans suite/).closest<HTMLElement>('[data-rig="openrig"]')!;
    expect(stalled).toHaveClass('warn');
    expect(stalled).toHaveTextContent('OpenRig · automatique');
    expect(stalled).toHaveTextContent('Ligne …' + 'ffc1de6e4e82e13b'.slice(-4) + ' prise il y a 7 min, sans suite');
    // The two quiet ones: one line, unfolded on a click.
    const fold = thread().getByRole('button', { name: /2 avis OpenRig/ });
    expect(fold).toHaveTextContent('2 avis OpenRig · Custody not checked, relance levée');
    await user.click(fold);
    expect(thread().getAllByText('OpenRig · automatique')).toHaveLength(3);
  });

  it('a packet of quiet notices, folded, keeps its one raw after the group; so does a message followed by two', async () => {
    const quiet = (id: string, s: number, text: string, index: number, count: number, packet: string) =>
      notice(id, s, text, rig('openrig', { from: 'daemon@kernel', packet: { id: packet, index, count }, raw: `RAW ${id}` }));
    const { user } = await openOtto([
      quiet('q1', 0, 'Custody not checked', 0, 2, 'pa'),
      quiet('q2', 1, 'relance levée', 1, 2, 'pa'),
      { kind: 'prompt', id: 'p2', at: at(2), turn: 2, text: 'Ensuite' },
      { ...(received('m1', 3, 'Un message, puis deux avis.', { packet: { id: 'pb', index: 0, count: 3 }, raw: 'RAW m1' }) as Extract<ThreadItem, { kind: 'received' }>), turn: 3 },
      { ...(quiet('q3', 4, 'Custody again', 1, 3, 'pb') as Extract<ThreadItem, { kind: 'notice' }>), turn: 3 },
      { ...(quiet('q4', 5, 'relance encore', 2, 3, 'pb') as Extract<ThreadItem, { kind: 'notice' }>), turn: 3 }
    ]);
    const rows = await thread().findAllByText(/messages collés ensemble · brut/);
    expect(rows.map(r => r.textContent)).toEqual(['2 messages collés ensemble · brut', '3 messages collés ensemble · brut']);
    const pre = (r: HTMLElement) => r.closest('.rig-packet-raw')!.querySelector('pre')!.textContent;
    expect(pre(rows[0]!)).toBe('RAW q1\nRAW q2');
    expect(pre(rows[1]!)).toBe('RAW m1\nRAW q3\nRAW q4');
    // Unfolded, the notices still give up their own raw; the packet's stays after them.
    await user.click(thread().getAllByRole('button', { name: /2 avis OpenRig/ })[0]!);
    const unfolded = thread().getByText('relance levée').closest<HTMLElement>('[data-rig="openrig"]')!;
    expect(unfolded.querySelector('details')).toBeNull();
    expect(thread().getAllByText(/messages collés ensemble · brut/)).toHaveLength(2);
  });

  it('a repeated delivery says « reçu 2 fois », blocks pasted together show one raw, an unreadable block stays as is', async () => {
    await openOtto([
      received('d1', 0, 'L’utilisateur retient l’option A.', { count: 2, raw: 'From: a\n\nFrom: a' }),
      received('k1', 1, '« Oui, now ».', { from: 'operator-agent@kernel', packet: { id: 'p9', index: 0, count: 2 }, raw: 'BLOCK ONE' }),
      received('k2', 2, 'Ligne créée pour toi.', { packet: { id: 'p9', index: 1, count: 2 }, raw: 'BLOCK TWO' }),
      notice('x1', 3, 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?', { kind: 'unreadable', raw: 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?' }),
      { kind: 'prompt', id: 'me', at: at(4), turn: 2, text: 'Regarde aussi le mobile.' }
    ]);
    const dup = (await thread().findByText('L’utilisateur retient l’option A.')).closest<HTMLElement>('[data-message="d1"]')!;
    expect(dup).toHaveTextContent('reçu 2 fois');
    expect(within(dup).getByText('2 envois bruts')).toBeVisible();
    const first = thread().getByText('« Oui, now ».').closest<HTMLElement>('[data-message="k1"]')!;
    const second = thread().getByText('Ligne créée pour toi.').closest<HTMLElement>('[data-message="k2"]')!;
    expect(first.querySelector('details')).toBeNull();
    expect(second.querySelector('details')).toBeNull();
    // One raw for the packet, after the group, as its own row.
    const packet = thread().getByText('2 messages collés ensemble · brut').closest<HTMLElement>('.rig-packet-raw')!;
    expect(packet.previousElementSibling).toBe(second.closest('li'));
    expect(packet.querySelector('pre')!.textContent).toBe('BLOCK ONE\nBLOCK TWO');
    const bad = thread().getByText('Message OpenRig illisible · affiché tel quel').closest<HTMLElement>('[data-rig="unreadable"]')!;
    expect(bad.querySelector('.rawbox')).toHaveTextContent('Relance : la maquette est-elle prête ?');
    // The user's own words stay « Vous ».
    expect(thread().getByText('Regarde aussi le mobile.').closest('.prompt-block')).toHaveTextContent('Vous');
  });
});
