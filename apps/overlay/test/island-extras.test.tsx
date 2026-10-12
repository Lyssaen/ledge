import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnreadSay } from '../src/surface/UnreadSay';
import { Coachmark } from '../src/keyboard/Coachmark';
import { Bubble } from '../src/surface/Bubble';
import { SIZES } from '../src/surface/geometry';
import { fakeSession } from './mockDaemon';

describe('under the island', () => {
  it('the unread say hangs under its speaker: tail on top, square top-left corner, slides down into place', () => {
    const { rerender } = render(<UnreadSay visible={false} top={42} left={900} text="Hey!" kind="ledge" onOpen={() => {}} />);
    const say = screen.getByText('Hey!');
    expect(say).toHaveStyle({ left: '900px', top: '42px', borderRadius: '4px 14px 14px 14px', transform: 'translateY(-4px)' });
    const tail = say.querySelector<HTMLElement>('[data-tail]')!;
    expect(tail).toHaveStyle({ top: '-4px', transform: 'rotate(40deg)' });
    expect(tail.style.bottom).toBe('');
    rerender(<UnreadSay visible top={42} left={900} text="Hey!" kind="ledge" onOpen={() => {}} />);
    expect(say).toHaveStyle({ transform: 'translateY(0px)' });
  });
  it('the coachmark takes a left, centred under the panel by the surface', () => {
    render(<Coachmark visible top={10} left={120} onDismiss={() => {}} />);
    expect(document.querySelector('[data-coachmark]')).toHaveStyle({ left: '120px', top: '10px' });
  });
  it('the bubble is 440 px wide and drops in from the island instead of sliding sideways', () => {
    const session = fakeSession('s1', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Run tests?', source: 'hook' } });
    const { rerender } = render(<Bubble session={session as never} moreCount={0} visible={false} paused={false} onOpen={() => {}} onDismiss={() => {}} onDecide={vi.fn()} onReply={vi.fn()} />);
    const bubble = document.querySelector('[data-layer="bubble"]')!;
    expect(SIZES.bubbleW).toBe(440);
    expect(bubble).toHaveStyle({ width: '440px', transform: 'translateY(-8px)' });
    rerender(<Bubble session={session as never} moreCount={0} visible paused={false} onOpen={() => {}} onDismiss={() => {}} onDecide={vi.fn()} onReply={vi.fn()} />);
    expect(bubble).toHaveStyle({ transform: 'translateY(0px)' });
    expect(bubble.querySelector('svg.bot')).toHaveStyle({ '--bot-size': '40px' });
  });
});
