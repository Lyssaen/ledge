import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { HumanAsk, HumanChannel, OpenRigAnswered, Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { AsksColumn } from '../src/asks/AsksColumn';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bySection, endOf, markOf, sectionOf } from '../src/asks/model';
import { Attention } from '../src/shell/sidebar/Attention';
import { RigGroups } from '../src/shell/sidebar/RigGroups';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** docs/mockups/ledge-human-operator-ab-lot1.html: « À toi » receives what OpenRig's rigs ask the person, and answers. */
const NOW = new Date().toISOString();
const ask = (o: Partial<HumanAsk> = {}): HumanAsk => ({
  id: 'qitem-1', kind: 'decision', alert: false, priority: 'routine',
  from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Écran de réglage : un modèle pour tout ?', body: 'Lu prépare Réglages › Ledge.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q1', question: 'Un modèle ?', options: [{ id: 'one', label: 'Un seul modèle', recommended: true }, { id: 'two', label: 'Un plus fort', recommended: false }], answer: null }],
  createdAt: NOW, updatedAt: NOW, ...o
});
const BIX: Session = fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'idle', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } });
const ready: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const answered = (o: Partial<OpenRigAnswered> = {}): OpenRigAnswered => ({ type: 'openrig.answered', requestId: 'r', qitemId: 'qitem-1', ok: true, outcome: 'answered', ...o });

function mount(asks: HumanAsk[], o: { partial?: boolean; channel?: HumanChannel | null; answer?: OpenRigAsksView['answer']; sessions?: Session[]; lang?: 'fr' | 'en'; onSource?: (a: HumanAsk, p: string) => void } = {}) {
  const answer = o.answer ?? vi.fn(async () => answered());
  const view: OpenRigAsksView = { channel: o.channel === undefined ? ready : o.channel, asks, truncated: false, partial: o.partial ?? false, answer, refresh: vi.fn() };
  const r = render(<LangProvider lang={o.lang ?? 'fr'}><AsksColumn view={view} sessions={o.sessions ?? [BIX]} machineLabel="WSL" {...(o.onSource ? { onSource: o.onSource } : {})} /></LangProvider>);
  const rerender = (next: HumanAsk[]) => r.rerender(<LangProvider lang={o.lang ?? 'fr'}><AsksColumn view={{ ...view, asks: next }} sessions={o.sessions ?? [BIX]} machineLabel="WSL" /></LangProvider>);
  return { answer, rerender };
}

describe('the sections', () => {
  it('a decision with buttons → Décisions; without, or parked → Questions; news → Nouvelles', () => {
    expect(sectionOf(ask())).toBe('decisions');
    expect(sectionOf(ask({ questions: [] }))).toBe('questions');
    expect(sectionOf(ask({ kind: 'parked', questions: [] }))).toBe('questions');
    expect(sectionOf(ask({ kind: 'update', questions: [] }))).toBe('updates');
    const s = bySection([ask({ id: 'a' }), ask({ id: 'b', kind: 'update', questions: [] }), ask({ id: 'c', priority: 'urgent' })]);
    expect(s.decisions.map(x => x.id)).toEqual(['a', 'c']); // the daemon's order is kept
  });
  it('an answer’s end: closed or vanished is settled elsewhere, not an error', () => {
    expect(endOf(answered({ ok: false, error: 'closed' }))).toEqual({ kind: 'already' });
    expect(endOf(answered({ ok: false, error: 'not_found' }))).toEqual({ kind: 'already' });
    expect(endOf(answered({ outcome: 'already' }))).toEqual({ kind: 'already' });
    expect(endOf(answered({ outcome: 'recorded', remaining: ['q2'] }))).toEqual({ kind: 'recorded', remaining: ['q2'] });
    expect(endOf(answered({ ok: false, error: 'unreachable', message: 'connection refused' }))).toEqual({ kind: 'failed', error: 'unreachable', message: 'connection refused' });
  });
});

