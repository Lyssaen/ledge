import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttachmentRef, ThreadItem } from '@ledge/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const prompt = (id: string, text: string, at: string): ThreadItem => ({ kind: 'prompt', id, at, turn: 1, text });
const reply = (id: string, text: string, at: string): ThreadItem => ({ kind: 'reply', id, at, turn: 1, text });

function opened(extra: Parameters<typeof session>[1] = {}) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', unread: true, ...extra })]));
  const view = render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  return { ...t, view };
}

describe('the thread', () => {
  it('asks the thread on open, then marks it read up to its last item', () => {
    const t = opened();
    expect(t.of('session.thread')).toEqual([{ type: 'session.thread', id: 'a' }]);
    expect(t.of('session.read')).toEqual([]);
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('p1', 'Corrige le lien', '2026-10-14T10:00:00.000Z'), reply('r1', 'Tout passe.', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    expect(t.of('session.read')).toEqual([{ type: 'session.read', id: 'a', at: '2026-10-14T10:02:00.000Z' }]);
    const types = t.sent.map(m => m.type);
    expect(types.indexOf('session.thread')).toBeLessThan(types.indexOf('session.read'));
    expect(screen.getByText('Corrige le lien')).toBeInTheDocument();
    expect(screen.getByText('Tout passe.')).toBeInTheDocument();
  });

  it('watches the session while open, and stops on leaving', () => {
    const t = opened();
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }]);
    t.view.unmount();
    expect(t.of('session.watch').at(-1)).toEqual({ type: 'session.watch', id: null });
  });

  it('reads an agent reply as the PC does: title, lead, sections', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', '**Correctif prêt**\n\nLe test passait par hasard.\n\n- `pnpm test` vert', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    const article = screen.getByRole('article', { name: 'Réponse de l’agent' });
    expect(article.querySelector('strong')?.textContent).toBe('Correctif prêt');
    expect(article.querySelector('code')?.textContent).toBe('pnpm test');
    expect(article.textContent).not.toContain('**');
  });

  it('says when a message was shortened, and when older ones stay on the PC', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', 'Long…', '2026-10-14T10:02:00.000Z')], cut: ['r1'], more: true }));
    expect(screen.getByText('Message raccourci')).toBeInTheDocument();
    expect(screen.getByText('Messages plus anciens sur le PC')).toBeInTheDocument();
  });

  it('says nothing of the kind for a whole thread', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [reply('r1', 'Court.', '2026-10-14T10:02:00.000Z')], cut: [], more: false }));
    expect(screen.queryByText('Message raccourci')).not.toBeInTheDocument();
    expect(screen.queryByText('Messages plus anciens sur le PC')).not.toBeInTheDocument();
  });

  it('sends an instruction to an idle agent and shows it on its way', () => {
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    fireEvent.change(screen.getByLabelText('Message pour Kai'), { target: { value: 'Montre le diff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à Kai' }));
    expect(t.of('session.reply')).toMatchObject([{ type: 'session.reply', id: 'a', text: 'Montre le diff', expect: null }]);
    expect(screen.getByText('Envoi au PC…', { selector: 'div[role=status]' })).toBeInTheDocument();
  });

  it('puts the request waiting at its foot, as « À toi »\'s card, and keeps the composer shut (§3, Q19)', () => {
    const t = opened({ state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect(screen.getByRole('link', { name: /Autoriser une commande/ })).toHaveAttribute('href', '#/request/a/k1');
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }));
    expect(t.of('session.decide')).toEqual([expect.objectContaining({ id: 'a', decision: 'accept', expect: expect.objectContaining({ key: 'k1' }) })]);
    expect(screen.getByLabelText('Message pour Kai')).toBeDisabled();
    expect(screen.getByLabelText('Message pour Kai')).toHaveAttribute('placeholder', 'Traite la demande ci-dessus');
  });

  it('says the session is gone when the PC no longer knows it', () => {
    const t = opened();
    act(() => t.deliver({ type: 'error', code: 'unknown_session', request: 'session.thread' }));
    expect(screen.getByText('Cette session n’existe plus sur le PC.')).toBeInTheDocument();
  });
});

