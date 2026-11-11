import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERM_INPUT_MAX, type PhoneServerMessage } from '@ledge/protocol';
import { Terminal } from '../../src/screens/Terminal';
import { INPUT_BATCH_MS, TermController, inputChunk, paintScreen, type TermScreen, type TermWire } from '../../src/term/controller';
import { keyBytes, withModifiers } from '../../src/term/keys';
import type { XtermScreen } from '../../src/term/xterm';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const TID = 't_AbCdEfGh12345678';
const assertion = { id: 'AbC', clientDataJSON: 'eyJ0', authenticatorData: 'SZYN', signature: 'MEUC' };

function fakeScreen() {
  const written: string[] = [];
  const sizes: Array<[number, number]> = [];
  const s: TermScreen = { reset: (c, r) => { sizes.push([c, r]); written.length = 0; }, write: d => { written.push(d); }, resize: (c, r) => { sizes.push([c, r]); } };
  return { s, written, sizes };
}

function wire() {
  let ready = true;
  const handlers = new Set<(m: PhoneServerMessage) => void>();
  const subs = new Set<() => void>();
  const sent: Array<Record<string, unknown> & { type: string }> = [];
  const w: TermWire = {
    send: m => { sent.push(m as never); },
    onMessage: fn => { handlers.add(fn); return () => { handlers.delete(fn); }; },
    ready: () => ready,
    subscribe: fn => { subs.add(fn); return () => { subs.delete(fn); }; }
  };
  return {
    w, sent,
    of: (type: string) => sent.filter(m => m.type === type),
    deliver: (m: PhoneServerMessage) => { for (const h of [...handlers]) h(m); },
    setReady: (r: boolean) => { ready = r; for (const f of [...subs]) f(); }
  };
}

let n = 0;
const uuid = () => `6f1c3a52-2f0b-4c1e-9d3a-0a1b2c3d4e${String(n++).padStart(2, '0')}`;
const opened = (op: string, extra: Partial<Extract<PhoneServerMessage, { type: 'term.opened' }>> = {}): PhoneServerMessage =>
  ({ type: 'term.opened', op, tid: TID, id: 'a', cols: 200, rows: 50, screen: '$ ls\na b', cursor: { x: 3, y: 1 }, seq: 0, ...extra });

function started() {
  const x = wire(); const sc = fakeScreen();
  const c = new TermController(x.w, 'a', sc.s, uuid);
  c.start();
  const op = x.of('term.open')[0]!.op as string;
  return { x, sc, c, op };
}

afterEach(() => { vi.useRealTimers(); });

