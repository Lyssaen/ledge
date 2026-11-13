import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import type { InboxItem } from '../../src/model/requests';
import { LinkStrip, Rail, ShellProvider, TabBar, TabPage, hostName, lookOf, type ShellLink } from '../../src/shell/Shell';
import { atoiBadge, forgetTabs, remember, tabHref, tabOf } from '../../src/shell/tabs';

const link = (over: Partial<ShellLink> = {}): ShellLink => ({ pc: 'WSL', look: 'online', reach: 'pc_online', since: '14:02', retry: () => {}, ...over });
const items = (perm: number, ask: number) => [
  ...Array.from({ length: perm }, () => ({ filter: 'permission' }) as InboxItem),
  ...Array.from({ length: ask }, () => ({ filter: 'question' }) as InboxItem)
];

afterEach(() => forgetTabs());

describe('the shell (m0-socle.html)', () => {
  it('tells how the PC looks from the link', () => {
    expect(lookOf(true, true, 'pc_offline')).toBe('online');
    expect(lookOf(false, true, 'pc_offline')).toBe('offline');
    expect(lookOf(false, false, 'relay_unreachable')).toBe('offline');
    expect(lookOf(false, true, 'connecting')).toBe('reconnecting');
    expect(lookOf(false, false, 'connecting')).toBe('loading');
  });

  it('cuts a long PC name at 14 characters', () => {
    expect(hostName('WSL')).toBe('WSL');
    expect(hostName('DESKTOP-7H2K9QXLM')).toBe('DESKTOP-7H2K9…');
    expect(hostName('DESKTOP-7H2K9QXLM')).toHaveLength(14);
    expect(hostName(null)).toBe(copy.host.unknown);
  });

  it('badges À toi as Desktop: permissions in red, else questions in amber, 99+ past 99', () => {
    expect(atoiBadge([])).toBeNull();
    expect(atoiBadge(items(2, 3))).toEqual({ text: '2', tone: 'red' });
    expect(atoiBadge(items(0, 3))).toEqual({ text: '3', tone: 'amber' });
    expect(atoiBadge(items(120, 0))).toEqual({ text: '99+', tone: 'red' });
  });

  it('shows the five tabs in order, the one given lit, with its badge', () => {
    render(<TabBar route={{ name: 'atoi' }} active="atoi" badges={{ atoi: { text: '2', tone: 'red' } }} />);
    const nav = screen.getByRole('navigation', { name: copy.nav.label });
    const tabs = within(nav).getAllByRole('link');
    expect(tabs.map(t => t.textContent?.replace(/\d+$/, ''))).toEqual([copy.nav.atoi, copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.chat]);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');
    expect(within(tabs[0]!).getByText('2')).toHaveAttribute('data-badge', 'red');
    expect(tabs[1]).not.toHaveAttribute('aria-current');
  });

  it('leads each tab back to the screen it was left on', () => {
    expect(tabHref('sessions')).toBe('#/sessions');
    remember({ name: 'thread', sessionId: 's1' });
    expect(tabOf({ name: 'thread', sessionId: 's1' })).toBe('sessions');
    expect(tabHref('sessions')).toBe('#/thread/s1');
    expect(tabHref('atoi')).toBe('#/');
  });

  it('puts the Atelier in the rail only when the PC sends its projects, Ledge and Réglages at the bottom', () => {
    const closed = { open: false, onToggle: () => {} };
    const { rerender } = render(<Rail route={{ name: 'rigs' }} active="rigs" badges={{}} atelier={false} ledge={closed} />);
    const names = () => [...within(screen.getByRole('navigation')).getAllByRole('link'), screen.getByRole('button', { name: copy.nav.chat })]
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(a => a.textContent);
    expect(names()).toEqual([copy.nav.atoi, copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.chat, copy.nav.settings]);
    rerender(<Rail route={{ name: 'rigs' }} active="rigs" badges={{}} atelier ledge={closed} />);
    expect(names()).toEqual([copy.nav.atoi, copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.atelier, copy.nav.chat, copy.nav.settings]);
    expect(screen.getByRole('link', { name: copy.nav.rigs })).toHaveAttribute('aria-current', 'page');
  });

  it('makes Ledge a button in the rail that opens and closes its pane, pressed while open, the tab still lit (m3-chat.html §7)', () => {
    let toggled = 0;
    const { rerender } = render(<Rail route={{ name: 'sessions' }} active="sessions" badges={{}} atelier={false} ledge={{ open: false, onToggle: () => { toggled++; } }} />);
    const ledge = screen.getByRole('button', { name: copy.nav.chat });
    expect(ledge).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('link', { name: copy.nav.chat })).toBeNull();
    fireEvent.click(ledge);
    expect(toggled).toBe(1);
    rerender(<Rail route={{ name: 'sessions' }} active="sessions" badges={{}} atelier={false} ledge={{ open: true, onToggle: () => {} }} />);
    expect(ledge).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: copy.nav.sessions })).toHaveAttribute('aria-current', 'page');
  });

  it('shows no banner while the PC answers', () => {
    render(<ShellProvider value={link()}><LinkStrip /></ShellProvider>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the PC does not answer, since when, and retries at once', () => {
    let asked = 0;
    render(<ShellProvider value={link({ look: 'offline', reach: 'pc_offline', retry: () => { asked++; } })}><LinkStrip /></ShellProvider>);
    const strip = screen.getByRole('status');
    expect(strip).toHaveAttribute('data-strip', 'pc');
    expect(within(strip).getByText(copy.offline.title('WSL'))).toBeInTheDocument();
    expect(within(strip).getByText(copy.offline.body('14:02'))).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: copy.offline.retry }));
    expect(asked).toBe(1);
  });

  it('says the relay is out of reach when the phone cannot reach it', () => {
    render(<ShellProvider value={link({ look: 'offline', reach: 'relay_unreachable' })}><LinkStrip /></ShellProvider>);
    expect(screen.getByRole('status')).toHaveAttribute('data-strip', 'relay');
    expect(screen.getByText(copy.compare.relayTitle)).toBeInTheDocument();
  });

  it('outlines the content while the PC\'s first state comes', () => {
    const { container } = render(<ShellProvider value={link({ look: 'loading', reach: 'connecting' })}><TabPage title="À toi"><p>contenu</p></TabPage></ShellProvider>);
    expect(screen.getByText(copy.link.connecting('WSL'))).toBeInTheDocument();
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    expect(container.querySelector('[data-loading]')).not.toBeNull();
  });
});
