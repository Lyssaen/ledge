import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { ThreadItem } from '@ledge/protocol';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { activeCount } from '../src/nav/agents';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { loadWorkspace } from '../src/session/lazy';
import { listSessions, PROJECTS, type MockDaemon } from './helpers';

const daemons: MockDaemon[] = [];
afterEach(async () => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; cleanup(); localStorage.clear(); for (const d of daemons.splice(0)) await d.close(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Fil de la session' }));
const at = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();

const prompt = (id: string, s: number, turn: number, text: string): ThreadItem => ({ kind: 'prompt', id, at: at(s), turn, text });
const sent = (id: string, s: number, turn: number, extra: Partial<Extract<ThreadItem, { kind: 'sent' }>> = {}): ThreadItem =>
  ({ kind: 'sent', id, at: at(s), turn, to: 'nova', peer: 'nova', summary: `Résumé ${id}`, text: `Texte ${id}`, status: 'delivered', ...extra });
const received = (id: string, s: number, turn: number, extra: Partial<Extract<ThreadItem, { kind: 'received' }>> = {}): ThreadItem =>
  ({ kind: 'received', id, at: at(s), turn, from: 'nova', peer: 'nova', text: `Texte ${id}`, ...extra });

/** Otto's page in French, its thread `items`. */
async function openOtto(items: ThreadItem[]) {
  await loadWorkspace();
  localStorage.setItem('desktop.lang', 'fr');
  localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  for (const s of listSessions()) d.upsert(s);
  d.thread('otto', items);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  // Ready as `boot` is: the Atelier counter shows the active sessions, the last project's row is in the sidebar.
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(listSessions()))));
  await side.findByRole('button', { name: /^Docs/ });
  expect(within(screen.getByRole('banner')).getByText('Atelier')).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Liste' })).toBeNull();
  const user = userEvent.setup();
  await user.click(within(side.getByRole('tree')).getByRole('button', { name: /^Otto/ }));
  await screen.findByRole('tabpanel', { name: 'Fil de la session' });
  return { d, user };
}