describe('the terminal controller', () => {
  it('opens, paints the first screen at the pane\'s size, then writes the output in order', () => {
    const { x, sc, c, op } = started();
    expect(c.state.phase).toBe('connecting');
    x.deliver(opened(op));
    expect(sc.sizes).toEqual([[200, 50]]);
    expect(sc.written).toEqual([paintScreen('$ ls\na b', { x: 3, y: 1 })]);
    expect(paintScreen('a\nb', { x: 3, y: 1 })).toBe('\x1b[H\x1b[2Ja\r\nb\x1b[2;4H');
    x.deliver({ type: 'term.output', tid: TID, seq: 0, data: 'one' });
    x.deliver({ type: 'term.output', tid: TID, seq: 1, data: 'two' });
    expect(sc.written.slice(1)).toEqual(['one', 'two']);
    expect(c.state).toMatchObject({ phase: 'live', cols: 200, rows: 50 });
  });

  it('asks a fresh screen once after a gap, and ignores output until it comes', () => {
    const { x, sc, op } = started();
    x.deliver(opened(op));
    x.deliver({ type: 'term.output', tid: TID, seq: 1, data: 'lost one before' });
    x.deliver({ type: 'term.output', tid: TID, seq: 2, data: 'more' });
    expect(x.of('term.resync')).toEqual([{ type: 'term.resync', tid: TID }]);
    expect(sc.written).toHaveLength(1);
    x.deliver(opened(op, { op: undefined, seq: 5, screen: 'fresh' }));
    x.deliver({ type: 'term.output', tid: TID, seq: 5, data: 'next' });
    expect(sc.written.at(-1)).toBe('next');
  });

  it('drops keys until held, then sends them together, numbered, without the xterm\'s own replies', async () => {
    vi.useFakeTimers();
    const { x, c, op } = started();
    x.deliver(opened(op));
    c.type('x');
    expect(x.of('term.input')).toEqual([]);
    const result = c.hold(assertion);
    const hold = x.of('term.hold')[0]!;
    expect(hold).toMatchObject({ tid: TID, assertion });
    x.deliver({ type: 'term.held', tid: TID, until: new Date(Date.now() + 1_800_000).toISOString() });
    x.deliver({ type: 'operation.result', op: hold.op as string, status: 'applied' });
    expect(await result).toBeNull();
    c.type('l'); c.type('s'); c.type('\x1b[12;40R'); c.type('\r');
    await vi.advanceTimersByTimeAsync(INPUT_BATCH_MS);
    expect(x.of('term.input')).toEqual([{ type: 'term.input', tid: TID, n: 0, data: 'ls\r' }]);
    c.type('y'.repeat(TERM_INPUT_MAX + 10));
    await vi.advanceTimersByTimeAsync(INPUT_BATCH_MS);
    expect(x.of('term.input').map(m => [m.n, (m.data as string).length])).toEqual([[0, 3], [1, TERM_INPUT_MAX], [2, 10]]);
  });

  it('says why a hold was refused, and why the hand went back', async () => {
    const { x, c, op } = started();
    x.deliver(opened(op));
    const r = c.hold(assertion);
    x.deliver({ type: 'operation.result', op: x.of('term.hold')[0]!.op as string, status: 'rejected', reason: 'conflict' });
    expect(await r).toBe('conflict');
    expect(c.state.holdRefused).toBe('conflict');
    x.deliver({ type: 'term.held', tid: TID, until: new Date().toISOString() });
    x.deliver({ type: 'term.released', tid: TID, why: 'background' });
    expect(c.state).toMatchObject({ held: null, released: 'background' });
  });

  it('goes offline with the link, opens again once it is back, and ends with the session', () => {
    const { x, c, op } = started();
    x.deliver(opened(op));
    x.setReady(false);
    expect(c.state.phase).toBe('offline');
    x.setReady(true);
    const again = x.of('term.open');
    expect(again).toHaveLength(2);
    expect(again[1]!.op).not.toBe(op);
    x.deliver(opened(again[1]!.op as string));
    x.deliver({ type: 'term.exit', tid: TID, why: 'ended' });
    expect(c.state).toMatchObject({ phase: 'ended', exit: 'ended' });
  });

  it('closes the terminal when the page goes', () => {
    const { x, c, op } = started();
    x.deliver(opened(op));
    c.stop();
    expect(x.of('term.close')).toEqual([{ type: 'term.close', tid: TID }]);
  });

  it('is refused for a session started outside Ledge', () => {
    const { x, c, op } = started();
    x.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'read_only' });
    expect(c.state).toMatchObject({ phase: 'refused', refused: 'read_only' });
  });
});

describe('keys', () => {
  it('types the row\'s keys, arrows in the pane\'s cursor mode', () => {
    expect(keyBytes('esc', false)).toBe('\x1b');
    expect(keyBytes('interrupt', false)).toBe('\x03');
    expect(keyBytes('up', false)).toBe('\x1b[A');
    expect(keyBytes('up', true)).toBe('\x1bOA');
  });
  it('applies Ctrl and Alt to the next key', () => {
    expect(withModifiers('c', { ctrl: true, alt: false })).toBe('\x03');
    expect(withModifiers('[', { ctrl: true, alt: false })).toBe('\x1b');
    expect(withModifiers('x', { ctrl: false, alt: true })).toBe('\x1bx');
    expect(withModifiers('\x1b[A', { ctrl: true, alt: false })).toBe('\x1b[A');
  });
  it('never splits a surrogate pair across two inputs', () => {
    expect(inputChunk('a'.repeat(TERM_INPUT_MAX - 1) + '😀')).toBe('a'.repeat(TERM_INPUT_MAX - 1));
  });
});

/** An xterm without a canvas: what the page asks of it is recorded. */
function fakeXterm() {
  const calls: string[] = [];
  let data: (d: string) => void = () => {};
  const x: XtermScreen = {
    reset: () => calls.push('reset'), write: () => calls.push('write'), resize: () => {},
    onData: fn => { data = fn; }, setFont: px => calls.push(`font ${px}`), font: () => 11, fitFont: () => 6,
    cursor: () => ({ x: 0, cellWidth: 6 }), setInput: on => calls.push(`input ${on}`), paste: () => {}, appCursor: () => false,
    onDrawn: () => {}, focus: () => {}, setTheme: () => {}, dispose: () => calls.push('dispose')
  };
  return { make: () => x, calls, key: (d: string) => data(d) };
}