describe('a decision card', () => {
  it('who, the pill, the summary, the body; the seat’s recommended option first, said so; a click sends the choice, then « Envoyé à Bix · pilot » for 1.5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolve!: (a: OpenRigAnswered) => void;
    const answer = vi.fn(() => new Promise<OpenRigAnswered>(r => { resolve = r; }));
    mount([ask()], { answer });
    const card = screen.getByRole('article', { name: 'Écran de réglage : un modèle pour tout ?' });
    expect(within(screen.getByRole('region', { name: 'Décisions' })).getByRole('article')).toBe(card);
    expect(card).toHaveTextContent('ledge-dev· Bixpilotdécision');
    expect(card).toHaveTextContent('Lu prépare Réglages › Ledge.');
    const rec = within(card).getByRole('button', { name: 'Un seul modèle · recommandé' });
    expect(rec).toHaveAttribute('title', 'Recommandé par Bix');
    expect(rec).toHaveClass('pri');
    await userEvent.click(rec);
    expect(answer).toHaveBeenCalledWith('qitem-1', { kind: 'choice', questionId: 'q1', optionId: 'one' });
    // While it goes: every control off, the wheel in the clicked one.
    for (const b of within(card).getAllByRole('button')) expect(b).toBeDisabled();
    expect(rec.querySelector('.ask-spin')).not.toBeNull();
    await act(async () => resolve(answered()));
    expect(screen.getByRole('status')).toHaveTextContent('Envoyé à Bix · pilot');
    expect(screen.queryByRole('article')).toBeNull();
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('not sent: « Pas envoyée : OpenRig est arrêté », and Réessayer sends the same answer again', async () => {
    const answer = vi.fn(async () => answered({ ok: false, error: 'openrig_stopped' }));
    mount([ask()], { answer });
    await userEvent.click(screen.getByRole('button', { name: 'Un plus fort' }));
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Pas envoyée : OpenRig est arrêté');
    await userEvent.click(within(err).getByRole('button', { name: 'Réessayer' }));
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[1]).toEqual(['qitem-1', { kind: 'choice', questionId: 'q1', optionId: 'two' }]);
  });

  it('unreachable says OpenRig’s message; settled elsewhere is no error but « Déjà réglée ailleurs »', async () => {
    mount([ask()], { answer: vi.fn(async () => answered({ ok: false, error: 'unreachable', message: 'connection refused' })) });
    await userEvent.click(screen.getByRole('button', { name: 'Un plus fort' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pas envoyée : connection refused');
    cleanup();
    mount([ask()], { answer: vi.fn(async () => answered({ ok: false, error: 'closed' })) });
    await userEvent.click(screen.getByRole('button', { name: 'Un plus fort' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Déjà réglée ailleurs');
  });

  it('« Répondre autrement… » puts a field in place of the buttons: Ctrl Enter sends the words, Échap gives the buttons back', async () => {
    const { answer } = mount([ask()]);
    await userEvent.click(screen.getByRole('button', { name: 'Répondre autrement…' }));
    const field = screen.getByRole('textbox', { name: 'Ta réponse, en quelques mots…' });
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Un seul modèle/ })).toBeNull();
    expect(screen.getByText('Ctrl Entrée · Échap')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Un seul modèle/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Répondre autrement…' }));
    await userEvent.type(screen.getByRole('textbox'), 'Plutôt deux, mais plus tard');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(answer).toHaveBeenCalledWith('qitem-1', { kind: 'words', text: 'Plutôt deux, mais plus tard' });
  });

  it('several questions, one under the other: a recorded one shows « ✓ label » for good; the foot counts them', async () => {
    const two = ask({ summary: 'Deux choix', questions: [
      { id: 'q1', question: 'Un modèle ?', options: [{ id: 'one', label: 'Un seul modèle', recommended: false }, { id: 'two', label: 'Deux', recommended: false }], answer: null },
      { id: 'q2', question: 'Délai ?', options: [{ id: '3', label: '3 s', recommended: false }, { id: '5', label: '5 s', recommended: true }], answer: null }
    ] });
    const answer = vi.fn(async () => answered({ outcome: 'recorded', remaining: ['q2'] }));
    mount([two], { answer });
    expect(screen.getByText('0/2 répondues · la réponse part à la dernière')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Un seul modèle' }));
    expect(screen.queryByRole('button', { name: 'Un seul modèle' })).toBeNull();
    expect(screen.getByText('Un seul modèle').closest('.ask-chosen')).not.toBeNull();
    expect(screen.getByText('1/2 répondues · la réponse part à la dernière')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 s · recommandé' })).toBeEnabled();
  });

  it('a long body: three lines, « Tout lire »; « Détails » folds the detail; the source opens its file', async () => {
    const onSource = vi.fn();
    mount([ask({ body: 'a\nb\nc\nd\ne', detail: 'Le détail.', evidenceRef: 'docs/mockups/x.html' })], { onSource });
    await userEvent.click(screen.getByRole('button', { name: 'Tout lire' }));
    expect(screen.queryByRole('button', { name: 'Tout lire' })).toBeNull();
    expect(screen.queryByText('Le détail.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Détails' }));
    expect(screen.getByText('Le détail.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'docs/mockups/x.html' }));
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'qitem-1' }), 'docs/mockups/x.html');
  });

  it('an ask never read whole (its body is its summary) shows no body', () => {
    mount([ask({ body: 'Écran de réglage : un modèle pour tout ?', bodyTruncated: true })]);
    expect(document.querySelector('.ask-body')).toBeNull();
  });

  it('priority: « urgent », « critique », nothing for routine', () => {
    mount([ask({ id: 'a', priority: 'critical' }), ask({ id: 'b', priority: 'urgent' }), ask({ id: 'c' })]);
    const pills = [...document.querySelectorAll('[data-ask]')].map(c => c.querySelector('.ask-pill-urgent')?.textContent ?? null);
    expect(pills).toEqual(['critique', 'urgent', null]);
  });
});

describe('questions and news', () => {
  it('a row parked on the person: « en attente de toi », « Répondre… » asks what the seat should do, and sends resolve', async () => {
    const { answer } = mount([ask({ kind: 'parked', questions: [] })]);
    const card = within(screen.getByRole('region', { name: 'Questions' })).getByRole('article');
    expect(card).toHaveTextContent('en attente de toi');
    await userEvent.click(within(card).getByRole('button', { name: 'Répondre…' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Ce que Bix doit faire…' }), 'Garde la carte');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(answer).toHaveBeenCalledWith('qitem-1', { kind: 'resolve', text: 'Garde la carte' });
  });

  it('a decision without buttons: « question », « Écrire la réponse… » sends words', async () => {
    const { answer } = mount([ask({ questions: [] })]);
    expect(screen.getByRole('article')).toHaveTextContent('question');
    await userEvent.click(screen.getByRole('button', { name: 'Écrire la réponse…' }));
    await userEvent.type(screen.getByRole('textbox'), 'Oui');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(answer).toHaveBeenCalledWith('qitem-1', { kind: 'words', text: 'Oui' });
  });

  it('a piece of news: Nouvelles, compact, « Vu » sends seen', async () => {
    const { answer } = mount([ask({ kind: 'update', questions: [], summary: 'Maquette rendue' })]);
    const card = within(screen.getByRole('region', { name: 'Nouvelles' })).getByRole('article', { name: 'Maquette rendue' });
    expect(card).toHaveTextContent('nouvelle');
    await userEvent.click(within(card).getByRole('button', { name: 'Vu' }));
    expect(answer).toHaveBeenCalledWith('qitem-1', { kind: 'seen' });
  });

  it('English', () => {
    mount([ask({ kind: 'update', questions: [] }), ask({ id: 'b' })], { lang: 'en' });
    expect(screen.getByRole('region', { name: 'Updates' })).toHaveTextContent('update');
    expect(screen.getByRole('button', { name: 'Un seul modèle · recommended' })).toHaveAttribute('title', 'Recommended by Bix');
    expect(screen.getByRole('button', { name: 'Answer another way…' })).toBeInTheDocument();
  });
});

describe('the channel’s banners (no button at lot 1)', () => {
  it.each([
    ['no_person', undefined, 'Ledge n’est pas encore le canal humain d’OpenRig.Les rigs passent encore par Max, ou par le TUI du kernel. Leurs demandes n’arrivent pas ici.', 'err'],
    ['no_default', 'rig human default ledge@external', 'OpenRig a plusieurs personnes, et aucune n’est désignée par défaut.Ses demandes n’arrivent donc pas ici. Pour en désigner une :rig human default ledge@external', 'err'],
    ['openrig_stopped', undefined, 'OpenRig est arrêté : les rigs ne peuvent pas t’écrire.Les sessions de tes projets passent toujours par ici.', 'warn'],
    ['unreachable', 'connection refused on 127.0.0.1:7433', 'OpenRig ne répond pas.connection refused on 127.0.0.1:7433', 'warn'],
    ['not_installed', undefined, 'OpenRig n’est pas installé sur WSL.Les sessions de tes projets passent toujours par ici.', '']
  ] as const)('%s', (state, message, text, tone) => {
    mount([], { channel: { state, person: null, slack: false, ...(message ? { message } : {}) } });
    const banner = document.querySelector('.ask-banner')!;
    expect(banner).toHaveTextContent(text);
    if (tone) expect(banner).toHaveClass(`ask-banner-${tone}`); else expect(banner.className).toBe('ask-banner');
    expect(within(banner as HTMLElement).queryByRole('button')).toBeNull();
  });
  it('ready and nothing asked: nothing at all', () => {
    mount([]);
    expect(document.querySelector('.ask-col')).toBeNull();
  });
});

describe('a partial read and the counts (design-ux)', () => {
  it('a failed read: one grey line atop the column; none under a banner', () => {
    mount([ask()], { partial: true });
    const line = document.querySelector('.ask-partial')!;
    expect(line).toHaveTextContent('Liste peut-être incomplète : OpenRig n’a pas répondu à la dernière lecture.');
    expect(line.nextElementSibling).toHaveClass('ask-sec');
    expect(document.querySelectorAll('.ask-partial')).toHaveLength(1);
    cleanup();
    mount([], { partial: true, channel: { state: 'openrig_stopped', person: null, slack: false } });
    expect(document.querySelector('.ask-partial')).toBeNull();
  });
  it('Nouvelles counts in grey; Décisions and Questions in red', () => {
    mount([ask(), ask({ id: 'b', kind: 'update', questions: [] })]);
    expect(screen.getByRole('region', { name: 'Nouvelles' }).querySelector('.ask-n')).toHaveClass('neutral');
    expect(screen.getByRole('region', { name: 'Décisions' }).querySelector('.ask-n')).not.toHaveClass('neutral');
  });
  it('« Le point » takes half the zone at most and scrolls inside, its head and section titles staying up', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/shell.css'), 'utf8');
    expect(css).toMatch(/\.home-body \{[^}]*container-type: size/);
    expect(css).toMatch(/\.le-point \{[^}]*max-height: 50cqh;[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.le-point \.lp-head \{[^}]*position: sticky; top: 0/);
    expect(css).toMatch(/\.le-point \.ask-sec-title \{[^}]*position: sticky; top: var\(--lp-head\)/);
    expect(css).toMatch(/\.le-point\.lp-more::after \{[^}]*height: 16px/);
  });
});

describe('the sidebar', () => {
  it('« À toi »: one compact line per ask, the seat’s mascot or the rig’s hexagon, « Voir » opens the card; no answer here', () => {
    const onSeeAsk = vi.fn();
    render(<LangProvider lang="fr"><aside className="st"><Attention items={[]} current={null} projectOf={() => null} onOpen={vi.fn()} onDecide={vi.fn()} onMenu={vi.fn()} paused
      rigAsks={[ask({ priority: 'urgent' }), ask({ id: 'qitem-2', from: { seat: 'qa-review@other', rig: 'other', role: 'qa.review' } })]} sessions={[BIX]} onSeeAsk={onSeeAsk} /></aside></LangProvider>);
    const rows = [...document.querySelectorAll('.st-rig-ask')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bix · ledge-dev');
    expect(rows[0]).toHaveTextContent('urgent');
    expect(rows[0]).toHaveTextContent('Écran de réglage : un modèle pour tout ?');
    expect(rows[1]!.querySelector('.st-rig-hex')).not.toBeNull();
    expect(rows[1]).toHaveTextContent('qa.review · other');
    expect(within(rows[0]!).getAllByRole('button').map(b => b.textContent)).toEqual(['Voir']);
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Voir' }));
    expect(onSeeAsk).toHaveBeenCalledWith('qitem-1');
    expect(screen.getByRole('region', { name: 'À toi' })).toHaveTextContent('2');
  });

  it('the seat’s mark: only what waits on an answer, the most pressing first; news marks nothing', () => {
    expect(markOf([ask({ kind: 'update', questions: [] })])).toBeNull();
    expect(markOf([ask({ questions: [] }), ask({ kind: 'parked', questions: [] })])).toBe('parked');
    expect(markOf([ask({ kind: 'parked', questions: [] }), ask()])).toBe('decision');
    render(<LangProvider lang="fr"><aside className="st"><RigGroups sessions={[BIX]} current={null} paused dispatch={vi.fn()} asks={[ask({ kind: 'update', questions: [] })]} /></aside></LangProvider>);
    expect(document.querySelector('.st-ask-mark')).toBeNull();
    expect(document.querySelector('.st-rig .t-need')).toBeNull();
  });

  it('Rigs: the asking seat’s row says « décision » in red, and its rig counts it', () => {
    render(<LangProvider lang="fr"><aside className="st"><RigGroups sessions={[BIX]} current={null} paused dispatch={vi.fn()} asks={[ask()]} /></aside></LangProvider>);
    expect(document.querySelector('.st-ask-mark')).toHaveTextContent('décision');
    expect(document.querySelector('.st-rig .t-need')).toHaveTextContent('1');
  });
});

describe('Markdown bodies (the lead: folded = words without syntax, unfolded = rendered)', () => {
  it('plainOf drops the syntax and keeps the words and lines', async () => {
    const { plainOf } = await import('../src/asks/plain');
    expect(plainOf('## Contexte\n\n- **un** point\n- `code` et [lien](http://x)\n\n> cité\n\n```ts\nconst a = 1;\n```\n---\n| a | b |\n|---|---|\n| 1 | 2 |'))
      .toBe('Contexte\n\nun point\ncode et lien\n\ncité\n\nconst a = 1;\na · b\n1 · 2');
    expect(plainOf('1. _premier_ ~~non~~\n2) [x] fait')).toBe('premier non\nfait');
    expect(plainOf('a snake_case_name and 2*3*4')).toBe('a snake_case_name and 2*3*4');
  });

  it('a long body folded shows no raw « ## » or « - »; « Tout lire » renders the Markdown', async () => {
    mount([ask({ body: '## Contexte\n- un\n- deux\n- trois\n- quatre' })]);
    const folded = document.querySelector('.ask-body.clamp3')!;
    expect(folded.textContent).toBe('Contexte\nun\ndeux\ntrois\nquatre');
    await userEvent.click(screen.getByRole('button', { name: 'Tout lire' }));
    const md = document.querySelector('.ask-md [data-markdown]')!;
    expect(md.querySelector('h2')).toHaveTextContent('Contexte');
    expect(md.querySelectorAll('li')).toHaveLength(4);
  });

  it('a short body that fits is rendered whole; « Détails » renders its Markdown', async () => {
    mount([ask({ body: 'Voir **ceci**.', detail: '- un\n- deux' })]);
    expect(document.querySelector('.ask-md strong')).toHaveTextContent('ceci');
    expect(screen.queryByRole('button', { name: 'Tout lire' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Détails' }));
    expect(document.querySelectorAll('.ask-detail li')).toHaveLength(2);
  });
});
