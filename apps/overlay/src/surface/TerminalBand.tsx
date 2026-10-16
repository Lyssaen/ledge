import { useState, type Ref } from 'react';
import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/lang';
import { Icon, ICONS } from '../ui/icons';

/** What the strip says the terminal is doing (mockup "C · états du bandeau"). */
export type BandTone = 'working' | 'approval' | 'question' | 'idle' | 'done' | 'error';

export function bandTone(s: Session): BandTone {
  if (s.state === 'error') return 'error';
  if (s.pending) return s.pending.kind === 'question' ? 'question' : 'approval';
  if (s.state === 'exited') return 'done';
  if (s.state === 'idle') return 'idle';
  return 'working';
}

/** The last line that says something: blank lines and a bare prompt (`>`, `❯`) do not. */
export function lastLine(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (l && l !== '>' && l !== '❯') return l;
  }
  return '';
}

const TONE: Record<BandTone, { bg: string; border: string; fg: string; dot: string }> = {
  working: { bg: 'var(--well)', border: 'color-mix(in srgb, var(--muted-foreground) 45%, transparent)', fg: 'var(--sidebar-foreground)', dot: 'var(--success)' },
  approval: { bg: 'var(--status-warning-soft)', border: 'color-mix(in srgb, var(--warning) 50%, transparent)', fg: 'var(--warning)', dot: 'var(--warning)' },
  question: { bg: 'var(--status-warning-soft)', border: 'color-mix(in srgb, var(--warning) 50%, transparent)', fg: 'var(--warning)', dot: 'var(--warning)' },
  idle: { bg: 'var(--well)', border: 'var(--border)', fg: 'var(--muted-foreground)', dot: 'var(--muted-foreground)' },
  done: { bg: 'var(--well)', border: 'var(--border)', fg: 'var(--muted-foreground)', dot: 'var(--muted-foreground)' },
  error: { bg: 'var(--status-danger-soft)', border: 'color-mix(in srgb, var(--danger-text) 50%, transparent)', fg: 'var(--danger-text)', dot: 'var(--danger-text)' }
};
const mono = "'Geist Mono', ui-monospace, monospace";
const PEEK_LINES = 8;

export function Dot({ tone }: { tone: BandTone }) {
  return <span aria-hidden="true" data-band-dot className={tone === 'working' ? 'ledge-band-live' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: TONE[tone].dot, flexShrink: 0 }} />;
}

/** Compact view: one line above the reply field with the terminal's latest line, coloured by the session's state.
 *  Hovering (or focusing) it shows the last 8 lines; a click opens reading mode, the terminal alongside the thread. */
export function TerminalBand({ session: s, lines, t, onOpen }: { session: Session; lines: string[]; t: Messages; onOpen: () => void }) {
  const [peek, setPeek] = useState(false);
  const tone = bandTone(s);
  const c = TONE[tone];
  const latest = lastLine(lines);
  const label = tone === 'working' ? latest
    : tone === 'approval' ? `${t.session.band.approval} · ${s.pending!.text.split('\n')[0]}`
    : tone === 'question' ? `${t.session.band.question} · ${s.pending!.text.split('\n')[0]}`
    : latest ? `${t.session.band[tone]} · ${latest}` : t.session.band[tone];
  const raw = tone === 'working' || tone === 'error';
  return (
    <div style={{ position: 'relative', padding: '0 12px 8px' }}>
      {peek && (
        <div id="ledge-terminal-peek" role="tooltip" data-terminal-peek style={{ position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 4, zIndex: 2, background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', gap: 8, padding: '6px 12px', fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)' }}>
            <span>{t.session.peek}</span><span style={{ flexGrow: 1 }} /><span>{t.session.peekHint}</span>
          </div>
          <div style={{ padding: '8px 12px', background: 'var(--well)', fontFamily: mono, fontSize: 11.5, lineHeight: '17px', color: 'var(--sidebar-foreground)' }}>
            {lines.slice(-PEEK_LINES).map((l, i) => <div key={i} style={{ minHeight: 17, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{l || ' '}</div>)}
          </div>
        </div>
      )}
      <button type="button" data-terminal-band data-tone={tone} aria-label={`${t.session.terminal} : ${label} · ${t.session.band.open}`} aria-describedby={peek ? 'ledge-terminal-peek' : undefined} aria-keyshortcuts="T"
        onMouseEnter={() => setPeek(true)} onMouseLeave={() => setPeek(false)} onFocus={() => setPeek(true)} onBlur={() => setPeek(false)} onClick={() => { setPeek(false); onOpen(); }}
        className="ledge-band"
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32, boxSizing: 'border-box', padding: '0 8px 0 10px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 'var(--radius-md)', color: c.fg, fontFamily: raw ? mono : 'inherit', fontSize: 12, lineHeight: '16px', textAlign: 'left', cursor: 'pointer' }}>
        <Dot tone={tone} />
        <span data-band-text style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--muted-foreground)' }}><Icon size={13} {...ICONS.expand} /></span>
      </button>
    </div>
  );
}

/** Reading mode: the terminal's lines alongside the thread, following its latest line. Folds into a rail. */
export function TerminalPane({ session: s, lines, t, preRef, onScroll, onFold }: { session: Session; lines: string[]; t: Messages; preRef: Ref<HTMLPreElement>; onScroll: (el: HTMLPreElement) => void; onFold: () => void }) {
  return (
    <section aria-label={t.session.terminal} data-terminal-pane style={{ flex: '1.15 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--well)', borderLeft: '1px solid var(--sidebar-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, flexShrink: 0, padding: '0 6px 0 14px', borderBottom: '1px solid var(--sidebar-border)', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
        <Dot tone={bandTone(s)} />
        <strong style={{ color: 'var(--sidebar-foreground)', fontSize: 13, fontWeight: 600 }}>{t.session.terminal}</strong>
        <span style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.session.terminalNote(lines.length)}</span>
        <button type="button" data-terminal-fold aria-label={t.session.foldTerminal} title={t.session.foldTerminal} onClick={onFold}
          style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer' }}><Icon size={14} {...ICONS.chevronRight} /></button>
      </div>
      <pre ref={preRef} data-terminal onScroll={e => onScroll(e.currentTarget)} className="mono ledge-scroll" style={{ flex: '1 1 auto', minHeight: 0, margin: 0, padding: '10px 14px', overflow: 'auto', overscrollBehavior: 'contain', fontSize: 12, lineHeight: '18px', color: 'var(--sidebar-foreground)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{lines.map((l, i) => <div key={i}>{l || ' '}</div>)}</pre>
    </section>
  );
}

/** The folded terminal: a narrow rail whose dot stays live; a click reopens it. */
export function TerminalRail({ session: s, t, onUnfold }: { session: Session; t: Messages; onUnfold: () => void }) {
  return (
    <button type="button" data-terminal-rail aria-label={t.session.unfoldTerminal} title={t.session.unfoldTerminal} onClick={onUnfold}
      style={{ width: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '14px 0 0', border: 0, borderLeft: '1px solid var(--sidebar-border)', background: 'var(--well)', color: 'var(--muted-foreground)', font: 'inherit', cursor: 'pointer' }}>
      <Dot tone={bandTone(s)} />
      <span style={{ writingMode: 'vertical-rl', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t.session.terminal}</span>
    </button>
  );
}