describe('a <task-notification> in the thread', () => {
  const note = (status: string, summary: string, extra = '') =>
    `<task-notification>\n<task-id>b7x</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>${extra}\n</task-notification>`;
  const deliver = (t: ReturnType<typeof opened>, text: string) =>
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('p1', text, '2026-10-14T10:00:00.000Z')], cut: [], more: false }));

  it('shows a stopped agent as a task card, its notification one tap away', () => {
    const t = opened();
    deliver(t, note('killed', 'Agent "Explore" was stopped'));
    const card = screen.getByRole('region', { name: 'Tâche · Arrêtée' });
    expect(card).toHaveTextContent('L’agent Explore a été arrêté. Il peut reprendre si tu lui écris.');
    expect(card.querySelector('strong')).toHaveTextContent('Explore');
    expect(card).not.toHaveTextContent('<task-notification>');
    const raw = screen.getByRole('button', { name: 'Notification brute' });
    expect(raw).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(raw);
    expect(raw).toHaveAttribute('aria-expanded', 'true');
    expect(card.querySelector('pre')?.textContent).toMatch(/^<task-notification>/);
  });

  it('shows a failed command with its exit code and output file', () => {
    const t = opened();
    deliver(t, note('failed', 'Background command "pnpm test" failed (exit code 1)', '\n<output-file>/tmp/b7x.out</output-file>'));
    const card = screen.getByRole('region', { name: 'Tâche · En échec' });
    expect(card.querySelector('code')).toHaveTextContent('pnpm test');
    expect(card).toHaveTextContent('La commande pnpm test a échoué en arrière-plan.');
    expect(card).toHaveTextContent('code 1 · /tmp/b7x.out');
  });

  it('an unknown sentence is shown as it came', () => {
    const t = opened();
    deliver(t, note('paused', 'Quelque chose'));
    expect(screen.getByRole('region', { name: 'Tâche · Notifiée' })).toHaveTextContent('Quelque chose');
  });
});

describe('the checklist on the thread', () => {
  const checklist = { tasks: [{ text: 'Écrire', status: 'in_progress' as const }], done: 0, total: 1 };
  const flagged = (flag: boolean) => {
    const t = setup();
    const m = snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile' })]);
    if (m.type === 'snapshot' && flag) m.daemon = { ...m.daemon, checklist: true };
    t.deliver(m);
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    return t;
  };

  it('shows the head once the PC sends a list', () => {
    const t = flagged(true);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist }));
    expect(screen.getByRole('button', { name: /Plan de travail/ })).toBeInTheDocument();
  });

  it('shows none for a null checklist', () => {
    const t = flagged(true);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist: null }));
    expect(screen.queryByRole('button', { name: /Plan de travail/ })).not.toBeInTheDocument();
  });

  it('shows none when the PC does not announce the feature', () => {
    const t = flagged(false);
    act(() => t.deliver({ type: 'session.checklist', id: 'a', checklist }));
    expect(screen.queryByRole('button', { name: /Plan de travail/ })).not.toBeInTheDocument();
  });

  it('shows the capture line and thumbnail, opening full screen on tap', async () => {
    const REF: AttachmentRef = { id: 'c'.repeat(64), mime: 'image/png', width: 1280, height: 800, bytes: 30_000, preview: true };
    const t = opened();
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [{ kind: 'tool', id: 't2', at: '2026-10-14T10:00:00.000Z', turn: 1, tool: 'mcp__plugin_playwright_playwright__browser_take_screenshot', label: 'shot', status: 'success', files: [], images: [REF] }], cut: [], more: false }));
    expect(screen.getByText('Capture')).toBeVisible();
    expect(screen.getByText('1280×800')).toBeVisible();
    await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
    act(() => t.deliver({ type: 'attachment.data', requestId: t.of('attachment.get')[0]!.requestId, attachment: REF.id, mime: 'image/png', data: 'AAAA' }));
    fireEvent.click(await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-thumb=ready]'); expect(el).not.toBeNull(); return el!; }));
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});

describe('the thread on a wide screen (m2-sessions.html §10, Q27)', () => {
  const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
  afterEach(() => { wide(false); });
  const now = Date.now();
  const at = (min: number) => new Date(now + min * 60_000).toISOString();

  it('says where the session works, decides with Y, says Enter sends, and its foot gains tokens, project and the limit', () => {
    wide(true);
    const t = opened({ project: 'ledge', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }), context: { at: at(-1), used: 620_000, window: 1_000_000 } });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    act(() => t.deliver({ type: 'usage.state', harnesses: [{ harness: 'claude', status: 'ok', readAt: at(-1), windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(60) }] }], prefs: { alert: 0.8 } }));
    expect(screen.getByText('ledge · feat/x')).toBeInTheDocument();
    expect(screen.getByText('Y / N au clavier')).toBeInTheDocument();
    expect(screen.getByLabelText('Message pour Kai')).toHaveAttribute('placeholder', 'Traite la demande ci-dessus · Entrée envoie, Maj+Entrée passe à la ligne');
    const foot = screen.getByRole('contentinfo', { name: 'État de Kai' });
    expect(foot).toHaveTextContent('· 620k / 1M');
    expect(foot).toHaveTextContent('feat/xledge');
    expect(foot).toHaveTextContent('Claude 5 h 84 %');
    expect(screen.getByText('84 %', { selector: 'b' })).toHaveClass('text-attention');
    fireEvent.keyDown(document.body, { key: 'y' });
    expect(t.of('session.decide')).toEqual([expect.objectContaining({ id: 'a', decision: 'accept', expect: expect.objectContaining({ key: 'k1' }) })]);
  });

  it('puts Autoriser, Refuser and « Toujours dans ce projet » on one line, where a phone puts « Toujours » under them (review-qa a79d8655)', () => {
    const row = () => screen.getByRole('button', { name: 'Autoriser' }).parentElement!;
    wide(true);
    const t = opened({ project: 'ledge', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect([...row().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Autoriser', 'Refuser', 'Toujours dans ce projet']);
    cleanup();
    wide(false);
    const u = opened({ project: 'ledge', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) });
    act(() => u.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect([...row().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Autoriser', 'Refuser']);
    expect(screen.getByRole('button', { name: 'Toujours dans ce projet' })).toBeInTheDocument();
  });

  it('on a phone keeps the head, the card and the foot as §3 draws them', () => {
    const t = opened({ project: 'ledge', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }), context: { at: at(-1), used: 620_000, window: 1_000_000 } });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
    expect(screen.queryByText('ledge · feat/x')).not.toBeInTheDocument();
    expect(screen.queryByText('Y / N au clavier')).not.toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'État de Kai' })).not.toHaveTextContent('620k');
    fireEvent.keyDown(document.body, { key: 'y' });
    expect(t.of('session.decide')).toEqual([]);
  });
});

