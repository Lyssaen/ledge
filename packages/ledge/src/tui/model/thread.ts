import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { turns, type Turn } from '@ledge/ui/thread/turns';
import { target, SPINNER } from '@ledge/ui/thread/tools';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { clock, oneLine } from './time.js';

/** A piece of a line, with its colour. */
export type Seg = { text: string; color?: string; bold?: boolean };
export type Line = Seg[];

/** The most diff lines shown under one file. */
export const DIFF_MAX = 30;

/** `text` cut into lines of at most `width` cells, at spaces when it can; its own newlines kept. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  const w = Math.max(10, width);
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    let rest = [...raw];
    if (rest.length === 0) { out.push(''); continue; }
    while (rest.length > w) {
      const head = rest.slice(0, w);
      const space = head.lastIndexOf(' ');
      const at = space > 0 ? space : w;
      out.push(rest.slice(0, at).join('').trimEnd());
      rest = [...rest.slice(at).join('').trimStart()];
    }
    out.push(rest.join(''));
  }
  return out;
}

/** Lines added and removed by a unified diff (its headers left out). */
export function diffCount(diff: string | undefined): { add: number; del: number } {
  let add = 0, del = 0;
  for (const l of (diff ?? '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) add++; else if (l.startsWith('-')) del++;
  }
  return { add, del };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

function toolLines(it: ToolItem, o: Opts): Line[] {
  const status = it.status === 'success' ? { g: o.g.ok, c: C.green } : it.status === 'failed' ? { g: o.g.fail, c: C.red }
    : it.status === 'running' ? { g: o.ascii ? o.g.live : SPINNER[Math.floor(o.now / 1000) % SPINNER.length]!, c: C.blue } : { g: '·', c: C.faint };
  const counts = it.files.reduce((a, f) => { const n = diffCount(f.diff); return { add: a.add + n.add, del: a.del + n.del }; }, { add: 0, del: 0 });
  const took = it.durationMs !== undefined ? seconds(it.durationMs) : it.status === 'running' ? seconds(Math.max(0, o.now - Date.parse(it.at))) : '';
  const line: Line = [{ text: '  ' }, { text: status.g, color: status.c }, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }, { text: target(it), color: C.fg }];
  if (counts.add || counts.del) line.push({ text: '  ' }, { text: `+${counts.add}`, color: C.green }, { text: ' ' }, { text: `−${counts.del}`, color: C.red });
  if (took) line.push({ text: `  ${took}`, color: C.faint });
  const out: Line[] = [line];
  if (it.status === 'failed' && it.error) out.push([{ text: `      ${oneLine(it.error).slice(0, 200)}`, color: C.red }]);
  if (o.diffs) for (const f of it.files) {
    const lines = (f.diff ?? '').split('\n').filter(l => l && !l.startsWith('+++') && !l.startsWith('---'));
    for (const l of lines.slice(0, DIFF_MAX)) out.push([{ text: `      ${o.g.bar} `, color: C.faint }, { text: l, color: l.startsWith('+') ? C.green : l.startsWith('-') ? C.red : C.faint }]);
    if (lines.length > DIFF_MAX) out.push([{ text: `      ${o.g.bar} ${o.g.ellipsis} ${lines.length - DIFF_MAX}`, color: C.faint }]);
  }
  return out;
}

interface Opts { t: Messages; g: Glyphs; now: number; width: number; diffs: boolean; ascii?: boolean }

function itemLines(it: ThreadItem, o: Opts): Line[] {
  const { t, g, width } = o;
  const body = (text: string, color: string) => wrap(text, width - 2).map(l => [{ text: `  ${l}`, color }]);
  switch (it.kind) {
    case 'prompt': return [[{ text: t.session.you, color: C.coral, bold: true }, { text: `  ${clock(it.at)}`, color: C.faint }], ...body(it.text, C.fg)];
    case 'message': return body(it.text, C.dim);
    case 'reply': return body(it.text, C.fg);
    case 'tool': return toolLines(it, o);
    case 'permission': {
      const d = it.decision ? ` ${g.arrow} ${it.decision}` : '';
      return [[{ text: '  ' }, { text: g.approval, color: C.red }, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }, { text: oneLine(it.text), color: C.fg }, { text: d, color: C.faint }]];
    }
    case 'helper': return [[{ text: `  ${g.helper} `, color: C.violet }, { text: it.agentType ?? '', color: C.dim }, { text: ` ${oneLine(it.task)}`, color: C.violet }, { text: `  ${it.state === 'working' ? t.state.working : t.session.helperDone}`, color: C.faint }]];
    case 'sent': return [[{ text: `  ${g.message} `, color: C.violet }, { text: `${t.session.sentTo} `, color: C.dim }, { text: it.to, color: C.fg, bold: true }, { text: `  « ${oneLine(it.summary ?? it.text)} »`, color: C.dim }, { text: `  ${t.session.sent[it.status]}`, color: it.status === 'failed' ? C.red : C.green }]];
    case 'received': return [[{ text: `  ${g.message} `, color: C.violet }, { text: `${t.session.receivedFrom} `, color: C.dim }, { text: it.from, color: C.fg, bold: true }, { text: `  « ${oneLine(it.text)} »`, color: C.dim }]];
    // A task the session handed over (#92): its plain line says to whom; the summary alone is the title.
    case 'notice': return [[{ text: `  · ${oneLine(it.outgoing ? it.text : it.summary ?? it.text)}`, color: C.faint }]];
  }
}

/** One folded turn: when it started, what was asked, how many actions and files, how it ended. */
export function foldedLine(turn: Turn, o: Pick<Opts, 't' | 'g'>): Line {
  const tools = turn.items.filter((i): i is ToolItem => i.kind === 'tool');
  const files = new Set(tools.flatMap(i => i.status === 'success' ? i.files.map(f => f.path) : []));
  const parts = [turn.prompt ? oneLine(turn.prompt.text) : '', o.t.session.actions(tools.length), ...(files.size ? [o.t.session.files(files.size)] : []), ...(turn.reply ? [oneLine(turn.reply.text)] : [])].filter(Boolean);
  return [{ text: `${o.g.folded} ${clock(turn.prompt?.at ?? turn.items[0]?.at ?? new Date(0).toISOString())}  `, color: C.faint }, { text: parts.join(' · '), color: C.faint }];
}

/** The session's main thread as lines: past turns folded unless unfolded, the last one in full. */
export function threadLines(items: ThreadItem[], o: Opts & { unfolded: boolean }): Line[] {
  const all = turns(items);
  const out: Line[] = [];
  all.forEach((turn, i) => {
    const last = i === all.length - 1;
    if (!last && !o.unfolded) { out.push(foldedLine(turn, o)); return; }
    if (out.length) out.push([{ text: '' }]);
    for (const it of turn.items) out.push(...itemLines(it, o));
  });
  return out;
}
