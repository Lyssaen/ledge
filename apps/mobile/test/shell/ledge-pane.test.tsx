// The tablet's Ledge pane (docs/mockups/ledge-mobile-refonte/m3-chat.html §7, Q36): the rail's button opens and closes a pane on
// the right over any tab, only its buttons and Échap close it, the device keeps its state, and the tablet has no Ledge page.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { copy } from '../../src/copy';
import { forgetPaneScroll } from '../../src/shell/LedgePane';
import { forgetTabs } from '../../src/shell/tabs';
import { LEDGE_PANE_KEY, forgetLedgePane } from '../../src/state/ledgePane';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { meStub } from '../screens/app-setup';
import { setup } from '../screens/setup';

const ON = { confirm: true, chat: true as const };
const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on && !q.includes('pointer'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };

afterEach(() => { wide(false); forgetLedgePane(); forgetPaneScroll(); forgetTabs(); });

function tablet(hash: string, device: { confirm: boolean; chat?: true } = ON, t = setup()) {
  globalThis.history.replaceState(null, '', `/${hash}`);
  t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'WSL', undefined, device));
  wide(true);
  const r = render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
  return { ...t, ...r };
}
const ledge = () => within(screen.getByRole('navigation', { name: copy.nav.label })).getByRole('button', { name: copy.nav.chat });
const pane = () => screen.queryByRole('complementary', { name: copy.chat.title });

describe('the Ledge pane on a tablet', () => {
  it('opens over the tab from the rail, the tab still lit, and closes from the rail', () => {
    tablet('#/sessions');
    expect(pane()).toBeNull();
    fireEvent.click(ledge());
    expect(ledge()).toHaveAttribute('aria-pressed', 'true');
    expect(within(pane()!).getByLabelText(copy.chat.field)).toBeInTheDocument();
    // The tab stays: its list, and its button lit.
    expect(screen.getByRole('link', { name: copy.nav.sessions })).toHaveAttribute('aria-current', 'page');
    expect(globalThis.location.hash).toBe('#/sessions');
    fireEvent.click(ledge());
    expect(pane()).toBeNull();
    expect(ledge()).toHaveAttribute('aria-pressed', 'false');
  });

  it('has the phone\'s head without the host nor Réglages, and its « Fermer le volet » closes it', () => {
    tablet('#/');
    fireEvent.click(ledge());
    const p = pane()!;
    expect(within(p).getByRole('heading', { name: copy.chat.title })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: copy.chat.reset })).toBeInTheDocument();
    expect(within(p).queryByRole('link', { name: copy.nav.settings })).toBeNull();
    fireEvent.click(within(p).getByRole('button', { name: copy.chat.pane.close }));
    expect(pane()).toBeNull();
  });

  it('stays open on a tap outside it and when the tab changes; Échap closes it, even from its field', () => {
    tablet('#/');
    fireEvent.click(ledge());
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(pane()).not.toBeNull();
    act(() => { globalThis.location.hash = '#/rigs'; globalThis.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(pane()).not.toBeNull();
    fireEvent.keyDown(within(pane()!).getByLabelText(copy.chat.field), { key: 'Escape' });
    expect(pane()).toBeNull();
  });

  it('is kept on the device: open after a reload, closed once closed', () => {
    const t = tablet('#/');
    fireEvent.click(ledge());
    expect(t.storage.getItem(LEDGE_PANE_KEY)).toBe('open');
    t.unmount();
    forgetLedgePane();
    const again = tablet('#/', ON, t);
    expect(pane()).not.toBeNull();
    fireEvent.click(ledge());
    expect(t.storage.getItem(LEDGE_PANE_KEY)).toBe('closed');
    again.unmount();
    forgetLedgePane();
    tablet('#/', ON, t);
    expect(pane()).toBeNull();
  });

  it('has no Ledge page: #/chat opens the pane over the tab left last', () => {
    const t = tablet('#/sessions');
    act(() => { globalThis.location.hash = '#/chat'; globalThis.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(globalThis.location.hash).toBe('#/sessions');
    expect(pane()).not.toBeNull();
    expect(t.storage.getItem(LEDGE_PANE_KEY)).toBe('open');
  });

  it('says in the pane that a PC without the chat does not offer it, with no field', () => {
    tablet('#/', { confirm: true });
    fireEvent.click(ledge());
    const p = pane()!;
    expect(within(p).getByRole('heading', { name: copy.chat.unavailable.title('WSL') })).toBeInTheDocument();
    expect(within(p).queryByLabelText(copy.chat.field)).toBeNull();
    fireEvent.click(within(p).getByRole('button', { name: copy.chat.pane.close }));
    expect(pane()).toBeNull();
  });

  it('keeps its scroll when closed and opened again', () => {
    tablet('#/');
    fireEvent.click(ledge());
    const main = pane()!.querySelector('main')!;
    main.scrollTop = 120;
    fireEvent.scroll(main);
    fireEvent.click(ledge());
    fireEvent.click(ledge());
    expect(pane()!.querySelector('main')!.scrollTop).toBe(120);
  });
});

describe('the Ledge tab on a phone', () => {
  it('stays a page with its link in the tab bar', () => {
    globalThis.history.replaceState(null, '', '/#/chat');
    const t = setup();
    t.deliver(snapshot([session('a')], 'WSL', undefined, ON));
    render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
    expect(screen.getByRole('link', { name: copy.nav.chat })).toHaveAttribute('aria-current', 'page');
    expect(pane()).toBeNull();
    expect(screen.getByLabelText(copy.chat.field)).toBeInTheDocument();
    expect(globalThis.location.hash).toBe('#/chat');
  });
});
