import React from 'react';

/* `ledge tui` frames, character by character, in the TUI's palettes (packages/ledge/src/tui/theme.ts): a segment is
   [text, colour, bold, background]. The colours are CSS variables the theme switch sets (.tui-dark / .tui-light). */

type Col = 'fg' | 'dim' | 'faint' | 'line' | 'coral' | 'blue' | 'red' | 'yellow' | 'green' | 'violet' | 'sel' | 'bar' | 'key';
type Seg = [string, Col?, boolean?, Col?];
type Line = Seg[];

const len = (l: Line) => l.reduce((n, s) => n + [...s[0]].length, 0);
const pad = (s: string, n: number) => { const a = [...s]; return a.length >= n ? a.slice(0, n).join('') : s + ' '.repeat(n - a.length); };
/** A line cut or padded to `w` columns; a background on the last segment carries over the padding. */
function fit(l: Line, w: number, bg?: Col): Line {
  const out: Line = []; let n = 0;
  for (const s of l) { const a = [...s[0]]; if (n + a.length > w) { out.push([a.slice(0, w - n).join(''), s[1], s[2], s[3] ?? bg]); n = w; break; } out.push(bg && !s[3] ? [s[0], s[1], s[2], bg] : s); n += a.length; }
  if (n < w) out.push([' '.repeat(w - n), 'fg', false, bg]);
  return out;
}
/** A titled box (TitledBox) `w` columns wide; `rows` are its inside lines, each with an optional background. */
function box(title: string, w: number, rows: Array<Line | { l: Line; bg: Col }>, color: Col = 'line', titleColor: Col = 'dim', minRows = 0): Line[] {
  const t = ` ${title} `;
  const top: Line = [['╭─', color], [t, titleColor, true], ['─'.repeat(Math.max(0, w - 3 - [...t].length)) + '╮', color]];
  const body = rows.map(r => ('l' in r ? r : { l: r, bg: undefined as Col | undefined })).map(r => [['│', color], ...fit([[' '], ...r.l], w - 2, r.bg), ['│', color]] as Line);
  while (body.length < minRows) body.push([['│', color], [' '.repeat(w - 2)], ['│', color]]);
  return [top, ...body, [['╰' + '─'.repeat(w - 2) + '╯', color]]];
}
const hcat = (a: Line[], aw: number, b: Line[]): Line[] => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [...(a[i] ? fit(a[i]!, aw) : [[' '.repeat(aw)] as Seg]), ...(b[i] ?? [])]);

const W = 132;
const header = (right: string): Line => fit([[' ◖ ledge', 'coral', true, 'bar'], ['  ' + right, 'dim', false, 'bar']], W, 'bar');
const keys = (ks: Array<[string, string]>): Line => fit(ks.flatMap(([k, v]) => [[` ${k} `, 'fg', true, 'key'], [` ${v}  `, 'dim', false, 'bar']] as Seg[]), W, 'bar');

function Frame({ lines, label }: { lines: Line[]; label: string }) {
  return (
    <div className="tt-wrap" role="img" aria-label={label}>
      <pre className="tt">{lines.map((l, i) => <React.Fragment key={i}>{l.map((s, j) => <span key={j} style={{ color: `var(--t-${s[1] ?? 'fg'})`, fontWeight: s[2] ? 600 : undefined, background: s[3] ? `var(--t-${s[3]})` : undefined }}>{s[0]}</span>)}{'\n'}</React.Fragment>)}</pre>
    </div>
  );
}

/* ── ↵ on an OMP seat: its pane, attached (as `a` does for any seat) ── */

export function TuiAttached() {
  const mirror = ["you > Story ST7-412 : implémente le refus d'un IBAN vide, en TDD strict.", '', 'Je commence par le test rouge : un IBAN vide doit être refusé avec', 'INVALID_IBAN.', '',
    '  ⚙ read …', '  ⚙ read done', '  ⚙ edit done', '  ⚙ bash …', '  ⚙ bash FAILED', '', 'Le test échoue comme attendu (rouge). Je commite cette étape.', '', '  ⚙ bash …', '  ⚙ bash done', '  ⚙ edit done', '  ⚙ bash …', '', '', ''];
  const lines: Line[] = [...mirror.map(l => [[l, 'fg']] as Line), fit([['[dev-agent@dev-omp] 0:node*', 'fg', false, 'green'], ['   ctrl-b d revient à ledge tui', 'fg', false, 'green']], W, 'green')];
  return <Frame label="ledge tui · siège OMP attaché" lines={lines} />;
}

