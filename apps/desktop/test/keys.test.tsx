import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useToast } from '../src/shell/Toast';
import { focusFrontTab, focusThread, useKeys } from '../src/nav/useKeys';
import { initialNav } from '../src/nav/state';
import type { Overview } from '../src/nav/overview';
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfirmDialog } from '../src/manage/ConfirmDialog';
import { ShortcutsHelp } from '../src/shell/ShortcutsHelp';
import { Shortcuts } from '../src/settings/Shortcuts';
import { LangProvider } from '../src/i18n/lang';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { boot, closeDaemons, seedAtelier, TWO_PROJECTS } from './helpers';
import { loadIde } from '../src/ide/lazy';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

/** The IDE's front tab, by name (the old interface's crumb). */
const frontName = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label') ?? null;
const PALETTE = 'Palette';

describe('global shortcuts', () => {
  it('Ctrl K opens the search from anywhere, even while typing', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: PALETTE })).toBeVisible();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('single keys do nothing while typing in a field; Escape still closes', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('n/?');
    expect(screen.getByRole('combobox')).toHaveValue('n/?');
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' }).contains(document.activeElement)).toBe(false);
    await user.keyboard('{Alt>}1{/Alt}');
    expect(screen.getByRole('dialog', { name: PALETTE })).toBeVisible();   // Alt 1 does nothing inside the search
    expect(frontName()).toBe('Atelier');
  });

  it('a field of the page (not a dialog) also swallows the single keys and Alt 1', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    const field = document.createElement('input');
    document.body.append(field); field.focus();
    await user.keyboard('n/?{Alt>}1{/Alt}');
    expect(field).toHaveValue('n/?');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field).toHaveFocus();
    expect(frontName()).toBe('Atelier');
    await user.keyboard('{Control>}k{/Control}');                         // Ctrl K still works there
    expect(screen.getByRole('dialog', { name: PALETTE })).toBeVisible();
    field.remove();
  });

  it('/ focuses the right panel\'s chat field; Escape leaves it, the panel stays; Ctrl / hides it', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('/');
    const chat = await screen.findByRole('complementary', { name: 'Chat Ledge' });
    await waitFor(() => expect(within(chat).getByRole('textbox', { name: 'Ask Ledge' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(chat.contains(document.activeElement)).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    await user.keyboard('{Control>}/{/Control}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull());
  });

  it('N opens New session, ? the shortcuts', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('n'); expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible(); await user.keyboard('{Escape}');
    await user.keyboard('?'); expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible(); await user.keyboard('{Escape}');
  });

  it('Alt 1…9 open the main agents in order; Alt → / ← walk them, wrapping', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Alt>}1{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Otto'));
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Nova'));
    await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Kit'));
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Otto'));
    await user.keyboard('{Alt>}9{/Alt}');                                 // no ninth agent: nothing changes
    expect(frontName()).toBe('Otto');
  });

  it('Ctrl , opens the Settings tab; Escape closes the dialog open over it, and only that: the tabs stay', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Alt>}1{/Alt}{Control>},{/Control}');
    await waitFor(() => expect(frontName()).toBe('Settings'));
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: PALETTE })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frontName()).toBe('Settings');
    await user.keyboard('{Escape}');
    expect(frontName()).toBe('Settings');
  });

  // Escape gives the focus back; a command run or a click outside puts it elsewhere.
  it('focus goes back to where it was when the search closes', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    const btn = within(screen.getByRole('navigation', { name: 'Activity bar' })).getByRole('button', { name: 'Projects' });
    btn.focus();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(btn).toHaveFocus();
  });
});

