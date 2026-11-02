import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { NowPlaying } from '@ledge/protocol';
import { Handle, CAN_SETTLE_MS } from '../src/surface/Handle';
import { Badge } from '../src/ui/Badge';
import { describe as describeLine } from '../src/notch/describe';
import { MESSAGES } from '../src/i18n/messages';
import type { NotchLine } from '../src/notch/line';

const en = MESSAGES.en;
const names: Record<string, string> = { otto: 'Otto', nova: 'Nova', pim: 'Pim' };
const name = (id: string) => names[id] ?? id;
const at = '2026-11-02T19:00:00.000Z';
const tool: NotchLine = { kind: 'tool', session: 'otto', at, tool: 'Edit', label: 'Edit apps/overlay/src/surface/Handle.tsx' };
const track: NotchLine = { kind: 'track', title: 'Sous la verrière', artist: 'Halles 72' };
const music: NowPlaying = { title: 'Lignes de fuite', artist: 'Atelier Nord', playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe', name: 'Spotify' } };
const awake = (line: NotchLine | null, extra: Partial<Parameters<typeof Handle>[0]> = {}) =>
  <Handle visible awake line={line} described={line ? describeLine(line, name, en) : null} {...extra} />;

describe('<Handle> at rest', () => {
  it('is a 10 px filet with Ledge’s mark alone: no session dash', () => {
    render(<Handle visible />);
    const filet = document.querySelector('[data-layer="handle"][data-filet]')!;
    expect(filet.querySelector('[data-ledge-mark]')).not.toBeNull();
    expect(filet.querySelectorAll('button')).toHaveLength(1);
    expect(filet.querySelector('[data-dot]')).toBeNull();
  });
  it('orders the mark, the update dash, then the still bars while a track plays; none in pause', () => {
    const { rerender } = render(<Handle visible music={music} updatePip="new" updateVersion="0.3.0" />);
    const filet = document.querySelector('[data-filet]')!;
    const order = [...filet.children].map(c => c.querySelector('[data-ledge-mark]') ? 'ledge' : c.querySelector('[data-update-pip]') ? 'pip' : c.hasAttribute('data-eq') ? 'eq' : '?');
    expect(order).toEqual(['ledge', 'pip', 'eq']);
    expect(screen.getByRole('img', { name: 'Now playing: Lignes de fuite, Atelier Nord' })).toBeInTheDocument();
    rerender(<Handle visible music={{ ...music, playing: false }} />);
    expect(document.querySelector('[data-eq]')).toBeNull();
  });
  it('the discreet strip keeps Ledge’s mark', () => {
    render(<Handle visible strip />);
    expect(document.querySelector('[data-layer="handle"][data-strip] [data-ledge-mark]')).not.toBeNull();
  });
  it('is inert when not visible', () => {
    const { container } = render(<Handle visible={false} />);
    expect(container.firstChild).toHaveAttribute('inert');
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
  it('an unread Ledge answer names the reply on the mark', () => {
    render(<Handle visible unread />);
    expect(screen.getByRole('button', { name: /Ledge replied, open/ })).toBeInTheDocument();
  });
  it('the update dash keeps its tone and names the version on Ledge', () => {
    render(<Handle visible updatePip="new" updateVersion="0.3.0" />);
    expect(document.querySelector('[data-update-pip="new"]')).toHaveStyle({ width: '5px', height: '3px', background: 'var(--sidebar-primary)' });
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toMatch(/^Ledge 0\.3\.0 is ready\./);
  });
});

describe('<Handle> awake', () => {
  it('shows Ledge, the moon right after it in DND, then one line: name, verb, short target', () => {
    render(awake(tool, { dnd: true }));
    const row = document.querySelector('[data-awake]')!;
    expect(row.querySelectorAll('svg.bot')).toHaveLength(0);
    const kids = [...row.children].map(c => c.matches('[data-dnd-moon]') ? 'moon' : c.matches('[data-line]') ? 'line' : c.querySelector('[data-resident]') ? 'ledge' : '?');
    expect(kids).toEqual(['ledge', 'moon', 'line']);
    const line = screen.getByRole('button', { name: 'Open Otto in Ledge' });
    expect(line.querySelector('b')).toHaveTextContent('Otto');
    expect(line.querySelector('code')).toHaveTextContent('surface/Handle.tsx');
    expect(line).toHaveAttribute('title', 'Otto edits surface/Handle.tsx');
  });
  it('a click on the line opens that session; on a track it does nothing', () => {
    const onOpenLine = vi.fn();
    const { rerender } = render(awake(tool, { onOpenLine }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Otto in Ledge' }));
    expect(onOpenLine).toHaveBeenCalledWith('otto');
    rerender(awake(track, { onOpenLine, music }));
    fireEvent.click(document.querySelector('[data-line]')!);
    expect(onOpenLine).toHaveBeenCalledTimes(1);
  });
  it('an old line seen on hover is greyed with its age', () => {
    render(awake(tool, { aged: '12s ago' }));
    expect(document.querySelector('[data-line] [data-aged]')).not.toBeNull();
    expect(document.querySelector('[data-line]')).toHaveTextContent('12s ago');
  });
  it('without a line, Ledge and the cover only; without music, no filet nor cover', () => {
    const { rerender } = render(awake(null, { music }));
    expect(document.querySelector('[data-line]')).toBeNull();
    expect(document.querySelector('[data-cover]')).not.toBeNull();
    rerender(awake(tool));
    expect(document.querySelector('.nt-sep')).toBeNull();
    expect(document.querySelector('[data-cover]')).toBeNull();
  });
  it('the cover opens the controls on hover or focus; each is a plain icon that sends its command', () => {
    const onMedia = vi.fn(), onMusicOpen = vi.fn();
    const { rerender } = render(awake(tool, { music, onMedia, onMusicOpen }));
    fireEvent.mouseEnter(document.querySelector('[data-music]')!);
    expect(onMusicOpen).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('tabindex', '-1');
    rerender(awake(tool, { music, onMedia, onMusicOpen, musicOpen: true }));
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toHaveAttribute('tabindex', '0');
    expect(pause.querySelector('.na-disc, [data-disc]')).toBeNull();
    fireEvent.click(pause);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onMedia.mock.calls).toEqual([['play_pause'], ['next']]);
  });
  it('a control the player refuses is disabled, not hidden, once refused for a moment (no blink after « next »)', () => {
    vi.useFakeTimers();
    const props = { music, musicOpen: true, onMedia: vi.fn() };
    const { rerender } = render(awake(null, props));
    const refused = { ...music, can: { previous: false, playPause: true, next: false } };
    rerender(awake(null, { ...props, music: refused }));
    expect(screen.getByRole('button', { name: 'Previous' })).not.toHaveAttribute('aria-disabled');
    rerender(awake(null, props));
    act(() => { vi.advanceTimersByTime(CAN_SETTLE_MS + 50); });
    expect(screen.getByRole('button', { name: 'Previous' })).not.toHaveAttribute('aria-disabled');
    rerender(awake(null, { ...props, music: refused }));
    act(() => { vi.advanceTimersByTime(CAN_SETTLE_MS + 50); });
    const prev = screen.getByRole('button', { name: 'Previous' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).toHaveAttribute('title', 'This player can’t go back');
    fireEvent.click(prev);
    expect(props.onMedia).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('a paused track: greyed cover with the pause sign, « Paused », a Play button; no raw player id', () => {
    render(awake(null, { music: { ...music, artist: '', playing: false, player: { id: 'Chrome' } }, musicOpen: true }));
    expect(document.querySelector('[data-cover]')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Now playing: Lignes de fuite (Paused)' })).toBeInTheDocument();
    const titles = document.querySelector('.nt-titles')!;
    expect(titles).toHaveTextContent('Paused');
    expect(titles).not.toHaveTextContent('Chrome');
  });
  it('without artist nor player name, the title alone', () => {
    render(awake(null, { music: { ...music, artist: '', player: { id: 'Chrome' } }, musicOpen: true }));
    expect(document.querySelector('.nt-titles')!.children).toHaveLength(1);
  });
  it('the cover arrives late: a neutral square with a note, then the picture', () => {
    const { rerender } = render(awake(null, { music }));
    expect(document.querySelector('[data-cover] img')).toBeNull();
    rerender(awake(null, { music: { ...music, artwork: 'data:image/png;base64,AAAA' } }));
    expect(document.querySelector('[data-cover] img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });
});

describe('the line in words', () => {
  it('names both ends of a message and opens the sender', () => {
    const out = describeLine({ kind: 'message', session: 'otto', at, direction: 'out', counterpart: 'nova@ledge-dev-2', peer: 'nova', summary: 'Maquette validée' }, name, en);
    expect(out).toMatchObject({ text: 'Otto → Nova · Maquette validée', open: 'otto' });
    const fromRig = describeLine({ kind: 'message', session: 'otto', at, direction: 'in', counterpart: 'review-qa', summary: 'Deux écarts' }, name, en);
    expect(fromRig).toMatchObject({ text: 'review-qa → Otto · Deux écarts', open: 'otto' });
    const toRig = describeLine({ kind: 'message', session: 'otto', at, direction: 'out', counterpart: 'dev-front@ledge-dev-2', summary: 'Relis' }, name, en);
    expect(toRig.text).toBe('Otto → dev-front · Relis');
    const fromPeer = describeLine({ kind: 'message', session: 'nova', at, direction: 'in', counterpart: 'Otto', peer: 'otto', summary: 'Salut' }, name, en);
    expect(fromPeer.open).toBe('otto');
  });
  it('a sub-agent, a command, a thinking and each notification', () => {
    expect(describeLine({ kind: 'tool', session: 'otto', at, helperId: 'h1', tool: 'Glob', label: 'Glob apps/overlay/**/*.tsx' }, name, en).text).toBe('Otto searches **/*.tsx');
    expect(describeLine({ kind: 'tool', session: 'otto', at, helperId: 'h1', tool: 'Glob', label: 'x' }, name, en).parts.map(p => p.k)).toContain('sub');
    expect(describeLine({ kind: 'tool', session: 'nova', at, tool: 'Bash', label: 'pnpm --filter @ledge/overlay test' }, name, en).text).toBe('Nova runs pnpm --filter @ledge/overlay test');
    expect(describeLine({ kind: 'tool', session: 'nova', at, tool: 'Task', label: 'Task' }, name, en).text).toBe('Nova uses Task');
    expect(describeLine({ kind: 'thinking', session: 'nova', at }, name, en).text).toBe('Nova is thinking…');
    expect(describeLine({ kind: 'notification', session: 'pim', at, reason: 'permission', text: 'pnpm up' }, name, en).text).toBe('Pim needs your approval · pnpm up');
    expect(describeLine({ kind: 'notification', session: 'otto', at, reason: 'plan' }, name, en).text).toBe('Otto has a plan for you');
    expect(describeLine({ kind: 'notification', session: 'otto', at, reason: 'finished' }, MESSAGES.fr ? name : name, MESSAGES.fr).text).toBe('Otto a terminé');
  });
  it('a track: the title and the artist, or the title alone; no session to open', () => {
    expect(describeLine(track, name, en)).toMatchObject({ text: 'Sous la verrière · Halles 72', open: null });
    expect(describeLine({ kind: 'track', title: 'Live #41', artist: '' }, name, en).text).toBe('Live #41');
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