describe('the live terminal screen', () => {
  function page(daemon: Record<string, true>, device = { confirm: true }) {
    const t = setup();
    const snap = snapshot([session('a', { name: 'Kai', state: 'working', project: 'billing-api' })], 'Atelier', undefined, device);
    t.deliver({ ...snap, ...(snap.type === 'snapshot' ? { daemon: { ...snap.daemon, ...daemon } } : {}) } as PhoneServerMessage);
    const xt = fakeXterm();
    return { ...t, xt };
  }

  it('keeps the preview for a PC that does not stream terminals', () => {
    const t = page({});
    render(<Terminal store={t.store} link={t.link} sessionId="a" storage={t.storage} />);
    expect(t.of('term.open')).toEqual([]);
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }]);
  });

  it('opens the stream, shows the PC\'s size, and offers the hand only when the PC allows typing', async () => {
    const t = page({ terminal: true });
    const { TerminalLive } = await import('../../src/screens/TerminalLive');
    const view = render(<TerminalLive store={t.store} link={t.link} session={t.store.getState().sessions.get('a')!} storage={t.storage} makeScreen={t.xt.make} />);
    const op = t.of('term.open')[0]!.op;
    act(() => t.deliver(opened(op)));
    expect(screen.getByText('En direct · lecture seule')).toBeInTheDocument();
    expect(screen.getByText('billing-api · 200 × 50, taille du PC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prendre la main/ })).toBeNull();
    expect(screen.getByText(/active « Taper dans les terminaux depuis un appareil lié »/)).toBeInTheDocument();
    view.unmount();
    expect(t.of('term.close')).toEqual([{ type: 'term.close', tid: TID }]);
    expect(t.xt.calls).toContain('dispose');
  });

  it('asks the passkey before the hand, then shows the key row and types through it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = page({ terminal: true, terminalInput: true });
    const { TerminalLive } = await import('../../src/screens/TerminalLive');
    render(<TerminalLive store={t.store} link={t.link} session={t.store.getState().sessions.get('a')!} storage={t.storage} makeScreen={t.xt.make} />);
    act(() => t.deliver(opened(t.of('term.open')[0]!.op)));
    fireEvent.click(screen.getByRole('button', { name: /Prendre la main/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Taper dans le terminal de Kai ?');
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'terminal', id: 'a' }]);
    // The PC gives the hand (the passkey's own path is RiskConfirm's, tested there).
    act(() => t.deliver({ type: 'term.held', tid: TID, until: new Date(Date.now() + 1_800_000).toISOString() }));
    expect(screen.getByText('Tu tapes dans Kai')).toBeInTheDocument();
    expect(t.xt.calls).toContain('input true');
    fireEvent.click(screen.getByRole('button', { name: 'Contrôle' }));
    expect(screen.getByRole('button', { name: 'Contrôle, armé' })).toHaveAttribute('aria-pressed', 'true');
    act(() => t.xt.key('c'));
    fireEvent.click(screen.getByRole('button', { name: 'Flèche haut' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(INPUT_BATCH_MS + 5); });
    expect(t.of('term.input').map(m => m.data).join('')).toBe('\x03\x1b[A');
    fireEvent.click(screen.getByRole('button', { name: 'Rendre la main' }));
    expect(t.of('term.release')).toEqual([{ type: 'term.release', tid: TID }]);
  });

  it('says why the hand went back, and offers it again', async () => {
    const t = page({ terminal: true, terminalInput: true });
    const { TerminalLive } = await import('../../src/screens/TerminalLive');
    render(<TerminalLive store={t.store} link={t.link} session={t.store.getState().sessions.get('a')!} storage={t.storage} makeScreen={t.xt.make} />);
    act(() => t.deliver(opened(t.of('term.open')[0]!.op)));
    act(() => t.deliver({ type: 'term.held', tid: TID, until: new Date(Date.now() + 1_800_000).toISOString() }));
    act(() => t.deliver({ type: 'term.released', tid: TID, why: 'idle' }));
    expect(screen.getByText('Main rendue : 5 minutes sans frappe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reprendre la main/ })).toBeEnabled();
  });
});
