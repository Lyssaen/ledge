import { useEffect, useReducer, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import type { TermSurface } from '../term/surface';
import { commandRows, commandText, draftText, outputText, statusOf, typeable, type CommandStatus, type ShellCommand } from '../term/shellMarks';
import { fmtDur } from './exchanges';


interface Drawn { c: ShellCommand; status: CommandStatus; from: number; to: number }

/**
 * A free shell's command marks (#299, docs/mockups/ledge-shell-marks.html, form A, « A, et tout les reco »): a 2 px line along a
 * failed command and its output (red), a running one (grey, dotted), none for one that succeeded; on hover or focus a light band
 * and « ⋯ » at the end of the prompt's line, its menu (Copier la commande, Copier la sortie, Relancer); a red mark per failed command
 * in the right margin, a click scrolls to it; Ctrl ↑ / Ctrl ↓ go from one command to the next. A shell without integration: nothing.
 */
export function ShellMarksLayer({ surface, area }: { surface: TermSurface; area: RefObject<HTMLElement | null> }): JSX.Element | null {
  const { t, lang } = useI18n();
  const m = t.ide.panel.marks;
  const sh = surface.shell;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; at: { x: number; y: number } } | null>(null);
  /** The command Ctrl ↑ / Ctrl ↓ just moved to: its handle takes the keyboard as soon as it is drawn (a scroll redraws a frame later). */
  const toFocus = useRef<number | null>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // Marks, scroll, render, resize: drawn again, once a frame at most.
  useEffect(() => {
    if (!sh) return;
    let frame = 0;
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; redraw(); }); };
    const off = [sh.marks.subscribe(soon), sh.onView(soon)];
    return () => { off.forEach(f => f()); cancelAnimationFrame(frame); };
  }, [sh]);

  const v = sh?.view();
  const on = !!sh && sh.marks.active && !!v?.normal && v.rowPx > 0;
  const all = on ? sh.marks.commands() : [];
  const drawn: Drawn[] = all.map((c, i) => ({ c, status: statusOf(c, i === all.length - 1), ...commandRows(c, v!.cursor) }));
  // What ran: the prompt being typed in has no handle.
  const ran = drawn.filter(d => d.status !== 'typing');

  // A running command's duration, in its tooltip and its menu: counted every second while one runs and its handle shows.
  const live = ran.some(d => d.status === 'running' && (d.c.id === hover || d.c.id === focus || d.c.id === menu?.id));
  useEffect(() => { if (!live) return; const id = setInterval(tick, 1000); return () => clearInterval(id); }, [live]);

  // The pointer over a command: its band and its handle. Read on the area (the xterm keeps its own mouse: selection, links).
  useEffect(() => {
    const el = area.current;
    if (!el || !on) return;
    const move = (e: MouseEvent) => {
      const view = sh!.view();
      const row = Math.floor((e.clientY - view.y) / view.rowPx) + view.top;
      const list = sh!.marks.commands();
      const hit = list.map((c, i) => ({ c, status: statusOf(c, i === list.length - 1), ...commandRows(c, view.cursor) }))
        .find(d => d.status !== 'typing' && row >= d.from && row <= d.to);
      setHover(hit?.c.id ?? null);
    };
    const leave = () => setHover(null);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
    return () => { el.removeEventListener('mousemove', move); el.removeEventListener('mouseleave', leave); };
  }, [area, sh, on]);

  // Ctrl ↑ / Ctrl ↓, typed in the terminal or on a handle: the previous or next command, scrolled to, its handle focused.
  const step = (dir: -1 | 1): boolean => {
    if (!sh) return false;
    const view = sh.view();
    if (!sh.marks.active || !view.normal) return false;
    const list = sh.marks.commands().filter((c, i, l) => statusOf(c, i === l.length - 1) !== 'typing');
    if (!list.length) return false;
    const at = focus === null ? -1 : list.findIndex(c => c.id === focus);
    let next: ShellCommand | undefined;
    if (at < 0) next = dir < 0 ? list[list.length - 1] : undefined;
    else next = list[at + dir];
    if (!next) { setFocus(null); if (dir > 0) { sh.scrollTo(view.length); surface.focus(); } return true; }
    sh.scrollTo(next.prompt.line);
    toFocus.current = next.id;
    setFocus(next.id);
    redraw();
    return true;
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!sh) return;
    sh.onMarkKey(dir => stepRef.current(dir));
    return () => sh.onMarkKey(null);
  }, [sh]);

  if (!on || !v) return null;
  const now = Date.now();
  const reader = { line: (n: number, start?: number, end?: number) => sh!.line(n, start, end) };
  /** Its duration; none when its start is unknown (no C: bash with its own DEBUG trap). */
  const dur = (c: ShellCommand) => (c.startedAt === null ? undefined : fmtDur(Math.max(0, (c.endedAt ?? now) - c.startedAt), lang));
  /** The menu's header and the handle's tooltip: « Code de sortie 1 · 3,2 s », « En cours · 12 s » (« · durée » only when known); a
   *  command ended with no known code: no header (design-ux 11:32Z, qitem-20261113113246). */
  const head = (d: Drawn): string | null => d.status === 'running' ? m.running(dur(d.c)) : d.c.code != null ? m.exitCode(d.c.code, dur(d.c)) : null;
  /** The command as typed, cut: the handle's tooltip when there is no header. */
  const cmdTip = (c: ShellCommand) => { const x = commandText(c, reader); return x.length > 80 ? `${x.slice(0, 79)}…` : x; };
  const tip = (d: Drawn) => head(d) ?? cmdTip(d.c);
  // The xterm's first row, from the layer's top (the screen's padding, a banner above).
  const origin = v.y - (area.current?.getBoundingClientRect().top ?? v.y);
  const y = (line: number) => origin + (line - v.top) * v.rowPx;
  const bottom = v.top + v.rows - 1;
  const shown = ran.filter(d => d.to >= v.top && d.from <= bottom);
  const active = shown.find(d => d.c.id === (menu?.id ?? focus ?? hover));
  // « Relancer » types into the prompt: only an empty one, known (never after a draft, which it would run with it, review #299).
  const draft = draftText(sh!.marks, reader, v.cursor);
  // A command on several lines goes as one bracketed paste; a shell without it would run its lines one by one: greyed then
  // (design-ux 11:41Z, qitem-20261113114102).
  const rerunnable = (c: ShellCommand) => { const x = typeable(commandText(c, reader)); return !!x && (!x.includes('\n') || sh!.bracketed()); };
  const canRerun = !sh!.marks.running() && draft === '';
  const area_h = v.rows * v.rowPx;
  const failed = ran.filter(d => d.status === 'failed');

  const copy = (text: string) => { void navigator.clipboard.writeText(text).catch(() => undefined); };
  const onHandleKey = (e: ReactKeyboardEvent) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); step(e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'Escape' && !menu) { e.preventDefault(); setFocus(null); surface.focus(); }
  };

  return (
    <div className="shell-marks">
      {shown.map(d => {
        if (d.status !== 'failed' && d.status !== 'running') return null;
        const top = Math.max(d.from, v.top), end = Math.min(d.to, bottom);
        return <span key={`l${d.c.id}`} className={`shell-mark-line ${d.status}`} style={{ top: y(top), height: (end - top + 1) * v.rowPx }} />;
      })}
      {active && (() => {
        const top = Math.max(active.from, v.top), end = Math.min(active.to, bottom);
        return <span className="shell-mark-band" style={{ top: y(top), height: (end - top + 1) * v.rowPx }} />;
      })()}
      {active && active.from >= v.top && (
        <Menu open={menu?.id === active.c.id} onOpenChange={o => { if (!o) setMenu(null); }} label={tip(active)} className="shell-mark-handle-wrap" menuClassName="session-menu shell-mark-menu"
          at={menu?.at} trigger={tr => (
            <button type="button" ref={el => { tr.ref.current = el; if (el && toFocus.current === active.c.id) { toFocus.current = null; el.focus(); } }} aria-haspopup={tr['aria-haspopup']} aria-expanded={tr['aria-expanded']}
              className="shell-mark-handle" style={{ top: y(active.from) + (v.rowPx - 16) / 2 }} title={tip(active)} aria-label={tip(active)}
              // Leaving for its own menu keeps it; leaving elsewhere (the terminal clicked) drops the keyboard's command.
              onBlur={e => { if (!(e.relatedTarget instanceof Node && e.currentTarget.parentElement?.contains(e.relatedTarget))) setFocus(f => (f === active.c.id ? null : f)); }}
              onKeyDown={onHandleKey}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu(x => (x ? null : { id: active.c.id, at: { x: r.right - 248, y: r.bottom + 4 } })); }}>⋯</button>
          )}>
          {head(active) !== null && <>
            <div className={`session-menu-head shell-mark-head${active.status === 'failed' ? ' failed' : ''}`}><strong>{head(active)}</strong></div>
            <hr />
          </>}
          <MenuItem onSelect={() => copy(commandText(active.c, reader))}>{m.copyCommand}</MenuItem>
          <MenuItem onSelect={() => copy(outputText(active.c, reader, v.cursor))}>{m.copyOutput}</MenuItem>
          {/* Typed, never sent: E carries no nonce and a program can forge it, so the person confirms with Entrée (dev-back 11:36Z). */}
          <MenuItem disabled={!canRerun || !rerunnable(active.c)} onSelect={() => {
            const cmd = typeable(commandText(active.c, reader));
            if (cmd.includes('\n')) sh!.paste(cmd); else sh!.type(cmd);
            // The prompt in view, the keyboard on the terminal: the person runs it with Entrée, or erases it.
            sh!.scrollTo(sh!.view().length);
            setFocus(null);
            surface.focus();
          }}>{m.runAgain}</MenuItem>
        </Menu>
      )}
      {area_h > 0 && failed.map(d => (
        <button key={`f${d.c.id}`} type="button" className="shell-mark-fail" tabIndex={-1} aria-label={tip(d)} title={tip(d)}
          style={{ top: origin + Math.min(area_h - 3, (d.from / Math.max(1, v.length)) * area_h) }} onClick={() => sh!.scrollTo(d.from)} />
      ))}
    </div>
  );
}
