import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, declarations, DEFAULT_SESSIONS } from './helpers';
import { saveReduced } from '../src/motionPreferences';
import { fr } from '../src/i18n/fr';

beforeEach(() => localStorage.clear());
afterEach(async () => { vi.useRealTimers(); delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; cleanup(); vi.unstubAllEnvs(); saveReduced(false); await closeDaemons(); });

describe('the atelier', () => {
  it("Ledge's desk, a table per project with agents, and Sans projet", async () => {
    await boot();
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 3 agents.");
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Payment Service Platform Migration Europe table' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Docs table' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Kit,/ })).toBeVisible();
    expect(screen.queryByText('This screen is coming soon.')).toBeNull();
  });
  it("Ledge's desk toggles the chat", async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Talk to Ledge' }));
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm listening.");
  });
  it("no agent at all: only Ledge's desk", async () => {
    await boot({ sessions: [] });
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 0 agents.");
    expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
  });
  it('a filter shows its table; a project without agents proposes New session; No project shows the zone only', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    expect(screen.getAllByRole('region', { name: / table$/ }).map(r => r.getAttribute('aria-label'))).toEqual(['Ledge table']);
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
    await user.click(side.getByRole('button', { name: /^Docs/ }));
    expect(screen.getByRole('heading', { name: 'No agent at the Docs table' })).toBeVisible();
    await user.click(within(document.querySelector<HTMLElement>('.empty-project')!).getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: /^No project/ }));
    expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'No project' })).toBeVisible();
  });
  it('J / K walk the agents shown, Enter opens the chosen one', async () => {
    const { user } = await boot();
    await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveFocus();
    await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Nova,/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    await user.keyboard('k'); expect(screen.getByRole('button', { name: /^Kit,/ })).toHaveFocus();       // wraps
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
  });
  it("an offline machine's agent is greyed, its bot frozen, and it still opens", async () => {
    const { d, user } = await boot();
    d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working', offline: true }));
    const rio = await screen.findByRole('button', { name: /^Rio,/ });
    expect(rio).toHaveClass('seat-offline');
    expect(within(rio).getByText('Offline')).toBeVisible();
    await user.click(rio);
    expect(within(screen.getByRole('banner')).getByText('Rio')).toBeVisible();
  });
  it('freezing the animations pauses the atelier', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
    expect(document.querySelector('.office-shell')).toHaveClass('office-paused');
  });

  // Beyond the brief: the review ledger's carried items.
  it('the tables, the desk and the zone sit inside .office-shell (the label rules are scoped there); the legend outside', async () => {
    await boot();
    const shell = document.querySelector<HTMLElement>('.overview-scroll.atelier > .atelier-floor > .office-shell')!;
    expect(shell).not.toBeNull();
    for (const name of ['Ledge table', 'Payment Service Platform Migration Europe table', 'No project']) expect(shell).toContainElement(screen.getByRole('region', { name }));
    expect(shell).toContainElement(screen.getByRole('button', { name: 'Talk to Ledge' }));
    const panel = screen.getByRole('region', { name: 'Atelier' });
    expect(panel).toHaveAttribute('id', 'view-panel-atelier');
    const legend = document.querySelector<HTMLElement>('.workspace-legend')!;
    expect(panel).toContainElement(legend);
    expect(shell).not.toContainElement(legend);
    expect(legend).toHaveTextContent('A small bot is a subagent.');
  });
  it("the app's own reduced-motion setting stills the atelier's plants, not only the OS one", async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');          // the suite forces reduced motion; look at the app setting alone
    await boot();
    const shell = document.querySelector('.office-shell')!;
    expect(shell).not.toHaveClass('office-reduced');
    expect(shell).not.toHaveClass('office-paused');
    saveReduced(true);
    await waitFor(() => expect(shell).toHaveClass('office-reduced'));
    expect(declarations('atelier.css', '.office-reduced .plants *')).toContain('animation:none!important');
  });
  it('a long agent or machine name never grows a seat: one line with an ellipsis, the full name in the label and the title', async () => {
    const long = 'Archibald-Maximilian-Theodore-the-Third';
    const { d } = await boot();
    d.upsert(fakeSession('arch', { name: long, cwd: '/w/ledge', state: 'working' }));
    const seat = await screen.findByRole('button', { name: new RegExp(`^${long},`) });
    expect(within(seat).getByText(long)).toHaveAttribute('title', long);
    const machine = seat.querySelector('.seat-machine')!;
    expect(machine.textContent).not.toBe('');
    expect(machine).toHaveAttribute('title', machine.textContent);
    for (const selector of ['.seat-name', '.office-shell .agent-seat .seat-machine']) {
      const rule = declarations('atelier.css', selector);
      for (const decl of ['overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) expect(rule).toContain(decl);
    }
    expect(declarations('atelier.css', '.office-shell .agent-seat .seat-machine')).toContain('max-width:100%');
    expect(declarations('atelier.css', '.seat-name')).toContain('min-width:0');
    // The name shrinks inside a row capped at the seat's width; the « Alt n » hint keeps its size.
    for (const decl of ['display:flex', 'max-width:100%']) expect(declarations('atelier.css', '.agent-seat>strong')).toContain(decl);
    expect(declarations('atelier.css', '.agent-seat .seat-shortcut')).toContain('flex-shrink:0');
  });
  it('the atelier view shows no scrollbars, but still scrolls so the floor can be panned (#49)', () => {
    const rule = declarations('atelier.css', '.overview-scroll.atelier');
    expect(rule).toContain('scrollbar-width:none');
    expect(declarations('atelier.css', '.overview-scroll.atelier::-webkit-scrollbar')).toContain('display:none');
    // Panning moves scrollLeft / scrollTop: only the fitted view clips its overflow.
    expect(rule).not.toContain('overflow:hidden');
    expect(declarations('atelier.css', '.overview-scroll.atelier:not(.fitted)')).not.toContain('overflow:hidden');
  });
  it('Enter on a focused button keeps its own action: the chosen agent is not opened', async () => {
    const { user } = await boot();
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    screen.getByRole('button', { name: 'Talk to Ledge' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(within(screen.getByRole('banner')).queryByText('Otto')).toBeNull();
  });
  it('Enter with the focus on the floor opens the chosen agent', async () => {
    const { user } = await boot();
    await user.keyboard('j');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  });
  it('J / K leave an open menu alone', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    const first = within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!;
    expect(first).toHaveFocus();
    await user.keyboard('k');
    expect(first).toHaveFocus();
    expect(document.querySelector('.keyboard-selected')).toBeNull();
  });
  it('the choice falls back to nothing when the agent leaves the walk', async () => {
    const { side, user } = await boot();
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    await user.click(side.getByRole('button', { name: /^Payment Service Platform/ }));     // Otto is no longer shown
    await user.click(side.getByRole('button', { name: /Atelier/ }));
    expect(screen.getByRole('button', { name: /^Otto,/ })).not.toHaveClass('keyboard-selected');
    expect(document.querySelector('.keyboard-selected')).toBeNull();
  });
  it('Sans projet: a card per agent with its task, machine and folder, its badge, and a click opens it', async () => {
    const { user } = await boot();
    const zone = screen.getByRole('region', { name: 'No project' });
    expect(zone).toHaveTextContent('Ledge links these sessions to no project.');
    const kit = within(zone).getByRole('button', { name: /^Kit,/ });
    expect(kit).toHaveClass('unassigned-open');
    expect(kit.dataset.agent).toMatch(/kit$/);           // the fleet's id for Kit
    expect(kit).toHaveTextContent('Alt 3');
    expect(kit.querySelector('code')).toHaveTextContent(/ · \/tmp$/);
    expect(within(zone).getByText('Question')).toHaveAttribute('data-badge', 'question');
    await user.click(kit);
    expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
  });
  it('the empty table names the folders of its repositories', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Docs/ }));
    expect(document.querySelector('.empty-project')).toHaveTextContent('The table will appear as soon as a session starts in docs.');
  });
  it('the overview is the atelier, with no List tab', async () => {
    await boot({ list: true });
    expect(screen.queryByRole('tab', { name: 'List' })).toBeNull();
    expect(document.querySelector('.list-view')).toBeNull();
    expect(document.querySelector('.office-shell')).not.toBeNull();
  });

  describe('messages between agents', () => {
    const rio = fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working' });
    const otto = DEFAULT_SESSIONS[0]!;
    /** Otto wrote to Rio `ago` ms ago (the sent item `sent-1` in Otto's thread). */
    const ottoWrote = (ago: number) => fakeSession('otto', { ...otto, lastMessage: { id: 'sent-1', to: 'Rio', peer: 'rio', summary: 'The tests pass', at: new Date(Date.now() - ago).toISOString() } });
    const bubble = () => screen.queryByRole('button', { name: 'Otto writes to Rio: The tests pass. Open the conversation' });
    const seat = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
    const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });

    it('a message sent 2 s ago shows a bubble over Otto naming Rio; at 6 s it is gone', async () => {
      const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      fake();
      d.upsert(ottoWrote(2000));
      await waitFor(() => expect(bubble()).not.toBeNull());
      expect(bubble()).toHaveTextContent('to Rio');
      expect(bubble()).toHaveTextContent('The tests pass');
      expect(document.querySelector('.office-shell > .exchange-layer')).toContainElement(bubble());
      expect(document.querySelector('.exchange-wire path')).not.toBeNull();       // the line to Rio's seat
      act(() => { vi.advanceTimersByTime(4000); });
      expect(bubble()).toBeNull();
      expect(document.querySelector('.exchange-wire')).toBeNull();
    });
    it('clicking the bubble opens Otto on the sent message', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { d, user } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      d.thread('otto', [{ kind: 'sent', id: 'sent-1', at: new Date().toISOString(), turn: 1, to: 'Rio', peer: 'rio', summary: 'The tests pass', text: 'All green.', status: 'delivered' }]);
      d.upsert(ottoWrote(1000));
      await user.click(await screen.findByRole('button', { name: /^Otto writes to Rio/ }));
      await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto'));
      await waitFor(() => expect(document.querySelector('.message-card.lit[data-message="sent-1"]')).not.toBeNull());
    });
    it('no seat carries a tag, whatever the message\'s age (#27)', async () => {
      const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      fake();
      d.upsert(ottoWrote(2000));
      await waitFor(() => expect(bubble()).not.toBeNull());
      expect(document.querySelector('.peer-tag')).toBeNull();
      expect(within(seat('Otto')).queryByTitle(/^Recent conversation/)).toBeNull();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(bubble()).toBeNull();
      expect(document.querySelector('.peer-tag')).toBeNull();
      expect(within(seat('Rio')).queryByTitle(/^Recent conversation/)).toBeNull();
      expect(declarations('atelier.css', '.peer-tag')).toBe('');
    });
    it('an idle atelier: a message arriving 11 min old shows no bubble', async () => {
      const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      fake();
      act(() => { vi.advanceTimersByTime(12 * 60_000); });                       // nothing changes for 12 min
      d.upsert(ottoWrote(11 * 60_000));
      await act(async () => { await new Promise(r => setTimeout(r, 200)); });     // the update lands
      expect(bubble()).toBeNull();
      expect(document.querySelector('.exchange-wire')).toBeNull();
    });
    for (const [ahead, label] of [[90_000, '90 s'], [20 * 60_000, '20 min']] as const) {
      it(`a message dated ${label} ahead of the clock shows on arrival, its bubble for 5 s`, async () => {
        const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
        fake();
        d.upsert(ottoWrote(-ahead));
        await waitFor(() => expect(bubble()).not.toBeNull());
        act(() => { vi.advanceTimersByTime(4900); });
        expect(bubble()).not.toBeNull();
        act(() => { vi.advanceTimersByTime(100); });
        expect(bubble()).toBeNull();
      });
    }
    it('reduced motion: the bubble shows without the travelling dot', async () => {
      const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });         // the suite forces reduced motion
      expect(document.querySelector('.office-shell')).toHaveClass('office-reduced');
      d.upsert(ottoWrote(500));
      await waitFor(() => expect(bubble()).not.toBeNull());
      expect(document.querySelector('.exchange-wire path')).not.toBeNull();
      expect(document.querySelector('.exchange-wire circle')).toBeNull();
      expect(document.querySelector('.exchange-envelope')).toBeNull();
      for (const sel of ['.office-reduced .exchange-bubble', '.office-paused .exchange-bubble']) expect(declarations('atelier.css', sel)).toContain('animation:none');
      for (const sel of ['.office-reduced .exchange-envelope', '.office-paused .exchange-envelope']) expect(declarations('atelier.css', sel)).toContain('display:none');
    });
    it('with motion, an envelope travels upright along the line from Otto\'s seat to Rio\'s, hidden from assistive technology (#27)', async () => {
      vi.stubEnv('VITE_LEDGE_MOTION', '1');
      const { d } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      d.upsert(ottoWrote(500));
      await waitFor(() => expect(document.querySelector('.exchange-envelope')).not.toBeNull());
      const envelope = document.querySelector<HTMLElement>('.exchange-envelope')!;
      expect(envelope).toHaveAttribute('aria-hidden', 'true');
      expect(envelope.style.offsetPath).toBe(`path('${document.querySelector('.exchange-wire path')!.getAttribute('d')}')`);
      expect(envelope.querySelector('svg .exchange-envelope-body')).not.toBeNull();
      expect(envelope.querySelector('svg .exchange-envelope-flap')).not.toBeNull();
      expect(document.querySelector('.exchange-wire circle')).toBeNull();          // the dot is gone
      const css = declarations('atelier.css', '.exchange-envelope');
      expect(css).toContain('offset-rotate:0deg');
      expect(css).toContain('width:26px');
      expect(css).toContain('1.3s');
      expect(declarations('atelier.css', '.exchange-envelope-body')).toContain('fill:var(--popover)');
      expect(declarations('atelier.css', '.exchange-envelope-body')).toContain('stroke:var(--foreground)');
    });
    it('paused, with motion: the bubble and the line stay, no envelope travels', async () => {
      vi.stubEnv('VITE_LEDGE_MOTION', '1');
      const { d, user } = await boot({ sessions: [...DEFAULT_SESSIONS, rio] });
      await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
      expect(document.querySelector('.office-shell')).toHaveClass('office-paused');
      d.upsert(ottoWrote(500));
      await waitFor(() => expect(bubble()).not.toBeNull());
      expect(document.querySelector('.exchange-wire path')).not.toBeNull();
      expect(document.querySelector('.exchange-envelope')).toBeNull();
    });
    it('French copy', () => {
      expect(fr.atelier.messageTo('Rio')).toBe('à Rio');
      expect(fr.atelier.messageLabel('Otto', 'Rio', 'Les tests passent')).toBe('Otto écrit à Rio : Les tests passent. Ouvrir l’échange');
      expect('peerTag' in fr.atelier).toBe(false);
    });
  });

  describe('project rooms', () => {
    it('a project room has one table with all its sessions, and no team heading', async () => {
      await boot({ sessions: [...DEFAULT_SESSIONS, fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working', ...{ team: 'team-a1b2', role: 'build' } })] });
      const room = document.querySelector<HTMLElement>('[data-room="ledge"]')!;
      expect(room.querySelectorAll('.atelier-table')).toHaveLength(1);
      expect(within(room).getByRole('button', { name: /^Rio,/ })).toBeVisible();
      expect(document.querySelector('.heading-team-line, .team-heading, .seat-role')).toBeNull();
      expect(within(room).getByText(/^\d+ sessions?$/)).toBeVisible();
    });
    it('the room menu offers « New session here » and no team entry', async () => {
      const { user } = await boot();
      await user.click(screen.getByRole('button', { name: 'Actions of the Ledge room' }));
      const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent);
      expect(items).toContain('New session here');
      expect(items.some(i => /team/i.test(i ?? ''))).toBe(false);
    });
  });
});