describe('the fleet corrects the place', () => {
  it('an open agent that disappears loses its tab; an offline one keeps it', async () => {
    const { d, user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('{Alt>}1{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Otto'));
    d.remove('otto');
    await waitFor(() => expect(screen.queryAllByRole('tab').some(t => t.getAttribute('aria-label') === 'Otto')).toBe(false));
    await user.keyboard('{Alt>}1{/Alt}');
    await waitFor(() => expect(frontName()).toBe('Nova'));
    d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working', offline: true }));
    await new Promise(r => setTimeout(r, 200));
    expect(frontName()).toBe('Nova');
  });

  it('a daemon that never sends projects still gives a working shell', async () => {
    const d = await createMockDaemon(); onTestFinished(() => d.close());
    d.machines([{ id: 'local', label: 'Local' }]);
    d.upsert(fakeSession('otto', { name: 'Otto' }));
    seedAtelier(); await loadIde();
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    // The IDE on its Atelier tab, the agent seated.
    expect(await screen.findByRole('button', { name: /^Otto,/ }, { timeout: 5000 })).toBeVisible();
    expect(frontName()).toBe('Atelier');
  });
});

describe('Ctrl Z', () => {
  function Undoer({ run }: { run: () => void }) {
    const { notify, undo } = useToast();
    useKeys(() => {}, { state: initialNav({ view: 'atelier', helpers: false, paused: false } as Overview), order: [], screen: { current: null }, undo });
    return <><button onClick={() => notify('Archivé.', { label: 'Annuler', run })}>archive</button><input aria-label="field" /></>;
  }
  it('Ctrl Z runs the visible toast action, and does nothing in a text field', async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(<Undoer run={run} />);
    await user.click(screen.getByRole('button', { name: 'archive' }));
    await user.click(screen.getByLabelText('field'));
    await user.keyboard('{Control>}z{/Control}');
    expect(run).not.toHaveBeenCalled();
    screen.getByLabelText('field').blur();
    await user.keyboard('{Control>}z{/Control}');
    expect(run).toHaveBeenCalledTimes(1);
    await user.keyboard('{Control>}z{/Control}');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('an open confirmation', () => {
  const confirm = { kind: 'delete' as const, names: ['Old'], live: 0, offline: [], archived: true, kids: 0, ids: ['old'] };
  function Asking({ dispatch, run, cancel }: { dispatch: () => void; run: () => void; cancel: () => void }) {
    const { notify, undo } = useToast();
    useKeys(dispatch, { state: initialNav({ view: 'atelier', helpers: false, paused: false } as Overview), order: [], screen: { current: null }, undo, confirming: { cancel } });
    return <><button onClick={() => notify('Archivé.', { label: 'Annuler', run })}>archive</button><ConfirmDialog c={confirm} onConfirm={() => {}} onCancel={cancel} /></>;
  }
  it('owns the keyboard: Escape from the close button cancels without navigating; ? and Ctrl Z do nothing', async () => {
    const dispatch = vi.fn(), run = vi.fn(), cancel = vi.fn();
    const user = userEvent.setup();
    render(<LangProvider lang="en"><Asking dispatch={dispatch} run={run} cancel={cancel} /></LangProvider>);
    // The toast is up before the dialog's focus matters: Ctrl Z would take it back if the dialog did not own the keys.
    fireEvent.click(screen.getByRole('button', { name: 'archive' }));
    await user.keyboard('?');
    await user.keyboard('{Control>}z{/Control}');
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('{Escape}');
    expect(dispatch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
});

describe('the terminal and the keyboard', () => {
  function Keys({ dispatch, toTerminal }: { dispatch: () => void; toTerminal?: () => boolean }) {
    useKeys(dispatch, { state: initialNav({ view: 'atelier', helpers: false, paused: false } as Overview), order: [fakeSession('otto', { name: 'Otto' })], screen: { current: null }, undo: () => false, toTerminal });
    return null;
  }

  it('inside the terminal, Ledge keeps its hands off: Ctrl K, Ctrl , and Escape do nothing', () => {
    const dispatch = vi.fn();
    render(<Keys dispatch={dispatch} />);
    // xterm types through a hidden textarea inside its host.
    const host = document.createElement('div');
    host.setAttribute('data-terminal', '');
    const input = document.createElement('textarea');
    host.append(input); document.body.append(host); onTestFinished(() => host.remove());
    input.focus();
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(input, { key: ',', code: 'Comma', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(input, { key: '1', code: 'Digit1', altKey: true });
    fireEvent.keyDown(input, { key: '?', code: 'Slash', shiftKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    input.blur();                                                         // outside it, Ctrl K is Ledge's again
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: 'modal', modal: { kind: 'search' } });
  });

  it('Ctrl + the key left of 1 takes the keyboard to the terminal, on AZERTY too', () => {
    const toTerminal = vi.fn(() => true);
    const dispatch = vi.fn();
    render(<Keys dispatch={dispatch} toTerminal={toTerminal} />);
    expect(fireEvent.keyDown(document.body, { key: '²', code: 'Backquote', ctrlKey: true })).toBe(false);   // default prevented
    expect(toTerminal).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true })).toBe(false);
    expect(toTerminal).toHaveBeenCalledTimes(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Ctrl + ² from the terminal goes back to the thread, or to the session page’s panel when Changes hides it', () => {
    const body = document.createElement('div');
    body.className = 'session-body'; body.tabIndex = -1;
    const thread = document.createElement('div');
    thread.setAttribute('data-thread-focus', ''); thread.tabIndex = -1;
    body.append(thread); document.body.append(body); onTestFinished(() => body.remove());
    focusThread();
    expect(thread).toHaveFocus();
    document.body.focus();
    thread.hidden = true;                                                 // the « Modifications » view
    focusThread();
    expect(body).toHaveFocus();
  });

  it('the shortcuts help names the key of the user\'s layout', async () => {
    (navigator as unknown as Record<string, unknown>).keyboard = { getLayoutMap: async () => new Map([['Backquote', '²']]) };
    onTestFinished(() => { delete (navigator as unknown as Record<string, unknown>).keyboard; });
    render(<LangProvider lang="fr"><ShortcutsHelp onClose={() => {}} /></LangProvider>);
    const key = await screen.findByText('Ctrl ²');
    expect(key.parentElement).toHaveTextContent('Basculer entre le fil et l’écran de l’agent, le clavier suit');
    expect(screen.queryByText('Ctrl `')).toBeNull();
  });
});

describe('IDE shortcuts (the ide option)', () => {
  function Probe(p: { ide?: { toggle(panel: 'side' | 'bottom' | 'right'): void; split?(): void }; dispatch?: (a: unknown) => void; modal?: boolean }) {
    const base = initialNav({ helpers: [], paused: false } as never);
    useKeys((p.dispatch ?? (() => {})) as never, { state: p.modal ? { ...base, modal: { kind: 'search' } } : base, order: [], screen: { current: null }, undo: () => false, ...(p.ide ? { ide: p.ide } : {}) } as never);
    return <div><textarea aria-label="champ" /><div data-terminal><button>term</button></div></div>;
  }
  const press = (key: string, el: Element | Window = window) => fireEvent.keyDown(el, { key, ctrlKey: true });

  it('Ctrl+B, Ctrl+J and Ctrl+/ toggle the panels', () => {
    const toggle = vi.fn(), dispatch = vi.fn();
    render(<Probe ide={{ toggle }} dispatch={dispatch} />);
    press('b'); press('J'); press('/');
    expect(toggle.mock.calls).toEqual([['side'], ['bottom'], ['right']]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('in a textarea Ctrl+B still toggles, but a bare / is typed', () => {
    const toggle = vi.fn(), dispatch = vi.fn();
    render(<Probe ide={{ toggle }} dispatch={dispatch} />);
    const field = screen.getByLabelText('champ'); field.focus();
    press('b');
    expect(toggle).toHaveBeenCalledWith('side');
    fireEvent.keyDown(field, { key: '/' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('while a dialog is open none of the three acts (no panel moves behind it)', () => {
    const toggle = vi.fn();
    render(<Probe ide={{ toggle }} modal />);
    press('b'); press('j'); press('/');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('under [data-terminal] none of the three acts', () => {
    const toggle = vi.fn();
    render(<Probe ide={{ toggle }} />);
    const b = screen.getByText('term'); b.focus();
    press('b'); press('j'); press('/');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('Ctrl+\\ splits, in a textarea too (as VS Code); not under [data-terminal], nor behind a dialog', () => {
    const toggle = vi.fn(), split = vi.fn(), dispatch = vi.fn();
    const { unmount } = render(<Probe ide={{ toggle, split }} dispatch={dispatch} />);
    press('\\');
    expect(split).toHaveBeenCalledTimes(1);
    const field = screen.getByLabelText('champ'); field.focus();
    press('\\', field);
    expect(split).toHaveBeenCalledTimes(2);
    screen.getByText('term').focus();
    press('\\');
    expect(split).toHaveBeenCalledTimes(2);
    expect(toggle).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    unmount();
    render(<Probe ide={{ toggle, split }} modal />);
    press('\\');
    expect(split).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+Alt+\\ does not split (a QWERTY chord of its own); AltGr+\\, which Windows reports as Ctrl+Alt, does', () => {
    const split = vi.fn();
    render(<Probe ide={{ toggle: vi.fn(), split }} />);
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true, altKey: true });
    expect(split).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(split).toHaveBeenCalledTimes(1);
  });

  it('without ide, Ctrl+B does nothing and Ctrl+/ opens the chat', () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    press('b');
    expect(dispatch).not.toHaveBeenCalled();
    press('/');
    expect(dispatch).toHaveBeenCalledWith({ type: 'chat', open: true });
  });
});

describe('the shortcuts help names the tab keys (lot 3 follow-up)', () => {
  const FR = [['Ctrl W', 'Fermer l’onglet, ou le groupe vide'], ['Ctrl ⇧ T', 'Rouvrir le dernier onglet fermé'], ['Ctrl Tab / Ctrl ⇧ Tab', 'Onglet suivant / précédent du groupe'],
    ['Ctrl Pg↓ / Pg↑', 'Onglet suivant / précédent du groupe'], ['Ctrl 1…9', 'Aller au groupe N, depuis un terminal aussi'], ['Ctrl ⇧ `', 'Sortir du terminal vers son onglet (← / → parcourent les onglets), ou y revenir'], ['Ctrl Alt ← / →', 'Déplacer l’onglet vers le groupe de gauche / de droite'], ['Ctrl \\', 'Diviser à droite'], ['Ctrl B', 'Afficher / masquer la barre latérale'], ['Ctrl J', 'Afficher / masquer le panneau du bas (terminaux)'], ['Ctrl /', 'Afficher / masquer le chat de Ledge']];
  it('? : an « Onglets et groupes » block after the others', () => {
    render(<LangProvider lang="fr"><ShortcutsHelp onClose={() => {}} /></LangProvider>);
    const head = screen.getByRole('heading', { name: 'Onglets et groupes' });
    const rows: string[][] = [];
    for (let el = head.nextElementSibling; el && el.tagName === 'DIV'; el = el.nextElementSibling) rows.push([el.querySelector('kbd')!.textContent!, el.querySelector('span')!.textContent!]);
    expect(rows).toEqual(FR);
  });
  it('Settings › Keyboard shortcuts: a « Tabs and groups » card', () => {
    const ctx = { island: null, dispatch: () => {} } as never;
    render(<LangProvider lang="en"><Shortcuts ctx={ctx} /></LangProvider>);
    const rows = [...screen.getByRole('region', { name: 'Tabs and groups' }).querySelectorAll('.set-row')].map(r => [r.querySelector('kbd')!.textContent, r.querySelector('.set-label')!.textContent]);
    expect(rows).toEqual([['Ctrl W', 'Close the tab, or the empty group'], ['Ctrl ⇧ T', 'Reopen the last closed tab'], ['Ctrl Tab / Ctrl ⇧ Tab', 'Next / previous tab of the group'],
      ['Ctrl PgDn / PgUp', 'Next / previous tab of the group'], ['Ctrl 1…9', 'Go to group N, from a terminal too'], ['Ctrl ⇧ `', 'Leave the terminal for its tab (← / → walk the tabs), or go back into it'], ['Ctrl Alt ← / →', 'Move the tab to the group on the left / right'], ['Ctrl \\', 'Split right'], ['Ctrl B', 'Show / hide the sidebar'], ['Ctrl J', 'Show / hide the bottom panel (terminals)'], ['Ctrl /', 'Show / hide Ledge’s chat']]);
  });
});

describe('IDE tab shortcuts (lot 3 follow-up)', () => {
  type Tabs = { toggle(panel: 'side' | 'bottom' | 'right'): void; closeTab?(): void; reopenTab?(): void; cycleTab?(step: 1 | -1): void; focusGroup?(n: number): void; moveTab?(step: 1 | -1): void };
  function Probe(p: { ide?: Tabs; dispatch?: (a: unknown) => void; modal?: boolean }) {
    const base = initialNav({ helpers: [], paused: false } as never);
    useKeys((p.dispatch ?? (() => {})) as never, { state: p.modal ? { ...base, modal: { kind: 'search' } } : base, order: [], screen: { current: null }, undo: () => false, ...(p.ide ? { ide: p.ide } : {}) } as never);
    return <div><textarea aria-label="champ" /><div data-terminal><button>term</button></div></div>;
  }
  const make = () => ({ toggle: vi.fn(), closeTab: vi.fn(), reopenTab: vi.fn(), cycleTab: vi.fn(), focusGroup: vi.fn(), moveTab: vi.fn() });
  const key = (init: KeyboardEventInit, el: Element | Window = window) => fireEvent.keyDown(el, init);
  /** Every chord of the block, in order. */
  const all = (el: Element | Window = window) => {
    key({ key: 'w', ctrlKey: true }, el);
    key({ key: 'T', ctrlKey: true, shiftKey: true }, el);
    key({ key: 'Tab', ctrlKey: true }, el);
    key({ key: 'Tab', ctrlKey: true, shiftKey: true }, el);
    key({ key: 'PageDown', ctrlKey: true }, el);
    key({ key: 'PageUp', ctrlKey: true }, el);
    key({ key: '&', code: 'Digit1', ctrlKey: true }, el);
    key({ key: 'é', code: 'Digit2', ctrlKey: true }, el);
    key({ key: 'ArrowRight', ctrlKey: true, altKey: true }, el);
    key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }, el);
  };

  it('Ctrl Shift ² outside a terminal goes back into the front tab\'s one, never the thread flip; it waits behind a dialog', () => {
    const enterTerminal = vi.fn(() => true);
    const toTerminal = vi.fn(() => true);
    function Enter(p: { modal?: boolean }) {
      const base = initialNav({ helpers: [], paused: false } as never);
      useKeys((() => {}) as never, { state: p.modal ? { ...base, modal: { kind: 'search' } } : base, order: [], screen: { current: null }, undo: () => false, toTerminal, ide: { ...make(), enterTerminal } } as never);
      return null;
    }
    const { rerender } = render(<Enter />);
    expect(fireEvent.keyDown(window, { key: '³', code: 'Backquote', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(enterTerminal).toHaveBeenCalledTimes(1);
    expect(toTerminal).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '²', code: 'Backquote', ctrlKey: true });
    expect(toTerminal).toHaveBeenCalledTimes(1);
    rerender(<Enter modal />);
    fireEvent.keyDown(window, { key: '³', code: 'Backquote', ctrlKey: true, shiftKey: true });
    expect(enterTerminal).toHaveBeenCalledTimes(1);
  });

  it('focusFrontTab: the keyboard on the front tab of the terminal\'s group, else of the active group; false without a tab', () => {
    render(<div>
      <div className="dv-groupview dv-active-group"><div className="dv-tab dv-active-tab" tabIndex={0}>A</div></div>
      <div className="dv-groupview"><div className="dv-tab" tabIndex={-1}>B1</div><div className="dv-tab dv-active-tab" tabIndex={0}>B2</div><div data-terminal><textarea aria-label="xterm" /></div></div>
      <div className="dv-groupview"><div data-terminal><textarea aria-label="vide" /></div></div>
    </div>);
    expect(focusFrontTab(screen.getByLabelText('xterm'))).toBe(true);
    expect(document.activeElement).toHaveTextContent('B2');
    expect(focusFrontTab()).toBe(true);
    expect(document.activeElement).toHaveTextContent('A');
    expect(focusFrontTab(screen.getByLabelText('vide'))).toBe(false);
  });

  it('each chord calls its callback (Ctrl or ⌘; Ctrl+digit by its place, so AZERTY too); Ctrl+W is always prevented', () => {
    const ide = make();
    render(<Probe ide={ide} />);
    all();
    expect(ide.closeTab).toHaveBeenCalledTimes(1);
    expect(ide.reopenTab).toHaveBeenCalledTimes(1);
    expect(ide.cycleTab.mock.calls).toEqual([[1], [-1], [1], [-1]]);
    expect(ide.focusGroup.mock.calls).toEqual([[1], [2]]);
    expect(ide.moveTab.mock.calls).toEqual([[1], [-1]]);
    key({ key: 'w', metaKey: true });
    expect(ide.closeTab).toHaveBeenCalledTimes(2);
    const ev = createEvent.keyDown(window, { key: 'w', ctrlKey: true });
    fireEvent(window, ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('they act in the reply\'s textarea too, as VS Code', () => {
    const ide = make();
    render(<Probe ide={ide} />);
    const field = screen.getByLabelText('champ'); field.focus();
    all(field);
    expect(ide.closeTab).toHaveBeenCalledTimes(1);
    expect(ide.cycleTab).toHaveBeenCalledTimes(4);
    expect(ide.moveTab).toHaveBeenCalledTimes(2);
  });

  it('inside [data-terminal] none acts, and Ctrl+W is left to the shell', () => {
    const ide = make();
    render(<Probe ide={ide} />);
    const b = screen.getByText('term'); b.focus();
    all(b);
    const ev = createEvent.keyDown(b, { key: 'w', ctrlKey: true });
    fireEvent(b, ev);
    expect(ev.defaultPrevented).toBe(false);
    for (const f of [ide.closeTab, ide.reopenTab, ide.cycleTab, ide.focusGroup, ide.moveTab]) expect(f).not.toHaveBeenCalled();
  });

  it('with a dialog open none acts (Ctrl+W still prevented: the window must not close)', () => {
    const ide = make();
    render(<Probe ide={ide} modal />);
    all();
    for (const f of [ide.closeTab, ide.reopenTab, ide.cycleTab, ide.focusGroup, ide.moveTab]) expect(f).not.toHaveBeenCalled();
    const ev = createEvent.keyDown(window, { key: 'w', ctrlKey: true });
    fireEvent(window, ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('with a dialog open only Ctrl+W is prevented: the other chords reach the dialog', () => {
    const ide = make();
    render(<Probe ide={ide} modal />);
    for (const init of [{ key: 'Tab', ctrlKey: true }, { key: 'T', ctrlKey: true, shiftKey: true }, { key: 'PageDown', ctrlKey: true }, { key: '&', code: 'Digit1', ctrlKey: true }, { key: 'ArrowRight', ctrlKey: true, altKey: true }]) {
      const ev = createEvent.keyDown(window, init);
      fireEvent(window, ev);
      expect(ev.defaultPrevented, init.key).toBe(false);
    }
  });

  it('Ctrl+Shift+W is prevented (Chromium closes the window on it) and acts on nothing', () => {
    const ide = make();
    render(<Probe ide={ide} />);
    const ev = createEvent.keyDown(window, { key: 'W', ctrlKey: true, shiftKey: true });
    fireEvent(window, ev);
    expect(ev.defaultPrevented).toBe(true);
    for (const f of [ide.closeTab, ide.reopenTab, ide.cycleTab, ide.focusGroup, ide.moveTab]) expect(f).not.toHaveBeenCalled();
  });

  it('without ide: nothing called, Ctrl+W and Ctrl+Tab not prevented', () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    for (const init of [{ key: 'w', ctrlKey: true }, { key: 'Tab', ctrlKey: true }]) {
      const ev = createEvent.keyDown(window, init);
      fireEvent(window, ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Ctrl+Alt+→ through AltGr does nothing; Shift+Tab alone is not taken; Alt+1 still opens agent 1', () => {
    const ide = make(), dispatch = vi.fn();
    render(<Probe ide={ide} dispatch={dispatch} />);
    key({ key: 'ArrowRight', ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(ide.moveTab).not.toHaveBeenCalled();
    const ev = createEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    fireEvent(window, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(ide.cycleTab).not.toHaveBeenCalled();
    key({ key: '1', code: 'Digit1', altKey: true });
    expect(ide.focusGroup).not.toHaveBeenCalled();
  });
});

describe('N on a session page (the ide option, lot 2)', () => {
  function Session({ ide, dispatch, toTerminal }: { ide?: boolean; dispatch: (a: unknown) => void; toTerminal?: () => boolean }) {
    const base = initialNav({ helpers: [], paused: false } as never);
    useKeys(dispatch as never, { state: { ...base, place: { kind: 'session', id: 'otto', view: 'atelier', project: 'all' } }, order: [], screen: { current: null }, undo: () => false, ...(toTerminal ? { toTerminal } : {}), ...(ide ? { ide: { toggle: () => {}, newSessionAnywhere: true as const } } : {}) } as never);
    return <div><textarea aria-label="champ" /><div data-terminal><button>term</button></div></div>;
  }

  it('with ide, N opens the launch dialog on a session place; without, nothing', () => {
    const dispatch = vi.fn();
    const { unmount } = render(<Session ide dispatch={dispatch} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'modal', modal: { kind: 'launch' } });
    unmount();
    const off = vi.fn();
    render(<Session dispatch={off} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(off).not.toHaveBeenCalled();
  });

  it('with ide, N typed in a textarea does nothing', () => {
    const dispatch = vi.fn();
    render(<Session ide dispatch={dispatch} />);
    const field = screen.getByLabelText('champ'); field.focus();
    fireEvent.keyDown(field, { key: 'n' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Review Focus 3: under [data-terminal], N, Y and Ctrl+` neither dispatch nor reach toTerminal', () => {
    const dispatch = vi.fn(), toTerminal = vi.fn(() => true);
    render(<Session ide dispatch={dispatch} toTerminal={toTerminal} />);
    const b = screen.getByText('term'); b.focus();
    fireEvent.keyDown(b, { key: 'n', code: 'KeyN' });
    fireEvent.keyDown(b, { key: 'y', code: 'KeyY' });
    fireEvent.keyDown(b, { key: '`', code: 'Backquote', ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(toTerminal).not.toHaveBeenCalled();
  });
});

describe('N in the IDE (lot 4, Review Focus 3)', () => {
  const daemons: Awaited<ReturnType<typeof createMockDaemon>>[] = [];
  afterEach(async () => { for (const d of daemons.splice(0)) await d.close(); });
  async function ideApp(pending: boolean) {
    localStorage.setItem('desktop.lang', 'fr');
   
    const d = await createMockDaemon(); daemons.push(d);
    d.machines([{ id: 'local', label: 'Local' }]);
    d.projects(TWO_PROJECTS);
    d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: pending ? 'waiting_permission' : 'working',
      ...(pending ? { pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } } : {}) }));
    d.thread('otto', []);
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
    await user_open(side);
    return { d, user: userEvent.setup() };
  }
  async function user_open(side: ReturnType<typeof within>) {
    await userEvent.click(await side.findByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(document.querySelector('.session-reply, .session-page')).not.toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
  }
  const decides = (d: Awaited<ReturnType<typeof createMockDaemon>>) => d.received.filter(m => m.type === 'session.decide');

  it('the active session waits on a permission: N denies, the modal stays closed', async () => {
    const { d, user } = await ideApp(true);
    await user.keyboard('n');
    await waitFor(() => expect(decides(d)).toHaveLength(1));
    expect(decides(d)[0]).toMatchObject({ id: 'otto', decision: 'deny' });
    expect(screen.queryByRole('dialog', { name: 'Nouvelle session' })).toBeNull();
  });

  it('no permission: N opens the modal, and an N typed in its « Premier message » is a letter', async () => {
    const { d, user } = await ideApp(false);
    await user.keyboard('n');
    const form = within(await screen.findByRole('dialog', { name: 'Nouvelle session' }));
    const field = form.getByRole('textbox', { name: 'Premier message' });
    await user.click(field);
    await user.keyboard('nnn');
    expect(field).toHaveValue('nnn');
    expect(screen.getByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
    expect(decides(d)).toHaveLength(0);
  });
});