describe('the thread\'s place (m2-sessions.html, Comportements)', () => {
  /** A main that has 1000 px of thread for 400 px of room, scrolled where the test says; `grow` makes the thread taller. */
  function sized(main: HTMLElement) {
    let top = 600;
    let height = 1000;
    Object.defineProperty(main, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(main, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, height - 400); } });
    return { at: () => top, scrollTo: (v: number) => { top = v; fireEvent.scroll(main); }, grow: (h: number) => { height = h; } };
  }

  it('a reply growing in place keeps the foot in view, and moves nothing for one who scrolled up (review-qa 82ddb551)', () => {
    const t = opened({ state: 'working' });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('1', 'Fais-le', '2026-11-11T10:00:00Z'), reply('2', 'Je m\'y', '2026-11-11T10:00:05Z')], cut: [], more: false }));
    const box = sized(screen.getByRole('main', { name: /Kai/ }));
    box.scrollTo(600);
    // The same reply, longer: neither the last key nor the count change.
    box.grow(1400);
    act(() => t.deliver({ type: 'session.thread.item', id: 'a', item: reply('2', 'Je m\'y mets, et voici le plan en dix points.', '2026-11-11T10:00:05Z') }));
    expect(box.at()).toBe(1000);
    box.scrollTo(300);
    box.grow(1800);
    act(() => t.deliver({ type: 'session.thread.item', id: 'a', item: reply('2', 'Je m\'y mets, et voici le plan en dix points, puis les tests.', '2026-11-11T10:00:05Z') }));
    expect(box.at()).toBe(300);
  });

  it('scrolled up, a request arriving moves nothing and « Demande en bas » says it; a tap goes down', () => {
    const t = opened({ state: 'working' });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('1', 'Fais-le', '2026-11-11T10:00:00Z'), reply('2', 'Je m\'y mets.', '2026-11-11T10:00:05Z')], cut: [], more: false }));
    const main = screen.getByRole('main', { name: /Kai/ });
    const box = sized(main);
    box.scrollTo(100);
    act(() => t.deliver({ type: 'session.updated', session: session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) }) }));
    expect(box.at()).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Demande en bas' }));
    expect(box.at()).toBe(600);
    expect(screen.queryByRole('button', { name: 'Demande en bas' })).not.toBeInTheDocument();
  });

  it('at its foot, the request comes into view with no pill', () => {
    const t = opened({ state: 'working' });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('1', 'Fais-le', '2026-11-11T10:00:00Z')], cut: [], more: false }));
    const box = sized(screen.getByRole('main', { name: /Kai/ }));
    box.scrollTo(600);
    act(() => t.deliver({ type: 'session.updated', session: session('a', { name: 'Kai', topic: 'Inbox mobile', repo: 'ledge', branch: 'feat/x', state: 'waiting_permission', pending: pending({ key: 'k1', text: 'pnpm build' }) }) }));
    expect(screen.queryByRole('button', { name: 'Demande en bas' })).not.toBeInTheDocument();
    expect(box.at()).toBe(600);
  });

  it('« Terminal » keeps the thread\'s place, which « Fil » finds again', () => {
    const t = opened({ state: 'idle' });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [prompt('1', 'Fais-le', '2026-11-11T10:00:00Z')], cut: [], more: false }));
    sized(screen.getByRole('main', { name: /Kai/ })).scrollTo(250);
    fireEvent.click(screen.getByRole('link', { name: 'Terminal' }));
    t.view.unmount();
    // Every element's scroll, recorded: the thread places itself on its first render.
    const tops = new WeakMap<Element, number>();
    const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) ?? 0; }, set(v: number) { tops.set(this, v); } });
    try {
      const again = render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
      expect(tops.get(again.getByRole('main', { name: /Kai/ }))).toBe(250);
    } finally { Object.defineProperty(Element.prototype, 'scrollTop', own); }
  });
});
