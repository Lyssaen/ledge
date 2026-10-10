import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MESSAGES } from '../src/i18n/messages';
import { LangProvider, loadLang, saveLang, setFallbackLang } from '../src/i18n/lang';
import { relativeTime } from '../src/format';
import { SessionList } from '../src/surface/SessionList';
import { SessionView } from '../src/surface/SessionView';
import { fakeSession } from './mockDaemon';

const T = Date.parse('2026-10-09T18:00:00.000Z');
/** Every key path of a dictionary, functions and arrays as leaves. */
const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
const list = [perm, fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' })];
const noop = () => {};
const viewProps = { preview: [], visible: true, reading: false, draft: '', onDraft: noop, onBack: noop, onClose: noop, onDecide: noop, onReply: noop, onInterrupt: noop, onKill: noop, onFocus: noop, onToggleReading: noop };

afterEach(() => { localStorage.removeItem('ledge.lang'); setFallbackLang('en'); });

describe('message catalogue', () => {
  it('French and English have the same keys', () => {
    expect(keys(MESSAGES.fr).sort()).toEqual(keys(MESSAGES.en).sort());
    expect(MESSAGES.fr.help.keys).toHaveLength(MESSAGES.en.help.keys.length);
  });
  it('French is the default; the stored language wins; garbage falls back', () => {
    setFallbackLang('fr');
    expect(loadLang()).toBe('fr');
    saveLang('en'); expect(loadLang()).toBe('en');
    localStorage.setItem('ledge.lang', 'de'); expect(loadLang()).toBe('fr');
  });
  it('plurals are explicit', () => {
    expect(MESSAGES.fr.list.summary(1, 1)).toBe('1 session · 1 demande pour vous');
    expect(MESSAGES.fr.list.summary(4, 2)).toBe('4 sessions · 2 demandes pour vous');
    expect(MESSAGES.fr.list.summary(3, 0)).toBe('3 sessions · tout est à jour');
    expect(MESSAGES.en.list.summary(1, 0)).toBe('1 session · nothing waiting');
    expect(MESSAGES.fr.bubble.more(1)).toBe('+1 autre');
    expect(MESSAGES.fr.bubble.more(2)).toBe('+2 autres');
  });
  it('relative time is localized: FR "2 min", EN "2m"', () => {
    expect(relativeTime('2026-10-09T17:58:00.000Z', T, MESSAGES.fr)).toBe('2 min');
    expect(relativeTime('2026-10-09T17:58:00.000Z', T, MESSAGES.en)).toBe('2m');
    expect(relativeTime('2026-10-09T17:59:12.000Z', T, MESSAGES.fr)).toBe('48 s');
    expect(relativeTime('2026-10-09T15:00:00.000Z', T, MESSAGES.fr)).toBe('3 h');
  });
});

describe('French labels', () => {
  it('the list reads the mockup copy, aria-labels included', () => {
    render(<LangProvider lang="fr"><SessionList sessions={list} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={noop} onOpen={noop} onClose={noop} now={T} /></LangProvider>);
    expect(screen.getByText('2 sessions · 1 demande pour vous')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ne pas déranger' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Réglages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replier' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'harness-assistant, Otto, ouvrir' });
    expect(within(row).getByText('Votre accord')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'speos-api, Pim, ouvrir' })).getByText('Au travail')).toBeInTheDocument();
    expect(screen.getByText('Ctrl Alt L')).toBeInTheDocument();
  });
  it('a permission reads "<Name> souhaite lancer une commande." with Refuser / Autoriser and the reply placeholder', () => {
    render(<LangProvider lang="fr"><SessionView {...viewProps} session={perm} /></LangProvider>);
    expect(screen.getByText('À vous de jouer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Otto souhaite lancer une commande.' })).toBeInTheDocument();
    expect(screen.getByText('Exécution dans harness-assistant')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Toujours pour cette session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeEnabled();
    expect(screen.getByPlaceholderText('Une instruction pour votre compagnon…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir l’onglet du terminal' })).toBeInTheDocument();
  });
  it('a question offers radio cards, "Ou proposez autre chose…" (off) and "Envoyer la réponse →"', () => {
    const q = fakeSession('b', { state: 'waiting_input', pending: { kind: 'question', text: 'Quel thème ?', options: ['Sombre', 'Clair'], source: 'pane' } });
    render(<LangProvider lang="fr"><SessionView {...viewProps} session={q} /></LangProvider>);
    expect(screen.getByRole('heading', { name: 'Quel thème ?' })).toBeInTheDocument();
    expect(screen.getByText('Une question')).toBeInTheDocument();
    expect(screen.getByLabelText('Sombre')).toBeChecked();
    expect(screen.getByPlaceholderText('Ou proposez autre chose…')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Envoyer la réponse →' })).toBeEnabled();
  });
  it('a read-only session explains itself and offers no reply field', () => {
    const ro = fakeSession('c', { source: 'hook_only', tmuxSession: null });
    render(<LangProvider lang="fr"><SessionView {...viewProps} session={ro} /></LangProvider>);
    expect(screen.getByRole('heading', { name: 'Visible, en lecture seule.' })).toBeInTheDocument();
    expect(screen.getByText('Otto a été lancé sans le lanceur Ledge.')).toBeInTheDocument();
    expect(screen.getByText('Lecture seule')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
