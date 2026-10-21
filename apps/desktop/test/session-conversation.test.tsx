import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import WebSocket from 'ws';
import type { ThreadItem } from '@ledge/protocol';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { activeCount } from '../src/nav/agents';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { loadWorkspace } from '../src/session/lazy';
import { listSessions, PROJECTS, type MockDaemon } from './helpers';

const daemons: MockDaemon[] = [];
afterEach(async () => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
  cleanup(); localStorage.clear();
  for (const d of daemons.splice(0)) await d.close();
});

// One base for the whole file: Otto's and Nova's items made at different moments still share their times.
const base = Date.now() - 600_000;
const at = (s: number) => new Date(base + s * 1000).toISOString();
const prompt = (id: string, s: number, turn: number, text: string): ThreadItem => ({ kind: 'prompt', id, at: at(s), turn, text });
const sent = (id: string, s: number, turn: number, extra: Partial<Extract<ThreadItem, { kind: 'sent' }>> = {}): ThreadItem =>
  ({ kind: 'sent', id, at: at(s), turn, to: 'nova', peer: 'nova', summary: `Résumé ${id}`, text: `Texte ${id}`, status: 'delivered', ...extra });
const received = (id: string, s: number, turn: number, extra: Partial<Extract<ThreadItem, { kind: 'received' }>> = {}): ThreadItem =>
  ({ kind: 'received', id, at: at(s), turn, from: 'nova', peer: 'nova', text: `Texte ${id}`, ...extra });
const docReply = (s: number): ThreadItem => ({ kind: 'reply', id: 'reply-doc', at: at(s), turn: 1, text: 'Le guide est dans [docs/guide.md](docs/guide.md).' });

/** Otto's side: Otto writes to Nova (read, Nova's copy recv-1-0), then receives Nova's answer (her toolu_n1). */
const s1 = (extra: Partial<Extract<ThreadItem, { kind: 'sent' }>> = {}) =>
  sent('s1', 10, 1, { received: 'recv-1-0', status: 'read', summary: 'Le schéma est prêt', text: 'Tout est dans docs/schema.md.', ...extra });
const otto = (): ThreadItem[] => [prompt('p1', 0, 1, 'Préviens Nova'), s1(), received('recv-2-0', 30, 1, { sent: 'toolu_n1', text: 'Merci, je regarde.' })];
/** Nova's side: Otto's message as received, her answer (read by Otto), then a question Otto has not received yet. */
const nova = (): ThreadItem[] => [
  received('recv-1-0', 12, 1, { from: 'otto', peer: 'otto', sent: 's1', text: 'Tout est dans docs/schema.md.' }),
  sent('toolu_n1', 20, 1, { to: 'otto', peer: 'otto', received: 'recv-2-0', status: 'read', summary: 'Reçu', text: 'Merci, je regarde.' }),
  sent('toolu_n2', 40, 1, { to: 'otto', peer: 'otto', status: 'delivered', summary: 'Une question', text: 'Tu as la migration ?' })
];

const thread = () => within(screen.getByRole('tabpanel', { name: 'Fil de la session' }));
const paneEl = () => screen.getByRole('complementary', { name: 'Volet de lecture' });
const pane = () => within(paneEl());
const head = () => paneEl().querySelector<HTMLElement>('.conv-head')!;
const logOf = (b = 'Nova') => pane().getByRole('log', { name: `Conversation entre Otto et ${b}` });
const bubble = (key: string) => paneEl().querySelector<HTMLElement>(`[data-bubble="${key}"]`)!;
const bubbles = () => [...paneEl().querySelectorAll('[data-bubble]')].map(e => e.getAttribute('data-bubble'));
const card = (id: string) => document.querySelector<HTMLElement>(`.session-thread [data-message="${id}"]`)!;
const lit = (id: string) => document.querySelector(`.session-thread .message-card.lit[data-message="${id}"]`);
const asked = (d: MockDaemon, id?: string) => d.received.filter(m => m.type === 'session.thread' && (id === undefined || m.id === id));
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Otto's page in French, its thread `items`; `threads`: what the daemon answers for the other sessions (unasked until a tab wants them). */
async function openOtto(items: ThreadItem[], threads: Record<string, ThreadItem[]> = {}) {
  await loadWorkspace();
  localStorage.setItem('desktop.lang', 'fr');
  localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  for (const s of listSessions()) d.upsert(s);
  d.thread('otto', items);
  for (const [id, xs] of Object.entries(threads)) d.thread(id, xs);
  d.documents.set('docs/guide.md', '# Guide\n\nBonjour.');
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(listSessions()))));
  await side.findByRole('button', { name: /^Docs/ });
  const user = userEvent.setup();
  await user.click(within(side.getByRole('tree')).getByRole('button', { name: /^Otto/ }));
  await screen.findByRole('tabpanel', { name: 'Fil de la session' });
  return { d, user };
}