/* ── Vue d'ensemble (1) ── */

export function TuiOverview({ stoppedOn = false }: { stoppedOn?: boolean }) {
  const st: Record<string, [string, Col, string]> = { working: ['●', 'blue', 'Au travail'], idle: ['○', 'green', 'Disponible'], stopped: ['·', 'faint', 'Arrêté'] };
  const seat = (on: boolean, name: string, role: string, tool: string, s: string, isNew = false): { l: Line; bg: Col } | Line => {
    const [g, c, word] = st[s]!;
    const off = s === 'stopped';
    const l: Line = [[on ? '▌' : ' ', on ? 'coral' : 'faint'], ['  '], [g + ' ', c], [pad(name, 6), off ? 'faint' : 'fg', !off], [' ' + pad(role, 20), off ? 'faint' : 'dim'], [pad(tool, 9), off ? 'faint' : 'dim'], [word, c]];
    return on ? { l, bg: 'sel' } : l;
  };
  const rig = (name: string, n: string): Line => [[' '], [pad(name, 14), 'fg', true], [n, 'faint']];
  const rigs = box('RIGS', W, [
    rig('dev-omp', '2 sessions'),
    seat(!stoppedOn, 'Ivo', 'dev.agent', 'omp', 'working', true),
    seat(false, 'Pia', 'review.reviewer', 'omp', 'idle', true),
    rig('ledge-dev', '4 sessions'),
    seat(false, 'Lu', 'pilot.lead', 'claude', 'idle', true),
    seat(false, 'Ida', 'dev.back', 'claude', 'working', true),
    rig('split-omp', '2 sessions sur 3'),
    seat(false, 'Ana', 'analysis.analyst', 'omp', 'idle', true),
    seat(false, 'Sol', 'review.reviewer', 'omp', 'idle', true),
    seat(stoppedOn, 'Tom', 'split.splitter', 'omp', 'stopped', true)
  ], 'line', 'dim', 14);
  const kernel = box('KERNEL', W, [seat(false, 'Kit', 'operator', 'claude', 'idle')]);
  const toast: Line[] = stoppedOn ? [fit([[' ℹ Tom est arrêté : son terminal n’existe plus. 6 ouvre OpenRig, où est son rig.', 'blue']], W)] : [];
  return <Frame label="ledge tui · vue d'ensemble avec des sièges OMP" lines={[header('9 sessions · 1 machine'), ...kernel, ...rigs, ...toast, keys(stoppedOn ? [['↑↓', 'choisir'], ['6', 'OpenRig'], ['?', 'aide']] : [['↑↓', 'choisir'], ['↵', 'attacher son terminal'], ['a', 'attacher (tmux)'], ['6', 'OpenRig'], ['?', 'aide']])]} />;
}

/* ── ledge who ── */

export function Who() {
  const rows: Array<[string, string, string, string, string, string, boolean?]> = [
    ['Kit', 'claude', 'idle', 'workspace', '-', 'advisor-lead@kernel'],
    ['Lu', 'claude', 'idle', 'Ledge', 'main', 'pilot-lead@ledge-dev'],
    ['Ida', 'claude', 'working', 'Ledge', 'main', 'dev-back@ledge-dev'],
    ['Ivo', 'omp', 'working', 'workspace', '-', '-', true],
    ['Pia', 'omp', 'idle', 'workspace', '-', '-', true],
    ['Ana', 'omp', 'idle', 'workspace', '-', '-', true],
    ['Sol', 'omp', 'idle', 'workspace', '-', '-', true],
    ['Tom', 'omp', 'exited', 'workspace', '-', '-', true]
  ];
  const lines: Line[] = [
    [['$ ', 'faint'], ['ledge who', 'fg']],
    [['  ' + pad('NOM', 4) + pad('OUTIL', 7) + pad('ÉTAT', 8) + pad('PROJET', 10) + pad('BRANCHE', 8) + 'SUJET', 'dim', true]],
    ...rows.map(([n, t, s, p, b, sub, isNew]) => [['  ' + pad(n, 4), s === 'exited' ? 'faint' : 'fg'], [pad(t, 7), s === 'exited' ? 'faint' : 'fg'], [pad(s, 8), s === 'exited' ? 'faint' : 'fg'], [pad(p, 10) + pad(b, 8) + sub, s === 'exited' ? 'faint' : 'fg']] as Line)
  ];
  return <Frame label="ledge who avec des sièges OMP" lines={lines} />;
}
