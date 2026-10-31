import type { ThreadItem } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { pad, row, type Line } from './cells.js';
import { markdownLines } from './markdown.js';
import { toolLines } from './thread.js';
import { clock, oneLine, took } from './time.js';

/** An OMP session's thread drawn as a terminal (spec « OMP », screen « Une session OMP »): `❯` for what was asked, `π name`
 *  for its words, one line per action (a running one with its time ticking), diffs under a bar, the helpers it started, and
 *  while it works « ◐ écrit… · 41 s ». OMP's reasoning is not in the thread: nothing is drawn for it. Oldest first; the pane
 *  shows the bottom. */
export function ompPaneLines(items: readonly ThreadItem[], o: { t: Messages; g: Glyphs; width: number; now: number; name: string; working: boolean }): Line[] {
  const { t, g, width, now } = o;
  const out: Line[] = [];
  const blank = () => { if (out.length && out[out.length - 1]!.length) out.push([]); };
  const spoke = new Set<number>();
  let last: ThreadItem | undefined;
  for (const it of items) {
    if (it.helperId) continue;
    switch (it.kind) {
      case 'prompt':
        blank();
        out.push(...row([{ text: `${g.cursor} `, color: C.coral }], [{ text: it.text.replace(/\r/g, ''), color: C.fg, bold: true }], null, width, { indent: 2 }));
        out.push([{ text: `  ${t.omp.you} · ${clock(it.at)}`, color: C.faint }], []);
        break;
      case 'message': case 'reply': {
        if (last && last.kind !== 'message' && last.kind !== 'reply') blank();
        if (!spoke.has(it.turn)) {
          spoke.add(it.turn);
          out.push([{ text: g.omp, color: C.omp }, { text: ` ${o.name}`, color: C.fg, bold: true }, { text: ` · ${clock(it.at)}`, color: C.faint }]);
        }
        out.push(...markdownLines(it.text, { width: width - 2, g, color: C.fg }).map(l => [pad(2), ...l]));
        break;
      }
      case 'tool': {
        const lines = toolLines(it, { t, g, width, now, diffs: true, cap: n => n });
        // The mockup's spinner is a still ◐ in blue; the running time beside it ticks.
        if (it.status === 'running') lines[0] = lines[0]!.map(s => (s.live && 'spin' in s.live ? { text: g.running, color: C.blue } : s));
        out.push(...lines);
        break;
      }
      case 'helper': {
        const done = it.state !== 'working';
        out.push(...row([{ text: `  ${g.helper} `, color: C.violet }], [{ text: [it.agentType, oneLine(it.task)].filter(Boolean).join(' · '), color: C.violet }],
          done ? [{ text: `${g.ok} ${t.session.helperDone}`, color: C.green }] : [{ text: t.state.working, color: C.blue }], width, { indent: 4, max: 2, more: { text: ' …', color: C.faint } }));
        break;
      }
      default: continue;
    }
    last = it;
  }
  if (o.working && last) {
    const since = Date.parse(last.at);
    blank();
    out.push([pad(2), { text: g.running, color: C.blue }, { text: ` ${t.omp.writing} · `, color: C.faint },
      { text: took(Math.max(0, now - since), t.time.decimal), color: C.faint, live: { since, pad: 0 } }]);
  }
  return out;
}