/** « suivre la conversation » on the card of `id` in the thread. */
async function follow(user: UserEvent, id: string) {
  await waitFor(() => expect(card(id)).not.toBeNull());
  await user.click(within(card(id)).getByRole('button', { name: 'suivre la conversation' }));
}

/** Otto's page with the tab « Conversation · Nova » open, both threads read. */
async function openConversation(items = otto(), novaItems: ThreadItem[] | null = nova()) {
  const env = await openOtto(items, novaItems ? { nova: novaItems } : {});
  await follow(env.user, 's1');
  await waitFor(() => expect(logOf()).toBeInTheDocument());
  if (novaItems) await waitFor(() => expect(head()).toHaveTextContent(/\d+ messages?/));
  return env;
}

describe('the Conversation tab', () => {
  describe('opening it from the thread', () => {
    it('« suivre la conversation » on every card, sent or received, known peer or not; the header\u2019s « Suivre à côté »', async () => {
      const { user } = await openOtto([...otto(), received('rz', 35, 1, { from: 'zed', peer: undefined, text: 'Bonjour de loin.' })]);
      await thread().findByText('Bonjour de loin.');
      const cards = [...document.querySelectorAll<HTMLElement>('.session-thread .message-card')];
      // The thread's own order (what came in opens the exchange); every card is there.
      expect(cards.map(c => c.getAttribute('data-message')).sort()).toEqual(['recv-2-0', 'rz', 's1']);
      for (const c of cards) {
        const link = within(c).getByRole('button', { name: 'suivre la conversation' });
        expect(link).toHaveAttribute('title', `Suivre la conversation avec ${c.getAttribute('data-message') === 'rz' ? 'zed' : 'Nova'} à côté du fil`);
      }
      const pill = thread().getByRole('button', { name: 'Suivre à côté' });
      expect(pill).toHaveAttribute('aria-pressed', 'false');
      expect(pill).toHaveAttribute('title', 'Suivre la conversation avec Nova à côté du fil');
      // Folded, Nova's messages are one-line rows: no link there, only zed's card keeps one.
      await user.click(thread().getByRole('button', { name: /Replier/ }));
      const lines = [...document.querySelectorAll('.session-thread .message-line')];
      expect(lines).toHaveLength(2);
      for (const l of lines) expect(l).not.toHaveTextContent('suivre la conversation');
      expect(thread().getAllByRole('button', { name: 'suivre la conversation' })).toHaveLength(1);
    });

    it('on a subagent\u2019s page, no way to the conversation', async () => {
      const { user } = await openOtto([
        ...otto(),
        { kind: 'helper', id: 'h1', at: at(31), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'working' },
        sent('sh', 32, 1, { helperId: 'h1', summary: 'Du sous-agent', text: 'Depuis le sous-agent.' })
      ]);
      // Otto's own page has it…
      await waitFor(() => expect(card('s1')).not.toBeNull());
      expect(within(card('s1')).getByRole('button', { name: 'suivre la conversation' })).toBeVisible();
      // …its subagent's page, whose message to Nova is shown, does not.
      await user.keyboard('{Escape}');
      await user.click(await screen.findByRole('button', { name: /sous-agent de Otto/ }));
      await waitFor(() => expect(document.querySelector('.session-page[data-helper=h1]')).not.toBeNull());
      await waitFor(() => expect(card('sh')).not.toBeNull());
      expect(screen.queryByRole('button', { name: 'suivre la conversation' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Suivre à côté' })).toBeNull();
    });

    it('the link opens « Conversation · Nova » beside Otto\u2019s thread, and asks Nova\u2019s thread once', async () => {
      const { d, user } = await openOtto(otto(), { nova: nova() });
      await waitFor(() => expect(card('s1')).not.toBeNull());
      await pause(100);
      expect(asked(d, 'nova')).toEqual([]);
      await follow(user, 's1');
      const p = within(await screen.findByRole('complementary', { name: 'Volet de lecture' }));
      await waitFor(() => expect(head()).toHaveTextContent('3 messages'));
      expect(head()).toHaveTextContent('Otto');
      expect(head()).toHaveTextContent('Nova');
      expect(head().querySelector('.conv-pair path[d="M4 8h14"]')).not.toBeNull();
      // Both bots: the pair is known.
      expect(head().querySelectorAll('.conv-pair [data-tool]')).toHaveLength(2);
      expect(p.getByRole('log', { name: 'Conversation entre Otto et Nova' })).toBeInTheDocument();
      // Otto's page stays.
      expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto');
      expect(screen.getByRole('tabpanel', { name: 'Fil de la session' })).toBeInTheDocument();
      await pause(150);
      expect(asked(d, 'nova')).toEqual([{ type: 'session.thread', id: 'nova' }]);
    });

    it('each message once, both ways, in the order sent, with its side and delivery', async () => {
      const long = `Tu as la migration ? ${'Détails sur la base. '.repeat(14)}`;
      expect(long.length).toBeGreaterThan(290);
      const { user } = await openConversation(otto(), [...nova().slice(0, 2), sent('toolu_n2', 40, 1, { to: 'otto', peer: 'otto', status: 'delivered', summary: 'Une question', text: long })]);
      const log = within(logOf());
      await waitFor(() => expect(log.getAllByRole('article')).toHaveLength(3));
      expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2']);
      // Otto on the right (its page), Nova on the left.
      expect(bubble('a:s1').closest('.conv-row')).toHaveClass('mine');
      expect(bubble('a:recv-2-0').closest('.conv-row')).toHaveClass('theirs');
      expect(bubble('b:toolu_n2').closest('.conv-row')).toHaveClass('theirs');
      // Delivery, from the sender's item.
      const meta = (key: string) => bubble(key).querySelector<HTMLElement>('.conv-meta')!;
      expect(meta('a:s1')).toHaveTextContent('✓✓');
      expect(meta('a:s1')).toHaveTextContent('lu');
      expect(bubble('a:s1').querySelector('.message-read')).toHaveAttribute('title', 'Lu par Nova');
      expect(meta('b:toolu_n2')).toHaveTextContent('Remis, pas encore lu');
      expect(bubble('b:toolu_n2').querySelector('.message-read')).toHaveAttribute('title', 'Remis à Otto, pas encore lu');
      // Nova's answer: her summary and her time, signed as the first of her run; the next one of hers is not signed again.
      expect(bubble('a:recv-2-0')).toHaveTextContent('Reçu');
      expect(bubble('a:recv-2-0').querySelector('time')).toHaveAttribute('datetime', at(20));
      expect(bubble('a:recv-2-0').querySelector('.conv-who')).toHaveTextContent('Nova');
      expect(bubble('a:s1').querySelector('.conv-who')).toHaveTextContent('Otto');
      expect(bubble('b:toolu_n2').querySelector('.conv-who')).toBeNull();
      // Who wrote to whom, for screen readers.
      expect(bubble('a:s1')).toHaveTextContent('Message d’Otto à Nova');
      expect(bubble('a:recv-2-0')).toHaveTextContent('Message de Nova à Otto');
      // A long body is clamped as on the card.
      const body = bubble('b:toolu_n2').querySelector('.message-body')!;
      expect(body).toHaveClass('clamped');
      await user.click(within(bubble('b:toolu_n2')).getByRole('button', { name: 'Lire tout le message' }));
      expect(body).not.toHaveClass('clamped');
    });

    it('the header\u2019s pill reads « Ouvert à côté » while its tab is the active one; following again does not open a second tab', async () => {
      const { user } = await openOtto([...otto(), docReply(35)], { nova: nova() });
      await user.click(await thread().findByRole('button', { name: 'Suivre à côté' }));
      await waitFor(() => expect(logOf()).toBeInTheDocument());
      expect(thread().getByRole('button', { name: 'Ouvert à côté' })).toHaveAttribute('aria-pressed', 'true');
      await user.click(thread().getByRole('link', { name: 'docs/guide.md' }));
      await pane().findByText('Bonjour.');
      expect(thread().getByRole('button', { name: 'Suivre à côté' })).toHaveAttribute('aria-pressed', 'false');
      await follow(user, 'recv-2-0');
      await waitFor(() => expect(pane().getByRole('tab', { name: 'Conversation · Nova' })).toHaveAttribute('aria-selected', 'true'));
      expect(pane().getAllByRole('tab')).toHaveLength(2);
      expect(thread().getByRole('button', { name: 'Ouvert à côté' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('one Conversation tab per peer: Nova\u2019s and Kit\u2019s side by side, each its own pair', async () => {
      const { user } = await openOtto(
        [...otto(), sent('sk', 32, 1, { to: 'kit', peer: 'kit', received: 'recv-k-0', summary: 'Pour Kit', text: 'Kit, regarde ça.' })],
        {
          nova: [...nova(), sent('toolu_nk', 41, 1, { to: 'kit', peer: 'kit', summary: 'Pour Kit, de Nova', text: 'Kit, de la part de Nova.' })],
          kit: [received('recv-k-0', 33, 1, { from: 'otto', peer: 'otto', sent: 'sk', text: 'Kit, regarde ça.' })]
        }
      );
      await follow(user, 's1');
      await waitFor(() => expect(head()).toHaveTextContent('3 messages'));
      await follow(user, 'sk');
      await waitFor(() => expect(pane().getByRole('tab', { name: 'Conversation · Kit' })).toHaveAttribute('aria-selected', 'true'));
      expect(pane().getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation · Nova', 'Conversation · Kit']);
      await waitFor(() => expect(head()).toHaveTextContent('1 message'));
      expect(logOf('Kit')).not.toHaveTextContent('Kit, de la part de Nova.');
      expect(bubbles()).toEqual(['a:sk']);
      await user.click(pane().getByRole('tab', { name: /^Conversation · Nova/ }));
      await waitFor(() => expect(logOf('Nova')).toBeInTheDocument());
      expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2']);
      expect(logOf('Nova')).not.toHaveTextContent('Kit, regarde ça.');
      expect(logOf('Nova')).not.toHaveTextContent('Kit, de la part de Nova.');
    });

    it('one side only: the strip, the raw name, ⇄, no bot, no « voir son fil », no request', async () => {
      const { d, user } = await openOtto([
        prompt('p1', 0, 1, 'Réponds-lui'),
        received('rh', 5, 1, { from: 'harness-assistant-bf', peer: undefined, text: 'Salut de loin.' }),
        sent('sh', 10, 1, { to: 'harness-assistant-bf', peer: undefined, summary: 'Réponse', text: 'Bien reçu.', status: 'delivered' }),
        docReply(15)
      ]);
      // A document first, so the tab bar names the conversation's tab.
      await user.click(await thread().findByRole('link', { name: 'docs/guide.md' }));
      await pane().findByText('Bonjour.');
      await follow(user, 'rh');
      await waitFor(() => expect(pane().getByRole('tab', { name: 'Conversation · harness-assistant-bf' })).toHaveAttribute('aria-selected', 'true'));
      const note = pane().getByRole('note');
      expect(note).toHaveTextContent('Vue d’un seul côté · harness-assistant-bf n’est pas une session que Ledge suit sur cette machine. La conversation est lue dans le fil d’Otto seulement :');
      expect(note).toHaveTextContent('et Ledge ne sait pas si ceux d’Otto ont été lus.');
      expect(head()).toHaveTextContent('harness-assistant-bf');
      expect(head().querySelector('.conv-pair path[d="M4 8h14"]')).not.toBeNull();
      // Otto's bot only.
      expect(head().querySelectorAll('.conv-pair [data-tool]')).toHaveLength(1);
      expect(within(head()).queryByRole('button', { name: 'voir son fil' })).toBeNull();
      expect(bubbles()).toEqual(['a:rh', 'a:sh']);
      expect(bubble('a:sh').querySelector('.message-read')).toHaveTextContent('Remis, pas encore lu');
      await pause(150);
      expect(asked(d)).toEqual([{ type: 'session.thread', id: 'otto' }]);
    });

    it('Nova\u2019s thread not read yet: Otto\u2019s side at once, « Lecture du fil de Nova… » until it comes', async () => {
      const { d } = await openConversation(otto(), null);
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0']));
      const line = pane().getByText('Lecture du fil de Nova…');
      expect(line).toBeVisible();
      expect(line.compareDocumentPosition(logOf()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      d.push({ type: 'session.thread', id: 'nova', items: nova() });
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2']));
      expect(pane().queryByText('Lecture du fil de Nova…')).toBeNull();
    });

    it('both ran /clear: the tab stays, says there is nothing yet, its log still mounted', async () => {
      const { d } = await openConversation();
      await waitFor(() => expect(head()).toHaveTextContent('3 messages'));
      d.push({ type: 'session.thread', id: 'otto', items: [prompt('p9', 60, 1, 'On repart de zéro')] });
      d.push({ type: 'session.thread', id: 'nova', items: [prompt('n9', 61, 1, 'On repart de zéro')] });
      await pane().findByText('Aucun message entre Otto et Nova pour l’instant.');
      expect(pane().getByText('Ils s’afficheront ici, en direct, dès que l’un écrira à l’autre.')).toBeVisible();
      expect(head()).not.toHaveTextContent(/messages?/);
      expect(logOf()).toBeInTheDocument();
      expect(logOf().children).toHaveLength(0);
    });
  });

  describe('from the tab to the threads', () => {
    it('« dans le fil » lights Otto\u2019s message in place; the page and the pane stay', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { d, user } = await openConversation();
      // Otto has moved on: the exchange that holds s1 is a past one now.
      d.threadItem('otto', prompt('p2', 50, 2, 'Continue'));
      await thread().findByText('Continue');
      const link = within(bubble('a:s1')).getByRole('button', { name: 'dans le fil' });
      expect(link).toHaveAttribute('title', 'Montrer dans le fil d’Otto');
      await user.click(link);
      await waitFor(() => expect(lit('s1')).not.toBeNull());
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto');
      expect(logOf()).toBeInTheDocument();
      await waitFor(() => expect(document.querySelector('.session-thread .message-card.lit')).toBeNull(), { timeout: 4000 });
    });

    it('a click on the bubble does the same; on its links or over a selection it does not', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const long = `Merci, je regarde. ${'Je lis le schéma en entier. '.repeat(10)}`;
      const { user } = await openConversation(
        [prompt('p1', 0, 1, 'Préviens Nova'), s1(), received('recv-2-0', 30, 1, { sent: 'toolu_n1', text: long })],
        nova().map(i => (i.id === 'toolu_n1' ? { ...i, text: long } : i))
      );
      const target = bubble('a:recv-2-0');
      // Its own link: « Lire tout le message » unfolds, lights nothing.
      await user.click(within(target).getByRole('button', { name: 'Lire tout le message' }));
      await pause(150);
      expect(document.querySelector('.session-thread .lit')).toBeNull();
      // Over a selection: the reader is copying, nothing lights.
      const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'abc' } as unknown as Selection);
      fireEvent.click(target.querySelector('.message-body')!);
      await pause(150);
      expect(document.querySelector('.session-thread .lit')).toBeNull();
      selection.mockRestore();
      // A plain click: lit in Otto's thread.
      fireEvent.click(target.querySelector('.message-body')!);
      await waitFor(() => expect(lit('recv-2-0')).not.toBeNull());
    });

    it('a message only Nova\u2019s thread holds: « voir son fil » opens Nova on it, lit', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { user } = await openConversation();
      const only = bubble('b:toolu_n2');
      expect(within(only).queryByRole('button', { name: 'dans le fil' })).toBeNull();
      const link = within(only).getByRole('button', { name: 'voir son fil' });
      expect(link).toHaveAttribute('title', 'Voir dans le fil de Nova');
      await user.click(link);
      await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:nova'));
      await waitFor(() => expect(lit('toolu_n2')).not.toBeNull());
    });

    it('the head\u2019s « voir son fil » opens Nova\u2019s page', async () => {
      const { user } = await openConversation();
      const link = within(head()).getByRole('button', { name: 'voir son fil' });
      expect(link).toHaveAttribute('title', 'Voir dans le fil de Nova');
      await user.click(link);
      await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:nova'));
    });

    it('narrow (the pane lies over the thread): « dans le fil » closes the Conversation tab, then lights the message', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      // jsdom lays nothing out: the narrow layout's pane is said to be `position: absolute`, as session.css makes it under 860 px.
      const real = window.getComputedStyle.bind(window);
      const covering = (el: Element, pseudo?: string | null) => {
        const style = real(el, pseudo);
        if (!el.classList.contains('side-pane')) return style;
        return new Proxy(style, {
          get: (t, k) => (k === 'position' ? 'absolute'
            : k === 'getPropertyValue' ? (name: string) => (name === 'position' ? 'absolute' : t.getPropertyValue(name))
            : ((v: unknown) => (typeof v === 'function' ? v.bind(t) : v))(Reflect.get(t, k, t)))
        });
      };
      vi.spyOn(window, 'getComputedStyle').mockImplementation(covering);
      if (globalThis.getComputedStyle !== window.getComputedStyle) vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(covering);
      const { user } = await openOtto([...otto(), docReply(35)], { nova: nova() });
      await user.click(await thread().findByRole('link', { name: 'docs/guide.md' }));
      await pane().findByText('Bonjour.');
      await follow(user, 's1');
      await waitFor(() => expect(head()).toHaveTextContent('3 messages'));
      await user.click(within(bubble('a:s1')).getByRole('button', { name: 'dans le fil' }));
      await waitFor(() => expect(screen.queryByRole('log', { name: 'Conversation entre Otto et Nova' })).toBeNull());
      expect(screen.queryByRole('tab', { name: /^Conversation · Nova/ })).toBeNull();
      await waitFor(() => expect(lit('s1')).not.toBeNull());
    });
  });

  describe('live', () => {
    it('statuses change in place; a message only Nova\u2019s thread held keeps its place once Otto receives it; a new one comes at the end', async () => {
      const { d } = await openConversation(
        [...otto().map(i => (i.id === 's1' ? s1({ status: 'delivered' }) : i)), sent('s3', 42, 1, { summary: 'Et la doc ?', text: 'Tu relis la doc ?' })]
      );
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2', 'a:s3']));
      expect(head()).toHaveTextContent('4 messages');
      const first = bubble('a:s1');
      expect(first.querySelector('.conv-meta')).toHaveTextContent('Remis, pas encore lu');
      // Nova reads it: the same bubble, read.
      d.threadItem('otto', s1({ status: 'read' }));
      await waitFor(() => expect(bubble('a:s1').querySelector('.message-read')).toHaveAttribute('title', 'Lu par Nova'));
      expect(bubble('a:s1')).toBe(first);
      expect(bubble('a:s1').querySelector('.conv-meta')).toHaveTextContent('✓✓');
      expect(bubble('a:s1').querySelector('.conv-meta')).toHaveTextContent('lu');
      // Otto receives Nova's question (later than its own s3): it stays where Nova wrote it, now in Otto's thread.
      d.threadItem('otto', received('recv-4-0', 45, 1, { sent: 'toolu_n2', text: 'Tu as la migration ?' }));
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'a:recv-4-0', 'a:s3']));
      expect(within(bubble('a:recv-4-0')).getByRole('button', { name: 'dans le fil' })).toBeVisible();
      expect(head()).toHaveTextContent('4 messages');
      // A new message from Nova: at the end.
      d.threadItem('nova', sent('toolu_n3', 50, 1, { to: 'otto', peer: 'otto', summary: 'Autre chose', text: 'Et les tests ?' }));
      await waitFor(() => expect(bubbles().at(-1)).toBe('b:toolu_n3'));
      expect(head()).toHaveTextContent('5 messages');
    });

    it('the tab not active: a dot and « 2 nouveaux messages » for messages, not for a status', async () => {
      const { d, user } = await openConversation([...otto().map(i => (i.id === 's1' ? s1({ status: 'delivered' }) : i)), docReply(35)]);
      await waitFor(() => expect(head()).toHaveTextContent('3 messages'));
      await user.click(thread().getByRole('link', { name: 'docs/guide.md' }));
      await pane().findByText('Bonjour.');
      // A status, and a message only Nova held reaching Otto: neither is new.
      d.threadItem('otto', s1({ status: 'read' }));
      await waitFor(() => expect(card('s1').querySelector('.message-read')).toHaveAttribute('title', 'Lu par Nova'));
      d.threadItem('otto', received('recv-4-0', 45, 1, { sent: 'toolu_n2', text: 'Tu as la migration ?' }));
      await waitFor(() => expect(card('recv-4-0')).not.toBeNull());
      await pause(100);
      expect(pane().getByRole('tab', { name: 'Conversation · Nova' })).toBeInTheDocument();
      expect(paneEl().querySelector('.conv-tab-dot')).toBeNull();
      // Two messages from Nova.
      d.threadItem('nova', sent('toolu_n3', 50, 1, { to: 'otto', peer: 'otto', text: 'Et les tests ?' }));
      d.threadItem('nova', sent('toolu_n4', 51, 1, { to: 'otto', peer: 'otto', text: 'Et la CI ?' }));
      const tab = await pane().findByRole('tab', { name: 'Conversation · Nova, 2 nouveaux messages' });
      expect(tab.querySelector('.conv-tab-dot')).not.toBeNull();
      await user.click(tab);
      await waitFor(() => expect(pane().getByRole('tab', { name: 'Conversation · Nova' })).toHaveAttribute('aria-selected', 'true'));
      expect(paneEl().querySelector('.conv-tab-dot')).toBeNull();
    });

    it('scrolled up, a new message brings « 1 nouveau message », the view stays; the pill takes the reader to the end', async () => {
      const { d, user } = await openConversation();
      const el = paneEl().querySelector<HTMLElement>('.conv-body')!;
      const g = { top: 200, height: 2000 };
      const calls: ScrollToOptions[] = [];
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.top, set: (v: number) => { g.top = v; } });
      el.scrollTo = ((o: ScrollToOptions) => { calls.push(o); g.top = o.top ?? g.top; fireEvent.scroll(el); }) as typeof el.scrollTo;
      fireEvent.scroll(el);
      const novaSays = (id: string, s: number) => d.threadItem('nova', sent(id, s, 1, { to: 'otto', peer: 'otto', text: `Encore ${id}` }));
      novaSays('toolu_n3', 50);
      expect(await pane().findByRole('button', { name: '1 nouveau message' })).toBeVisible();
      novaSays('toolu_n4', 51);
      await pane().findByRole('button', { name: '2 nouveaux messages' });
      expect(g.top).toBe(200);
      await user.click(pane().getByRole('button', { name: '2 nouveaux messages' }));
      expect(calls).toEqual([{ top: 2000, behavior: 'smooth' }]);
      await waitFor(() => expect(pane().queryByRole('button', { name: /nouveaux? messages?$/ })).toBeNull());
      // At the end, a new message keeps the end in view, without a pill.
      g.top = 1500; fireEvent.scroll(el);
      g.height = 2400;
      novaSays('toolu_n5', 52);
      await waitFor(() => expect(bubbles().at(-1)).toBe('b:toolu_n5'));
      await waitFor(() => expect(g.top).toBe(2400));
      expect(pane().queryByRole('button', { name: /nouveaux? messages?$/ })).toBeNull();
    });

    it('a reconnect asks Nova\u2019s thread again; the conversation stays as it was meanwhile', async () => {
      const { d, user } = await openConversation([...otto(), docReply(35)]);
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2']));
      // Active: neither the loading line nor a gap while Nova's thread is asked again.
      const seen = { loading: false, gone: false };
      const watch = new MutationObserver(() => {
        if (document.body.textContent?.includes('Lecture du fil de Nova…')) seen.loading = true;
        if (!document.querySelector('[data-bubble="b:toolu_n2"]')) seen.gone = true;
      });
      watch.observe(document.body, { childList: true, subtree: true, characterData: true });
      await d.dropClients();
      await waitFor(() => expect(asked(d, 'nova')).toHaveLength(2), { timeout: 5000 });
      await pause(150);
      watch.disconnect();
      expect(seen).toEqual({ loading: false, gone: false });
      expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2']);
      // Not active: a reconnect is no news.
      await user.click(thread().getByRole('link', { name: 'docs/guide.md' }));
      await pane().findByText('Bonjour.');
      await d.dropClients();
      await waitFor(() => expect(asked(d, 'nova')).toHaveLength(3), { timeout: 5000 });
      await pause(150);
      expect(pane().getByRole('tab', { name: 'Conversation · Nova' })).toBeInTheDocument();
      expect(paneEl().querySelector('.conv-tab-dot')).toBeNull();
      // Still followed live.
      await user.click(pane().getByRole('tab', { name: 'Conversation · Nova' }));
      d.threadItem('nova', sent('toolu_n3', 50, 1, { to: 'otto', peer: 'otto', text: 'Et les tests ?' }));
      await waitFor(() => expect(bubbles()).toEqual(['a:s1', 'a:recv-2-0', 'b:toolu_n2', 'b:toolu_n3']));
    });
  });
});
