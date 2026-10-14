import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { fakeSession } from './mockDaemon';
import { botState, poseFor, type BotState, materialFor } from '@ledge/client';
import { Bot } from '../src/bots/Bot';

// ms() scales by VITE_LEDGE_MOTION (0 in tests) through a lookup vi.stubEnv does not reach; a test can unscale it.
const motion = vi.hoisted(() => ({ unscaled: false }));
vi.mock('../src/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/motion')>();
  return { ...actual, ms: (n: number) => (motion.unscaled ? `${Math.round(n)}ms` : actual.ms(n)) };
});

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
  });
  it('an idle parent whose helper still works reads as working; exited helpers leave it idle', () => {
    const working = { id: 'h1', kind: 'general-purpose', task: 'review task 1', state: 'working' as const };
    const exited = { ...working, id: 'h0', state: 'exited' as const };
    expect(botState(fakeSession('a', { state: 'idle', helpers: [working] }))).toBe('working');
    expect(botState(fakeSession('a', { state: 'idle', helpers: [{ ...working, state: 'waiting_permission' }] }))).toBe('working');
    expect(botState(fakeSession('a', { state: 'idle', helpers: [exited] }))).toBe('idle');
    expect(botState(fakeSession('a', { state: 'exited', helpers: [working] }))).toBe('done');
    expect(botState(fakeSession('a', { state: 'error', helpers: [working] }))).toBe('error');
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

  it('carries a halo in the state colour for live sessions only', () => {
    const halo = (state: BotState, readOnly = false) => {
      const { container } = render(<Bot {...props} state={state} readOnly={readOnly} theme="dark" />);
      return container.querySelector('svg')!.getAttribute('data-halo');
    };
    for (const state of ['starting', 'working', 'approval', 'question', 'idle', 'error'] as const) expect(halo(state)).toBe('true');
    expect(halo('done')).toBe('false');
    expect(halo('readonly')).toBe('false');
    expect(halo('approval', true)).toBe('false');
  });

  it('exposes its size so the halo scales with the avatar', () => {
    const { container } = render(<Bot {...props} size={48} theme="dark" />);
    expect(container.querySelector('svg')!.style.getPropertyValue('--bot-size')).toBe('48px');
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

  describe('working hop', () => {
    // The test env reduces motion (VITE_LEDGE_MOTION=0) and zeroes ms(); the hop needs real motion on.
    beforeEach(() => { vi.stubEnv('VITE_LEDGE_MOTION', '1'); motion.unscaled = true; });
    afterEach(() => { vi.unstubAllEnvs(); motion.unscaled = false; });
    const svg = () => document.querySelector('svg.bot') as SVGSVGElement;
    const vars = () => { const s = svg().getAttribute('style') ?? ''; return Object.fromEntries([...s.matchAll(/(--bot-[a-z-]+):\s*([^;]+)/g)].map(m => [m[1]!, m[2]!.trim()])); };

    it('hops only while working, at 12 px as at 48 px', () => {
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={12} theme="dark" />);
      expect(svg()).toHaveAttribute('data-hop', 'true');
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={48} theme="dark" />);
      expect(svg()).toHaveAttribute('data-hop', 'true');
      for (const state of ['starting', 'approval', 'question', 'idle', 'error', 'done', 'readonly'] as const) {
        cleanup();
        render(<Bot seed="s1" tool="claude" state={state} pose={1} size={32} theme="dark" />);
        expect(svg(), state).toHaveAttribute('data-hop', 'false');
      }
    });

    it('is off under reduced motion, read-only, frozen and paused', () => {
      const cases = [{ reducedMotion: true }, { readOnly: true }, { frozen: true }, { paused: true }];
      for (const extra of cases) {
        cleanup();
        render(<Bot seed="s1" tool="claude" state="working" pose={1} size={32} theme="dark" {...extra} />);
        expect(svg(), JSON.stringify(extra)).toHaveAttribute('data-hop', 'false');
      }
    });

    it('sizes the hop in SVG units from clamp(2, size * 0.12, 7) px and cycles every 3.6 to 4.4 s', () => {
      // ≤ 20 px draws the head-only viewBox (72 units wide): 2 px of a 12 px bot is 2 / 12 * 72 = 12 units.
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={12} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('12.00px');
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={48} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('11.52px');
      cleanup();
      render(<Bot seed="s1" tool="claude" state="working" pose={1} size={96} theme="dark" />);
      expect(vars()['--bot-hop']).toBe('7.00px');
      const cycle = parseInt(vars()['--bot-hop-cycle']!, 10);
      expect(cycle).toBeGreaterThanOrEqual(3600); expect(cycle).toBeLessThanOrEqual(4400);
      expect(svg().querySelector('g.hop > g.body')).not.toBeNull();
    });
  });
});
