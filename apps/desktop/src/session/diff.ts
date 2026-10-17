export type DiffLine = { t: 'ctx' | 'add' | 'del'; o?: number; n?: number; text: string };
export interface Hunk { o?: number; n?: number; ctx: string; lines: DiffLine[] }
export interface ParsedDiff { hunks: Hunk[]; plus: number; minus: number; cut: boolean }

const NUMBERED = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
const BARE = /^@@ ?(.*)$/;

/** The three shapes of daemon/files.ts: numbered hunks, Codex hunks without numbers, and header-less `- ` / `+ ` lines (Claude).
 *  A last `…` line is the daemon's 80-line cut. */
export function parseDiff(diff: string): ParsedDiff {
  const raw = diff.split('\n');
  if (raw[raw.length - 1] === '') raw.pop();
  const cut = raw[raw.length - 1] === '…';
  if (cut) raw.pop();
  const out: ParsedDiff = { hunks: [], plus: 0, minus: 0, cut };
  if (!diff) return out;
  let cur: Hunk | null = null;
  let headed = false;
  // Header-less: Claude writes `+ ${text}` on every line; anything else is glued (Codex Add File).
  const claude = !raw.some(l => BARE.test(l)) && raw.every(l => (l[0] !== '+' && l[0] !== '-') || l[1] === ' ');
  let o = 0;
  let n = 0;
  for (const line of raw) {
    const num = NUMBERED.exec(line);
    const bare = num ? null : BARE.exec(line);
    if (num || bare) {
      cur = num ? { o: Number(num[1]), n: Number(num[2]), ctx: num[3]!, lines: [] } : { ctx: bare![1]!, lines: [] };
      out.hunks.push(cur);
      headed = true;
      o = cur.o ?? 0;
      n = cur.n ?? 0;
      continue;
    }
    const numbered = cur?.o !== undefined;
    const sign = line[0];
    if (sign !== '+' && sign !== '-' && !(headed && (sign === ' ' || line === ''))) continue;
    if (!cur) { cur = { ctx: '', lines: [] }; out.hunks.push(cur); }
    const text = headed || !claude ? line.slice(1) : line.slice(2);
    if (sign === '+') { cur.lines.push({ t: 'add', ...(numbered ? { n } : {}), text }); n++; out.plus++; }
    else if (sign === '-') { cur.lines.push({ t: 'del', ...(numbered ? { o } : {}), text }); o++; out.minus++; }
    else { cur.lines.push({ t: 'ctx', ...(numbered ? { o, n } : {}), text }); o++; n++; }
  }
  return out;
}

export type DiffRow =
  | { kind: 'hunk'; label: string; ctx: string }
  | { kind: 'line'; line: DiffLine }
  | { kind: 'gap'; from: number; to: number }
  | { kind: 'fold'; key: string; hidden: number };

const KEEP = 3;

const span = (h: Hunk) => ({
  oc: h.lines.filter(l => l.t !== 'add').length,
  nc: h.lines.filter(l => l.t !== 'del').length
});

/** The mockup's DiffView: three unchanged lines kept on each side of a change; a run hiding at least three folds, unless its key is in `shown`. */
export function diffRows(d: ParsedDiff, shown: ReadonlySet<string>): DiffRow[] {
  const rows: DiffRow[] = [];
  d.hunks.forEach((h, hi) => {
    const prev = d.hunks[hi - 1];
    if (prev?.o !== undefined && h.o !== undefined) {
      const from = prev.o + span(prev).oc;
      if (h.o - 1 >= from) rows.push({ kind: 'gap', from, to: h.o - 1 });
    }
    if (h.o !== undefined) {
      const { oc, nc } = span(h);
      rows.push({ kind: 'hunk', label: `@@ -${h.o},${oc} +${h.n},${nc} @@`, ctx: h.ctx });
    } else if (h.ctx) rows.push({ kind: 'hunk', label: '', ctx: h.ctx });
    for (let i = 0; i < h.lines.length;) {
      const line = h.lines[i]!;
      if (line.t !== 'ctx') { rows.push({ kind: 'line', line }); i++; continue; }
      let end = i;
      while (end < h.lines.length && h.lines[end]!.t === 'ctx') end++;
      const before = i > 0 ? KEEP : 0;
      const after = end < h.lines.length ? KEEP : 0;
      const hidden = end - i - before - after;
      const key = `${hi}:${i + before}`;
      if (hidden < KEEP || shown.has(key)) h.lines.slice(i, end).forEach(l => rows.push({ kind: 'line', line: l }));
      else {
        h.lines.slice(i, i + before).forEach(l => rows.push({ kind: 'line', line: l }));
        rows.push({ kind: 'fold', key, hidden });
        h.lines.slice(end - after, end).forEach(l => rows.push({ kind: 'line', line: l }));
      }
      i = end;
    }
  });
  return rows;
}
