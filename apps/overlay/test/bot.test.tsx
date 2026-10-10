import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { fakeSession } from './mockDaemon';
import { botState, poseFor, type BotState } from '../src/bots/poseFor';
import { materialFor } from '../src/bots/material';
import { Bot } from '../src/bots/Bot';

describe('botState and materialFor', () => {
  it('maps daemon states to bot expressions', () => {
    expect(botState(fakeSession('a', { state: 'starting' }))).toBe('starting');
    expect(botState(fakeSession('a', { state: 'idle' }))).toBe('idle');
    expect(botState(fakeSession('a', { state: 'working' }))).toBe('working');
    expect(botState(fakeSession('a', { state: 'waiting_permission' }))).toBe('approval');
    expect(botState(fakeSession('a', { state: 'waiting_input' }))).toBe('question');
    expect(botState(fakeSession('a', { state: 'exited', exitCode: 2 }))).toBe('done');
    expect(botState(fakeSession('a', { state: 'error' }))).toBe('error');
    expect(botState(fakeSession('a', { state: 'working', source: 'hook_only', tmuxSession: null }))).toBe('working');
    expect(materialFor('dark')).toBe('signal');
    expect(materialFor('light')).toBe('pebble');
  });

  it('derives a deterministic pose from the stable id and state', () => {
    expect(poseFor('session-a', 'waiting_permission')).toBe(poseFor('session-a', 'waiting_permission'));
    for (const id of ['a', 'b', 'c', 'session-a', 'x:helper-1']) expect([1, 2, 3]).toContain(poseFor(id, 'working'));
    const poses = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => poseFor(id, 'waiting_input')));
    expect(poses.size).toBeGreaterThan(1);
  });
});

