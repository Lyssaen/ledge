import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Bubble } from '../src/surface/Bubble';
import { fakeSession } from './mockDaemon';
import { LangProvider } from '../src/i18n/lang';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow'], source: 'hook' } });

describe('<Bubble>', () => {
  it('speaks in the bot name and offers Deny/Approve for a permission', () => {
    const onDecide = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={onDecide} onReply={() => {}} />);
    expect(screen.getByText('harness-assistant')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('accept');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
  it('offers the choices and a short answer for a question, and shows +N more', () => {
    const onReply = vi.fn();
    const onDismiss = vi.fn();
    render(<Bubble session={q} moreCount={2} visible paused={false} onOpen={() => {}} onDismiss={onDismiss} onDecide={() => {}} onReply={onReply} />);
    expect(document.querySelector('[data-ledge-sentence]')).toHaveTextContent('Pim asks you: Which strategy?');
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Later, next/ }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Backfill/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('Backfill');
  });
  it('Open in Ledge is a button, not the title', () => {
    const onOpen = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={onOpen} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.queryByRole('link', { name: /Otto wants to run/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open in Ledge/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('an ask has no timer; a notice drains for 6 s unless paused', () => {
    const { container, rerender } = render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toBeNull();
    rerender(<Bubble session={null} kind="offline" preview="Devbox" moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect((container.querySelector('[data-timer]') as HTMLElement).style.animation).toContain('ledge-drain 6000ms linear');
    rerender(<Bubble session={null} kind="offline" preview="Devbox" moreCount={0} visible paused onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
  });
  it('the bar drains the controller remainder, holds it while paused, and restarts per notice', () => {
    const base = { moreCount: 0, visible: true, kind: 'offline' as const, session: null, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble {...base} preview="Devbox" paused={false} remainingMs={6000} />);
    const bar = () => container.querySelector('[data-timer]') as HTMLElement;
    const first = bar();
    rerender(<Bubble {...base} preview="Devbox" paused remainingMs={2500} />);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    expect(parseFloat(bar().style.width)).toBeCloseTo((2500 / 6000) * 100, 5);
    expect(bar().style.animation).toBe('none');
    rerender(<Bubble {...base} preview="Devbox" paused={false} remainingMs={2500} />);
    expect(bar().style.animation).toContain('ledge-drain 2500ms linear');
    expect(parseFloat(bar().style.getPropertyValue('--ledge-from'))).toBeCloseTo((2500 / 6000) * 100, 5);
    const running = bar();
    rerender(<Bubble {...base} preview="Devbox" paused={false} remainingMs={1200} />);
    expect(bar()).toBe(running);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    rerender(<Bubble {...base} preview="Studio" paused={false} remainingMs={6000} />);
    expect(bar()).not.toBe(running);
    expect(bar()).not.toBe(first);
    expect(bar()).toHaveAttribute('data-remaining', '6000');
  });
  it('an acknowledgement locks the actions; a failure unlocks them and says why; no success is invented', () => {
    const base = { moreCount: 0, visible: true, paused: false, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { rerender } = render(<Bubble {...base} session={perm} ack="pending" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sent, waiting for the terminal');
    rerender(<Bubble {...base} session={perm} ack="failed" failure="nothing to decide" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('nothing to decide. Try again or open the session.');
    expect(screen.queryByText('Received')).toBeNull();
  });
  it('offline or read-only: both actions are disabled and the reason shows', () => {
    const onDecide = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} blocked="Offline: reconnecting to the daemon" frozen onOpen={() => {}} onDecide={onDecide} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(screen.getByText('Offline: reconnecting to the daemon')).toBeInTheDocument();
  });
  it('blocked: a question can be set aside, and its answer stays disabled', () => {
    const onDismiss = vi.fn();
    render(<Bubble session={q} moreCount={0} visible paused={false} blocked="Read only: started without Ledge, answer in its terminal" onOpen={() => {}} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Later/ }));
    expect(onDismiss).toHaveBeenCalled();
  });
  it('is inert when hidden and re-arms the buttons for a new session', () => {
    const props = { moreCount: 0, paused: false, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble session={perm} visible={false} {...props} />);
    expect(container.firstChild).toHaveAttribute('inert');
    rerender(<Bubble session={perm} visible {...props} />);
    expect(container.firstChild).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    rerender(<Bubble session={fakeSession('c', { state: 'waiting_permission', pending: { kind: 'permission', text: 'ls', tool: 'Bash', source: 'hook' } })} visible {...props} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
  it('a machine that dropped is the one notice left: Ledge says it, with OK and Open', () => {
    const onOpen = vi.fn(); const onDismiss = vi.fn();
    render(<Bubble session={null} kind="offline" preview="Devbox" moreCount={0} visible paused={false} onOpen={onOpen} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('Devbox')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting on its own')).toBeInTheDocument();
    expect(document.querySelector('svg.resident')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('a permission heading reads as Ledge\'s sentence with the session name in bold', () => {
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    const sentence = document.querySelector('[data-ledge-sentence]')!;
    expect(sentence).toHaveTextContent('Otto wants to run npm test');
    expect(sentence.querySelector('b')).toHaveTextContent('Otto');
    expect(sentence.querySelector('code')).toHaveTextContent('npm test');
    expect(document.querySelector('[data-layer="bubble"] [data-ledge-mark]')).toHaveAttribute('data-pending', 'permission');
    expect(document.querySelector('[data-layer="bubble"] svg.bot')).toBeNull();
    expect(screen.queryByText('Otto needs your approval')).toBeNull();
  });
  it('a point notice shows Plus tard and Voir le point', () => {
    const onLater = vi.fn(); const onSeePoint = vi.fn();
    const notice = { id: 'point:p1', kind: 'point' as const, qid: 'p1', text: 'Deux choses pour toi : **pilot-lead** attend ta décision sur #309, et **Rex** a fini.', priority: 'routine' as const, at: '2026-11-13T14:32:00.000Z' };
    render(<LangProvider lang="fr"><Bubble session={null} kind="operator" notice={notice} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} onLater={onLater} onSeePoint={onSeePoint} /></LangProvider>);
    const sentence = document.querySelector('[data-ledge-sentence]')!;
    expect(sentence).toHaveTextContent('Deux choses pour toi : pilot-lead attend ta décision sur #309, et Rex a fini.');
    expect(sentence.querySelectorAll('strong, b')).toHaveLength(2);
    expect(document.querySelector('[data-timer]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onLater).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Voir le point' }));
    expect(onSeePoint).toHaveBeenCalled();
  });
  it('a rig ask notice names the seat and its rig, quotes the question and offers its options', () => {
    const onOption = vi.fn();
    const notice = { id: 'rig.ask:q9', kind: 'rig.ask' as const, text: 'Fusionner #309 maintenant ?', who: 'pilot-lead', rig: 'ledge-dev', qitem: 'q9', options: [{ id: 'merge', label: 'Fusionner' }, { id: 'wait', label: 'Attendre qa' }], priority: 'urgent' as const, at: '2026-11-13T14:32:00.000Z' };
    render(<LangProvider lang="fr"><Bubble session={null} kind="operator" notice={notice} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} onOption={onOption} /></LangProvider>);
    expect(document.querySelector('[data-ledge-sentence]')).toHaveTextContent('pilot-lead · ledge-dev : « Fusionner #309 maintenant ? »');
    const buttons = [...document.querySelectorAll('[data-actions] button')].map(b => b.textContent);
    expect(buttons).toEqual(['Attendre qa', 'Fusionner']);
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    expect(onOption).toHaveBeenCalledWith('merge');
  });
  it('a diff card keeps its stat under the sentence', () => {
    const diff = fakeSession('d', { name: 'Rex', state: 'waiting_permission', pending: { kind: 'diff', text: 'src/app.ts +12 -3', source: 'hook' } });
    render(<Bubble session={diff} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(document.querySelector('[data-ledge-sentence]')).toHaveTextContent('Rex has changes for you to review');
    expect(screen.getByText('src/app.ts +12 -3 · harness-assistant')).toBeInTheDocument();
  });
});
