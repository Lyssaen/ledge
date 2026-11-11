import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BROADCAST_SESSIONS_MAX, type PhoneServerMessage, type PhoneSession, type ThreadItem } from '@ledge/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/copy';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

type Daemon = { models?: true; broadcast?: true; checklist?: true; sessionClose?: true };
const ctx = (pct: number) => ({ used: pct * 1000, window: 100_000, at: '2026-10-14T10:00:00.000Z' });
const pim = (extra: Partial<PhoneSession> = {}) => session('a', { name: 'Pim', project: 'ledge', branch: 'feat/ide-shell', model: 'opus', effort: 'high', canSwitch: true, context: ctx(62), ...extra });

function opened(sessions: PhoneSession[] = [pim()], daemon: Daemon = { models: true, broadcast: true, sessionClose: true }) {
  const t = setup();
  const m = snapshot(sessions) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...m, daemon: { ...m.daemon!, ...daemon } });
  const view = render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  act(() => t.deliver({ type: 'session.thread', id: 'a', items: [], cut: [], more: false }));
  return { ...t, view };
}
const more = () => { fireEvent.click(screen.getByRole('button', { name: 'Plus d’actions pour Pim' })); return within(screen.getByRole('dialog', { name: 'Actions pour Pim' })); };

describe('a session’s head and foot (m2-sessions.html §3, §4)', () => {
  it('the head: back, runtime, name, the dot of its state, « Fil · Terminal », « Plus d’actions »', () => {
    opened([pim({ state: 'waiting_permission', pending: pending({ key: 'k' }) })]);
    const head = screen.getByRole('banner');
    expect(within(head).getByText('CC')).toBeInTheDocument();
    expect(within(head).getByText('Pim')).toBeInTheDocument();
    expect(head.querySelector('[data-dot]')).toHaveAttribute('data-dot', 'perm');
    const views = within(head).getByRole('navigation', { name: 'Vue de la session' });
    expect(within(views).getByRole('link', { name: 'Fil' })).toHaveAttribute('aria-current', 'page');
    expect(within(views).getByRole('link', { name: 'Terminal' })).toHaveAttribute('href', '#/terminal/a');
  });

  it('an ended session says when in its head', () => {
    opened([pim({ state: 'exited', exitedAt: new Date().toISOString() })]);
    expect(within(screen.getByRole('banner')).getByText(/^terminée à \d\d:\d\d$/)).toBeInTheDocument();
  });

  describe('its end time on a phone, under the name where it fits (review-qa f3d4bee6, design-ux e39f7cba)', () => {
    const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
    afterEach(() => { wide(false); setLang('fr'); });
    // The name's line and the end time's share one column: the end time is under the name, not after it.
    const column = (end: RegExp) => { const p = within(screen.getByRole('banner')).getByText(end).parentElement!; return p.tagName !== 'HEADER' && p.contains(within(screen.getByRole('banner')).getByText('Pim')) ? p : null; };

    it.each([['fr', /^terminée à \d\d:\d\d$/], ['en', /^ended at \d\d:\d\d$/]] as const)('in %s', (lang, end) => {
      setLang(lang);
      opened([pim({ state: 'exited', exitedAt: new Date().toISOString() })]);
      expect(column(end)).toHaveClass('flex-col');
      expect(within(screen.getByRole('banner')).getByText('Pim')).toHaveClass('truncate');
    });

    // At 390 px the end time only fits with the 36 px of the app's margins: the head reaches the screen's edges, as `.dhead`
    // does on the mockup (review-qa e4f08d08).
    it('the head reaches the screen’s edges, as its foot does', () => {
      opened([pim({ state: 'exited', exitedAt: new Date().toISOString() })]);
      expect(screen.getByRole('banner')).toHaveClass('bleed');
    });

    it('a live session has no second line', () => {
      opened([pim()]);
      expect(screen.getByRole('banner').querySelector('.flex-col')).toBeNull();
    });

    it('on a tablet the end time stays beside the name', () => {
      wide(true);
      opened([pim({ state: 'exited', exitedAt: new Date().toISOString() })]);
      expect(column(/^terminée à \d\d:\d\d$/)).toBeNull();
    });
  });

  it('the foot: the model that opens « Modèle et effort », the context (amber past « Contexte max »), the branch', () => {
    opened([pim({ context: ctx(84) })]);
    const foot = screen.getByRole('contentinfo', { name: 'État de Pim' });
    expect(foot).toHaveTextContent('Opus');
    expect(within(foot).getByRole('img', { name: 'Contexte utilisé : 84 %' })).toHaveClass('text-attention');
    expect(foot).toHaveTextContent('feat/ide-shell');
    fireEvent.click(within(foot).getByRole('button', { name: /Modèle et effort :/ }));
    expect(screen.getByRole('dialog', { name: 'Modèle et effort' })).toBeInTheDocument();
  });

  it('a folder without Git shows the folder; a model the phone cannot change is not a button; no MR/PR', () => {
    opened([pim({ branch: undefined, canSwitch: undefined, context: ctx(21) })]);
    const foot = screen.getByRole('contentinfo', { name: 'État de Pim' });
    expect(within(foot).getByLabelText('Dossier ledge')).toBeInTheDocument();
    expect(within(foot).queryByRole('button')).toBeNull();
    expect(within(foot).getByRole('img', { name: 'Contexte utilisé : 21 %' })).not.toHaveClass('text-attention');
  });

  it('folds the tools in a row: their count and names, opened one per line with its state', () => {
    const t = opened();
    const tool = (id: string, name: string, label: string, status: 'success' | 'running'): ThreadItem =>
      ({ kind: 'tool', id, at: '2026-10-14T10:00:00.000Z', turn: 1, tool: name, label, status, files: [] });
    act(() => t.deliver({ type: 'session.thread', id: 'a', items: [tool('t1', 'Bash', 'pnpm e2e', 'success'), tool('t2', 'Read', 'spec.ts', 'success'), tool('t3', 'Edit', 'Shell.tsx', 'running')], cut: [], more: false }));
    const fold = screen.getByRole('button', { name: '3 outils · Bash, Read, Edit' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fold);
    expect(screen.getByRole('button', { name: '3 outils' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Shell.tsx').closest('li')).toContainElement(screen.getByRole('img', { name: 'en cours' }));
    expect(screen.getAllByRole('img', { name: 'fait' })).toHaveLength(2);
  });
});

describe('« Plus d’actions » (m2-sessions.html §5)', () => {
  it('a working session: Modèle et effort, Interrompre, Écrire au groupe, then Fermer; no Redémarrer', () => {
    opened([pim({ state: 'working' }), session('b', { name: 'Ida', project: 'ledge' })]);
    const sheet = more();
    expect(sheet.getAllByRole('button').map(b => b.textContent)).toEqual([
      'Modèle et effortOpus · Élevé', 'Interrompre Pim', 'Écrire au groupe ledge', 'Fermer Pim'
    ]);
    expect(sheet.getByText('Interrompre n’annule pas les actions déjà effectuées.')).toBeInTheDocument();
    expect(sheet.queryByText(/Redémarrer/)).toBeNull();
  });

  it('Interrompre goes once, then says it went; off with its reason when the agent does not work', () => {
    const t = opened([pim({ state: 'working' })]);
    fireEvent.click(more().getByRole('button', { name: 'Interrompre Pim' }));
    expect(t.of('session.interrupt')).toMatchObject([{ id: 'a' }]);
    act(() => t.deliver({ type: 'operation.result', op: t.of('session.interrupt')[0]!.op, status: 'applied' }));
    expect(screen.getByRole('button', { name: 'Interruption transmise' })).toBeDisabled();
    t.view.unmount();
    opened([pim({ state: 'idle' })]);
    const idle = more().getByRole('button', { name: /Interrompre Pim/ });
    expect(idle).toBeDisabled();
    expect(idle).toHaveTextContent('L’agent ne travaille pas.');
  });

  it('Modèle et effort off says why: an older PC, a session started outside Ledge, an ended one (Q71)', () => {
    const cases: [PhoneSession, Daemon, string][] = [
      [pim(), { sessionClose: true }, 'Le changer depuis le téléphone arrive avec une prochaine version de Ledge sur le PC.'],
      [pim({ canSwitch: undefined, readOnly: true }), { models: true }, 'Démarrée hors de Ledge : change-le dans son terminal.'],
      [pim({ canSwitch: undefined, state: 'exited' }), { models: true }, 'La session est terminée.']
    ];
    for (const [s, d, why] of cases) {
      const t = opened([s], d);
      const row = more().getByRole('button', { name: /Modèle et effort/ });
      expect(row).toBeDisabled();
      expect(row).toHaveTextContent(why);
      t.view.unmount();
    }
  });

  it('Plan de travail when the agent has one: its count, then the plan in the sheet', () => {
    const t = setup();
    const m = snapshot([pim()]) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...m, daemon: { ...m.daemon!, checklist: true } });
    t.deliver({ type: 'session.checklist', id: 'a', checklist: { tasks: [{ text: 'Poser la coque', status: 'completed' }, { text: 'Migrer', status: 'in_progress' }], done: 1, total: 2 } } as PhoneServerMessage);
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    const sheet = more();
    fireEvent.click(sheet.getByRole('button', { name: /Plan de travail/ }));
    expect(sheet.getAllByText('Migrer').length).toBeGreaterThan(0);
  });

  it('Fermer is not there for an ended session nor from an older PC', () => {
    for (const [s, d] of [[pim({ state: 'exited' }), { models: true, sessionClose: true }], [pim(), { models: true }]] as const) {
      const t = opened([s], d);
      expect(more().queryByRole('button', { name: 'Fermer Pim' })).toBeNull();
      t.view.unmount();
    }
  });
});

describe('« Écrire au groupe » from the sheet', () => {
  const group = (extra: PhoneSession[] = [session('c', { name: 'Zoé', project: 'ledge' }), session('b', { name: 'Ada', project: 'relay' })], d: Daemon = { broadcast: true }) =>
    opened([pim(), ...extra], d);

  it('a PC that does not take a broadcast, or a session alone in its group: no line', () => {
    const t = group(undefined, {});
    expect(more().queryByRole('button', { name: /Écrire au groupe/ })).toBeNull();
    t.view.unmount();
    group([session('b', { name: 'Ada', project: 'relay' }), session('c', { name: 'Zoé', project: 'ledge', state: 'exited' })]);
    expect(more().queryByRole('button', { name: /Écrire au groupe/ })).toBeNull();
  });

  it('writes to the live sessions of its project, and says who got it and who did not', async () => {
    const t = group([session('c', { name: 'Zoé', project: 'ledge' }), session('d', { name: 'Lou', project: 'ledge', state: 'exited' }), session('b', { name: 'Ada', project: 'relay' })]);
    const sheet = more();
    fireEvent.click(sheet.getByRole('button', { name: 'Écrire au groupe ledge' }));
    expect(sheet.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    fireEvent.change(sheet.getByRole('textbox'), { target: { value: 'Pause café' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Envoyer' }));
    const [m] = t.of('session.broadcast');
    expect(m).toMatchObject({ sessions: ['a', 'c'], text: 'Pause café' });
    await act(async () => { t.deliver({ type: 'operation.result', op: m!.op, status: 'applied', sent: ['Pim'], refused: [{ name: 'Zoé', reason: "Zoé s'est terminée" }] }); });
    expect(await screen.findByText(/Envoyé à Pim/)).toBeInTheDocument();
    expect(screen.getByText(/Zoé s'est terminée/)).toBeInTheDocument();
  });

  it('a seat writes to its rig; more than one broadcast takes is refused in words, nothing sent', () => {
    const seat = (id: string) => session(id, { name: id.toUpperCase(), project: 'ledge', rig: { name: 'ledge-dev', role: 'dev' } });
    const t = setup();
    const m = snapshot([{ ...pim(), rig: { name: 'ledge-dev', role: 'lead' } }, ...Array.from({ length: BROADCAST_SESSIONS_MAX }, (_, i) => seat(`s${i}`))]) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...m, daemon: { ...m.daemon!, broadcast: true } });
    render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
    const sheet = more();
    fireEvent.click(sheet.getByRole('button', { name: 'Écrire au groupe Rig ledge-dev' }));
    fireEvent.change(sheet.getByRole('textbox'), { target: { value: 'Salut' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Envoyer' }));
    expect(t.of('session.broadcast')).toEqual([]);
    expect(sheet.getByRole('status')).toHaveTextContent(`${BROADCAST_SESSIONS_MAX + 1} sessions dans ce groupe, ${BROADCAST_SESSIONS_MAX} au plus`);
  });

  it('« Annuler » gives the menu back and sends nothing', () => {
    const t = group();
    const sheet = more();
    fireEvent.click(sheet.getByRole('button', { name: 'Écrire au groupe ledge' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Annuler' }));
    expect(sheet.queryByRole('textbox')).toBeNull();
    expect(sheet.getByRole('button', { name: 'Écrire au groupe ledge' })).toBeInTheDocument();
    expect(t.of('session.broadcast')).toEqual([]);
  });
});