describe('Bot', () => {
  afterEach(cleanup);
  const props = { tool: 'claude' as const, state: 'idle' as const, pose: 1 as const, size: 32, seed: 'session-a' };

  it('follows the theme with one persistent svg', () => {
    const { container, rerender } = render(<Bot {...props} theme="dark" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('data-material', 'signal');
    const groups = ['.pose', '.gaze', '.eye-blink', '.arm', '.shell'].map(s => container.querySelector(s));
    rerender(<Bot {...props} theme="light" />);
    expect(container.querySelector('svg')).toBe(svg);
    expect(svg).toHaveAttribute('data-material', 'pebble');
    expect(svg).toHaveAttribute('data-state', 'idle');
    ['.pose', '.gaze', '.eye-blink', '.arm', '.shell'].forEach((s, i) => expect(container.querySelector(s)).toBe(groups[i]));
  });

  it('keeps every layer mounted across a state change', () => {
    const { container, rerender } = render(<Bot {...props} theme="dark" />);
    const layers = ['.pose', '.gaze', '.eye-open', '.eye-happy', '.eye-error', '.eye-sleep', '.arm'].map(s => container.querySelector(s));
    rerender(<Bot {...props} state="approval" theme="dark" />);
    ['.pose', '.gaze', '.eye-open', '.eye-happy', '.eye-error', '.eye-sleep', '.arm'].forEach((s, i) => expect(container.querySelector(s)).toBe(layers[i]));
  });

  it('draws a distinct silhouette per tool', () => {
    const shell = (tool: 'claude' | 'codex' | 'cursor') => {
      const { container } = render(<Bot {...props} tool={tool} theme="dark" />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('data-tool', tool);
      return svg.querySelector('.shell')!.tagName.toLowerCase();
    };
    expect(shell('claude')).toBe('rect');
    expect(shell('codex')).toBe('ellipse');
    expect(shell('cursor')).toBe('path');
  });

  it('gives each of the seven semantic states its own expression and eye token', () => {
    const states: BotState[] = ['starting', 'working', 'approval', 'question', 'idle', 'error', 'done'];
    const seen = states.map(state => {
      const { container } = render(<Bot {...props} state={state} theme="dark" />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('data-state', state);
      expect(svg.style.getPropertyValue('--bot-eye')).toBe(`var(--bot-eye-${state})`);
      return { state, eyes: svg.getAttribute('data-eyes'), label: svg.getAttribute('aria-label') };
    });
    expect(Object.fromEntries(seen.map(s => [s.state, s.eyes]))).toEqual({
      starting: 'open', working: 'open', approval: 'open', question: 'wide', idle: 'happy', error: 'error', done: 'sleep'
    });
    expect(new Set(seen.map(s => s.label)).size).toBe(7);
  });

  it('shows a smile when idle and closed eyes when done, on different layers', () => {
    const { container } = render(<Bot {...props} theme="dark" />);
    const smile = container.querySelector('.eye-happy')!.getAttribute('d');
    const closed = container.querySelector('.eye-sleep')!.getAttribute('d');
    expect(smile).toBeTruthy();
    expect(closed).toBeTruthy();
    expect(smile).not.toBe(closed);
    const { container: done } = render(<Bot {...props} state="done" theme="dark" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-eyes', 'happy');
    expect(done.querySelector('svg')).toHaveAttribute('data-eyes', 'sleep');
  });

  it('tilts approval and question poses by the given pose variant', () => {
    const tilt = (state: BotState, pose: 1 | 2 | 3) => {
      const { container } = render(<Bot {...props} state={state} pose={pose} theme="dark" />);
      return container.querySelector('svg')!.style.getPropertyValue('--bot-tilt');
    };
    expect(tilt('approval', 1)).not.toBe(tilt('approval', 2));
    expect(tilt('question', 1)).not.toBe(tilt('question', 3));
    expect(tilt('working', 1)).toBe('0deg');
  });

  it('uses unique gradient ids per instance', () => {
    const { container } = render(<><Bot {...props} theme="dark" /><Bot {...props} theme="dark" seed="session-b" /></>);
    const ids = [...container.querySelectorAll('linearGradient')].map(g => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const shells = [...container.querySelectorAll('.shell')];
    shells.forEach((s, i) => expect(s.getAttribute('fill')).toBe(`url(#${ids[i]})`));
  });

  it('crops a 12 px avatar to the head', () => {
    const { container } = render(<Bot {...props} size={12} theme="dark" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-simplified', 'true');
    expect(svg).toHaveAttribute('viewBox', '12 16 72 68');
    expect(svg).toHaveAttribute('width', '12');
  });

  it('keeps the detailed figure at 48 px', () => {
    const { container } = render(<Bot {...props} size={48} theme="light" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-simplified', 'false');
    expect(svg).toHaveAttribute('viewBox', '0 0 96 96');
    for (const layer of ['.feet', '.antenna', '.arm', '.ground', '.shine']) expect(svg.querySelector(layer)).not.toBeNull();
  });

  it('styles read-only without losing the known state', () => {
    const { container } = render(<Bot {...props} state="question" readOnly theme="dark" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-readonly', 'true');
    expect(svg).toHaveAttribute('data-state', 'question');
    expect(svg).toHaveAttribute('data-eyes', 'wide');
    expect(svg.getAttribute('aria-label')).toMatch(/Claude Code · Has a question · Read-only/);
  });

  it('describes itself for assistive technology', () => {
    const { getByRole } = render(<Bot {...props} tool="cursor" state="approval" theme="dark" />);
    expect(getByRole('img', { name: 'Cursor Agent · Needs your approval' })).toBeInTheDocument();
  });

  it('marks the svg reduced when motion is reduced (CSS hook)', () => {
    const { container, rerender } = render(<Bot {...props} theme="dark" reducedMotion />);
    expect(container.querySelector('svg')).toHaveAttribute('data-reduced', 'true');
    rerender(<Bot {...props} theme="dark" reducedMotion={false} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-reduced', 'false');
    rerender(<Bot {...props} theme="dark" />);
    // VITE_LEDGE_MOTION=0 in tests: the app preference reduces motion by default
    expect(container.querySelector('svg')).toHaveAttribute('data-reduced', 'true');
  });
});