describe('messages between agents in the thread', () => {
  it('a received message is a card signed by its sender, not « Vous »', async () => {
    await openOtto([received('r1', 0, 1, { text: 'Le schéma de paiement est prêt.', sent: 's9' })]);
    const card = (await thread().findByText('Le schéma de paiement est prêt.')).closest<HTMLElement>('[data-message="r1"]')!;
    expect(card).not.toBeNull();
    expect(document.querySelector('.session-thread .prompt-block')).toBeNull();
    expect(card).toHaveTextContent('Message reçu');
    expect(within(card).getByText('Nova', { selector: 'strong' })).toBeVisible();
    expect(within(card).getByText('Otto', { selector: 'strong' })).toBeVisible();
    expect(thread().queryByText('Vous')).toBeNull();
    // Opened by received messages only, with nothing after them: no author line.
    expect(document.querySelector('.session-thread .turn-author')).toBeNull();
    expect(within(card).getByRole('button', { name: /Voir dans le fil de Nova/ })).toBeVisible();
  });

  it('a sent message shows its summary and « Lu par Nova »', async () => {
    await openOtto([prompt('p1', 0, 1, 'Préviens Nova'), sent('s1', 5, 1, { summary: 'Le schéma est prêt', text: 'Tout est dans docs/schema.md.', status: 'read', received: 'r1' })]);
    const card = (await thread().findByText('Le schéma est prêt')).closest<HTMLElement>('[data-message="s1"]')!;
    expect(card).toHaveTextContent('Message envoyé');
    expect(card).toHaveTextContent('Lu par Nova');
    expect(card).toHaveTextContent('✓✓');
    expect(within(card).getByText('Tout est dans docs/schema.md.')).toBeVisible();
    // The sent card follows the agent's author line, in its exchange.
    expect(card.closest('.turn')!.querySelector('.turn-author')).not.toBeNull();
  });

  it('a sent message waiting, failed or delivered says so', async () => {
    await openOtto([prompt('p1', 0, 1, 'Préviens'),
      sent('s1', 1, 1, { status: 'sending', to: 'kit', peer: 'kit' }), sent('s2', 2, 1, { status: 'failed', to: 'bix', peer: 'bix' }), sent('s3', 3, 1, { status: 'delivered' })]);
    await thread().findByText('Résumé s3');
    expect(document.querySelector('[data-message="s1"]')).toHaveTextContent('Envoi…');
    expect(document.querySelector('[data-message="s2"]')).toHaveTextContent('Non remis');
    expect(document.querySelector('[data-message="s3"]')).toHaveTextContent('Remis, pas encore lu');
  });

  it('three messages with Nova: one header, folding makes three lines and back', async () => {
    const { user } = await openOtto([
      received('r1', 0, 1, { text: 'Tu as le schéma ?' }),
      sent('s1', 5, 1, { summary: 'Oui, le voici' }),
      prompt('p2', 10, 2, 'Continue'),
      received('r2', 15, 2, { text: 'Merci !\nJe regarde.' })
    ]);
    await thread().findByText('Oui, le voici');
    const heads = document.querySelectorAll('.session-thread .message-head');
    expect(heads).toHaveLength(1);
    expect(heads[0]).toHaveTextContent('Échange avec Nova · 3 messages');
    expect(document.querySelectorAll('.session-thread .message-card')).toHaveLength(3);
    await user.click(thread().getByRole('button', { name: /Replier/ }));
    expect(document.querySelectorAll('.session-thread .message-card')).toHaveLength(0);
    const lines = [...document.querySelectorAll('.session-thread .message-line')];
    expect(lines.map(l => l.getAttribute('data-message'))).toEqual(['r1', 's1', 'r2']);
    expect(lines[1]).toHaveTextContent('Oui, le voici');
    expect(lines[2]).toHaveTextContent('Merci !');
    expect(lines[2]).not.toHaveTextContent('Je regarde.');
    // Still in its exchange.
    expect(lines[2]!.closest('.turn')).toHaveAttribute('aria-label', expect.stringMatching(/^Échange de /));
    expect(lines[2]!.closest('.turn')).not.toBe(lines[0]!.closest('.turn'));
    await user.click(thread().getByRole('button', { name: /Déplier/ }));
    expect(document.querySelectorAll('.session-thread .message-card')).toHaveLength(3);
    expect(document.querySelectorAll('.session-thread .message-line')).toHaveLength(0);
  });

  it('a long message is clamped until « Lire tout le message »', async () => {
    const { user } = await openOtto([received('r1', 0, 1, { text: 'Long. '.repeat(50) })]);
    const card = await screen.findByRole('article');
    const body = card.querySelector('.message-body')!;
    expect(body).toHaveClass('clamped');
    await user.click(within(card).getByRole('button', { name: 'Lire tout le message' }));
    expect(body).not.toHaveClass('clamped');
    await user.click(within(card).getByRole('button', { name: 'Réduire' }));
    expect(body).toHaveClass('clamped');
  });

  it('a short message is not clamped', async () => {
    await openOtto([received('r1', 0, 1, { text: 'Court.' })]);
    const card = await screen.findByRole('article');
    expect(card.querySelector('.message-body')).not.toHaveClass('clamped');
    expect(within(card).queryByRole('button', { name: 'Lire tout le message' })).toBeNull();
  });

  it('a peer outside Ledge: its name, no « Voir dans le fil »', async () => {
    await openOtto([received('r1', 0, 1, { from: 'zed', peer: undefined, text: 'Bonjour de loin.' })]);
    const card = (await thread().findByText('Bonjour de loin.')).closest<HTMLElement>('[data-message="r1"]')!;
    expect(within(card).getByText('zed', { selector: 'strong' })).toBeVisible();
    expect(within(card).queryByRole('button', { name: /Voir dans le fil/ })).toBeNull();
  });

  it('« Voir dans le fil de Nova » opens Nova’s session', async () => {
    const { user } = await openOtto([received('r1', 0, 1, { text: 'Coucou.', sent: 's9' })]);
    await user.click(await thread().findByRole('button', { name: /Voir dans le fil de Nova/ }));
    expect(await screen.findByRole('tabpanel', { name: 'Fil de la session' })).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:nova');
  });

  it('« Voir dans le fil de Nova » opens Nova on the paired message, lit', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { d, user } = await openOtto([prompt('p1', 0, 1, 'Préviens Nova'), sent('s1', 1, 1, { received: 'recv-1-0' }), sent('s2', 2, 1, { received: 'recv-1-1' })]);
    d.thread('nova', [received('recv-1-0', 3, 1, { from: 'otto', peer: 'otto', sent: 's1' }), received('recv-1-1', 4, 1, { from: 'otto', peer: 'otto', sent: 's2' })]);
    await user.click((await thread().findAllByRole('button', { name: /Voir dans le fil de Nova/ }))[0]!);
    await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:nova'));
    await waitFor(() => expect(document.querySelector('.message-card.lit[data-message="recv-1-0"]')).not.toBeNull());
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.message-card.lit')).toBeNull(), { timeout: 4000 });
  });

  it('« Voir dans le fil de Nova » lights the paired message once Nova\u2019s thread arrives after the page mounted', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { d, user } = await openOtto([prompt('p1', 0, 1, 'Préviens Nova'), sent('s1', 1, 1, { received: 'recv-1-0' })]);
    d.thread('nova', []); // Nova's page mounts on an empty thread; the paired message is pushed afterwards
    await user.click(await thread().findByRole('button', { name: /Voir dans le fil de Nova/ }));
    await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:nova'));
    expect(document.querySelector('.message-card.lit')).toBeNull();
    d.threadItem('nova', received('recv-1-0', 3, 1, { from: 'otto', peer: 'otto', sent: 's1' }));
    await waitFor(() => expect(document.querySelector('.message-card.lit[data-message="recv-1-0"]')).not.toBeNull());
  });

  it('a folded line is the first non-empty line, without its Markdown marker', async () => {
    const { user } = await openOtto([received('r1', 0, 1, { text: '\n# Titre du rapport\nSuite du texte.' }), received('r2', 1, 1, { text: '  > Citation\nAutre' }), received('r3', 2, 1, { text: '- Point\nAutre' })]);
    await user.click(await thread().findByRole('button', { name: /Replier/ }));
    const lines = [...document.querySelectorAll('.session-thread .message-line .message-line-text')].map(l => l.textContent);
    expect(lines).toEqual(['Titre du rapport', 'Citation', 'Point']);
  });

  it('« Nouveau » marks a received message or a sent one that arrived while away', async () => {
    const { d, user } = await openOtto([prompt('p1', 0, 1, 'Préviens Nova')]);
    await thread().findByText('Préviens Nova');
    await user.keyboard('{Escape}');
    d.threadItem('otto', sent('s1', 5, 1, { summary: 'Envoyé pendant ton absence' }));
    await user.click(within(screen.getByRole('tree')).getByRole('button', { name: /^Otto/ }));
    await screen.findByRole('tabpanel', { name: 'Fil de la session' });
    const marker = await thread().findByRole('separator', { name: 'Nouveau depuis votre dernière visite' });
    expect(marker.nextElementSibling).toHaveAttribute('data-message', 's1');
    await user.keyboard('{Escape}');
    d.threadItem('otto', received('r1', 10, 2, { text: 'Reçu pendant ton absence' }));
    await user.click(within(screen.getByRole('tree')).getByRole('button', { name: /^Otto/ }));
    await screen.findByRole('tabpanel', { name: 'Fil de la session' });
    const next = await thread().findByRole('separator', { name: 'Nouveau depuis votre dernière visite' });
    // It opens its exchange as a prompt would: above the exchange's time.
    expect(next.nextElementSibling).toHaveClass('turn-time');
    expect(next.parentElement!.querySelector('[data-message]')).toHaveAttribute('data-message', 'r1');
  });
});
