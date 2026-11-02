import type { Origin, RoleDetail, RoleProfile, RoleSeat, RoleSummary, StartupEntry } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cells, cut, wrapSegs, type Line, type Seg } from './cells.js';
import { markdownLines } from './markdown.js';

/**
 * OpenRig › Rôles in the TUI (docs/mockups/ledge-openrig-roles-tui.html), as lines: the screen only draws them. Read-only.
 * Each value carries its provenance in the margin (a coloured rail) and in words at the right.
 */

export type Prov = 'here' | 'inh' | 'abs' | 'unk';
export const provOf = (o: Origin): Prov => (o.kind === 'here' ? 'here' : o.kind === 'inherited' ? 'inh' : o.kind === 'absent' ? 'abs' : 'unk');
export const provColor = (k: Prov): string => ({ here: C.fg, inh: C.blue, abs: C.faint, unk: C.yellow })[k];
/** The rail: here is grey (not the yellow of unknown). */
const railColor = (k: Prov): string => (k === 'here' ? C.dim : provColor(k));
const glyph = (k: Prov, g: Glyphs) => ({ here: g.pvHere, inh: g.pvInh, abs: g.pvAbs, unk: g.pvUnk })[k];

/** « ● ici », « ↳ membre dev.front », « ○ non déclaré », « ? non exposé »; `short` (80 columns): the glyph and the source's
 *  last word (« ↳ dev.front », « ↳ shared »). A launch says « lancement », its source (runtime_default…) is in the value. */
export function provText(o: Origin, t: Messages, g: Glyphs, short = false): string {
  const r = t.roles, k = provOf(o);
  if (o.kind === 'here') return short ? g.pvHere : `${g.pvHere} ${r.here}`;
  if (o.kind === 'absent') return short ? g.pvAbs : `${g.pvAbs} ${r.abs}`;
  if (o.kind === 'unknown') return `${g.pvUnk} ${r.why[o.why] ?? o.why}`;
  const from = r.from_[o.from] ?? o.from;
  const ref = o.from === 'launch' ? undefined : o.ref;
  return `${glyph(k, g)} ${short ? ref ?? from : [from, ref].filter(Boolean).join(' ')}`;
}

// ── The list ──

export type ListItem = { kind: 'role'; role: RoleSummary } | { kind: 'builtin' };
export function matches(r: RoleSummary, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || [r.name, r.description ?? '', ...r.skills, ...r.startupFiles].some(x => x.toLowerCase().includes(s));
}
/** What the list shows, in order: « Mes specs », then the « Livrés avec OpenRig » header and, unfolded, its roles. */
export function listItems(roles: readonly RoleSummary[], query: string, builtinOpen: boolean): { mine: RoleSummary[]; builtin: RoleSummary[]; items: ListItem[] } {
  const by = (a: RoleSummary, b: RoleSummary) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const kept = roles.filter(r => matches(r, query)).sort(by);
  const mine = kept.filter(r => r.source === 'user'), builtin = kept.filter(r => r.source === 'builtin');
  const open = builtinOpen || query.trim() !== '';
  return { mine, builtin, items: [...mine.map(role => ({ kind: 'role' as const, role })), ...(builtin.length ? [{ kind: 'builtin' as const }] : []), ...(open ? builtin.map(role => ({ kind: 'role' as const, role })) : [])] };
}

/** The list's lines; `sel` the item selected, `narrow` adds each role's summary under it. */
export function listLines(roles: readonly RoleSummary[], o: { query: string; searching: boolean; builtinOpen: boolean; sel: number; width: number; narrow: boolean; focused: boolean }, t: Messages, g: Glyphs): { lines: Line[]; selLine: number } {
  const r = t.roles, w = o.width;
  const { mine, builtin, items } = listItems(roles, o.query, o.builtinOpen);
  const lines: Line[] = [];
  lines.push(o.searching || o.query ? [{ text: '/ ', color: C.coral }, { text: o.query, color: C.fg }, ...(o.searching ? [{ text: '▏', color: C.coral }] : [])] : [{ text: r.search, color: C.faint }]);
  lines.push([]);
  let selLine = 0, i = 0;
  const roleLine = (x: RoleSummary) => {
    const s = i === o.sel;
    const live = x.seats > 0;
    const ct = x.importOnly ? r.imported : live ? r.seats(x.seats) : x.runtime === 'codex' ? 'Codex' : x.runtime === 'claude-code' ? 'Claude Code' : '';
    const right: Line = live ? [{ text: `${g.working} `, color: x.running > 0 ? C.green : C.faint }, { text: ct, color: C.dim }] : [{ text: ct, color: C.faint }];
    const name = cut([{ text: x.name, color: x.importOnly ? C.faint : C.fg, bold: s }], Math.max(4, w - 3 - cells(right.map(y => y.text).join(''))));
    const used = 1 + cells(name.map(y => y.text).join('')) + cells(right.map(y => y.text).join(''));
    const bg = s ? C.sel : undefined;
    const withBg = (l: Line) => l.map(y => (bg ? { ...y, bg } : y));
    if (s) selLine = lines.length;
    lines.push(withBg([{ text: s ? '▌' : ' ', color: s && o.focused ? C.coral : s ? C.dim : C.faint }, ...name, { text: ' '.repeat(Math.max(1, w - used)) }, ...right]));
    if (o.narrow && x.description) lines.push(cut([{ text: `   ${x.description}`, color: C.faint }], w));
    i++;
  };
  if (!items.length) lines.push(...wrapSegs([{ text: o.query ? r.noResults(o.query.trim()) : r.none, color: C.dim }], w));
  if (mine.length) { lines.push([{ text: r.mine, color: C.dim }, { text: ` · ${mine.length}`, color: C.faint }]); mine.forEach(roleLine); }
  if (builtin.length) {
    if (mine.length) lines.push([]);
    const s = i === o.sel;
    if (s) selLine = lines.length;
    const open = o.builtinOpen || o.query.trim() !== '';
    const bg = s ? C.sel : undefined;
    lines.push([{ text: s ? '▌' : ' ', color: s && o.focused ? C.coral : C.faint, ...(bg ? { bg } : {}) }, { text: `${open ? g.unfolded : g.folded} ${r.builtin}`, color: C.dim, ...(bg ? { bg } : {}) }, { text: ` · ${builtin.length}`, color: C.faint, ...(bg ? { bg } : {}) }]);
    i++;
    if (open) builtin.forEach(roleLine);
  }
  return { lines, selLine };
}

// ── The detail ──

export const seatKey = (s: { rig: string; logicalId: string }) => `${s.rig}/${s.logicalId}`;
/** « Vu »: the spec, then the seats in a stable order. */
export const lenses = (d: RoleDetail): Array<RoleSeat | null> => [null, ...[...d.seats].sort((a, b) => a.rig.localeCompare(b.rig) || a.logicalId.localeCompare(b.logicalId))];
export const profileOf = (d: RoleDetail, seat: RoleSeat | null): RoleProfile | undefined => d.profiles.find(p => p.name === seat?.profile) ?? d.profiles.find(p => p.name === 'default') ?? d.profiles[0];
const base = (p: string) => p.slice(p.replace(/\/+$/, '').lastIndexOf('/') + 1);
const isRoleDoc = (e: StartupEntry) => e.kind === 'file' && (e.orientation === 'role' || base(e.path ?? '') === 'role.md');
export const tilde = (p: string): string => p.replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^\/root(?=\/|$)/, '~');

/** The Role tab: role.md first, then the role's other files; from a seat, what OpenRig lists for it. */
export function roleDocs(d: RoleDetail, seat: RoleSeat | null): StartupEntry[] {
  if (seat) return seat.roleDocs;
  const files = (profileOf(d, null)?.startup ?? []).filter(e => e.kind === 'file');
  const role = files.filter(isRoleDoc), rest = files.filter(e => !isRoleDoc(e));
  if (!role.length && d.role) return [{ kind: 'file', path: d.role.path, absolutePath: d.role.absolutePath, layer: 'agent', layerInferred: false, delivery: 'auto', appliesOn: [], origin: d.role.origin }, ...rest];
  return [...role, ...rest];
}
export type Piece = { kind: 'harness' } | { kind: 'entry'; entry: StartupEntry };
export function pieces(d: RoleDetail, seat: RoleSeat | null): Piece[] {
  const own = profileOf(d, seat)?.startup ?? [];
  if (!seat) return own.map(entry => ({ kind: 'entry', entry }));
  const entries = seat.live?.startup ?? [...own, ...seat.memberStartup];
  return [...(d.unavailable.includes('harness_prompt') ? [{ kind: 'harness' as const }] : []), ...entries.map(entry => ({ kind: 'entry' as const, entry }))];
}
export const isMissing = (e: StartupEntry) => e.delivered === false || (e.origin.kind === 'unknown' && e.origin.why === 'missing_from_guidance');
export function pieceTitle(e: StartupEntry, t: Messages): string {
  const p = t.roles.pieces, name = base(e.path ?? '');
  if (e.kind === 'action') return e.builtin === 'session_identity' ? p.identity! : e.builtin ?? e.delivery;
  if (isRoleDoc(e)) return `${p.role} · ${e.path}`;
  const known: Record<string, string | undefined> = { 'CULTURE-default.md': p.cultureDefault, 'openrig-start.md': p.start, 'openrig-onboarding-01.md': p.onb1, 'openrig-onboarding-02.md': p.onb2, 'openrig-seat-skills.md': `${p.skills} · ${name}` };
  if (known[name]) return known[name]!;
  if (e.layer === 'culture' || name === 'CULTURE.md') return `${p.culture} · ${name}`;
  if (e.layer === 'member') return `${p.scope} · ${e.path}`;
  return e.path ?? name;
}
export const formatSize = (bytes: number | undefined, lang: string): string => {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} ${lang === 'fr' ? 'o' : 'B'}`;
  const k = (bytes / 1024).toFixed(1);
  return lang === 'fr' ? `${k.replace('.', ',')} ko` : `${k} kB`;
};

/** A line with its rail in the margin (the margin is the box's left padding: `rail` is drawn in its first cell). */
export type Row = { line: Line; rail?: Prov; sel?: boolean; fold?: string };

/** The detail's head: the description, the file and its repository copy, « vu », the tabs, a rule. */
export function headRows(d: RoleDetail | null, summary: RoleSummary, o: { seat: RoleSeat | null; tab: number; width: number; narrow: boolean; seats: Array<RoleSeat | null> }, t: Messages): Line[] {
  const r = t.roles, w = o.width;
  const out: Line[] = [];
  if (summary.description) out.push(...wrapSegs([{ text: summary.description, color: C.fg }], w));
  const file = tilde(d?.file.path ?? summary.path);
  const repo = d?.file.copies.find(c => c.kind === 'repo');
  out.push(o.narrow || !repo ? cut([{ text: file, color: C.faint }], w) : cut([{ text: file, color: C.faint }, { text: `  ${repo.identical ? r.same : r.differs}`, color: repo.identical ? C.green : C.yellow }], w));
  if (!summary.importOnly) {
    const l: Line = [{ text: `${r.seen}  `, color: C.dim }];
    for (const s of o.seats) {
      const lab = s ? `${r.from} ${s.logicalId}` : r.spec;
      l.push(s === o.seat ? { text: `‹ ${lab} ›`, color: C.fg, bold: true } : { text: `  ${lab}  `, color: C.dim }, { text: ' ' });
    }
    out.push(cut(l, w));
  }
  out.push([]);
  const tabs = summary.importOnly ? [1, 3] : [0, 1, 2, 3];
  const tl: Line = [];
  for (const i of tabs) {
    const n = i === 0 && d ? ` ${roleDocs(d, o.seat).length}` : i === 2 && d ? ` ${pieces(d, o.seat).length}` : '';
    const lab = `${r.tabs[i]}${i === 2 || i === 0 ? n : ''}`;
    tl.push(i === o.tab ? { text: `‹ ${lab} ›`, color: C.coral, bold: true } : { text: `  ${lab}  `, color: C.dim }, { text: ' ' });
  }
  out.push(cut(tl, w));
  out.push([{ text: '─'.repeat(Math.max(0, w)), color: C.line }]);
  return out;
}

export type Files = Record<string, { content?: string; error?: string } | undefined>;

/** A file's text, rendered or raw, each line with its rail. */
function fileRows(e: StartupEntry, files: Files, o: { width: number; raw: boolean; g: Glyphs }, t: Messages): Row[] {
  const r = t.roles, f = e.absolutePath ? files[e.absolutePath] : { error: 'missing' };
  const prov = provOf(e.origin);
  if (!f) return [{ line: [{ text: r.reading, color: C.faint }] }];
  if (f.error || f.content === undefined) return [{ line: [{ text: r.fileMissing, color: C.yellow }], rail: 'unk' }, { line: [{ text: tilde(e.absolutePath ?? e.path ?? ''), color: C.faint }] }];
  const lines = o.raw || !(e.path ?? '').endsWith('.md') ? f.content.split('\n').map(l => [{ text: l, color: C.fg }] as Line) : markdownLines(f.content, { width: o.width, g: o.g, color: C.fg });
  return lines.map(line => ({ line, rail: prov }));
}

export function roleRows(d: RoleDetail, seat: RoleSeat | null, files: Files, o: { width: number; raw: boolean; narrow: boolean; g: Glyphs; lang: string }, t: Messages): Row[] {
  const r = t.roles, w = o.width;
  const docs = roleDocs(d, seat);
  if (!docs.length) return [
    { line: [{ text: 'guidance/role.md', color: C.fg, bold: true }, { text: `  ${o.g.pvAbs} ${r.abs}`, color: C.faint }], rail: 'abs' }, { line: [] },
    { line: [{ text: r.noRole, color: C.dim }] }, { line: [{ text: r.noRole2, color: C.faint }] }
  ];
  const out: Row[] = [];
  if (docs.length > 1) out.push({ line: [{ text: r.multi(docs.length), color: C.dim }] }, { line: [] });
  docs.forEach((e, i) => {
    if (i > 0) out.push({ line: [{ text: '─'.repeat(w), color: C.line }] });
    const p = provText(e.origin, t, o.g, o.narrow);
    const size = formatSize(e.size ?? (e.absolutePath ? files[e.absolutePath]?.content?.length : undefined), o.lang);
    const head: Line = [{ text: e.path ?? '', color: C.fg, bold: true }, { text: `  ${p}`, color: provColor(provOf(e.origin)) }];
    const used = cells(head.map(x => x.text).join(''));
    out.push({ line: [...head, { text: ' '.repeat(Math.max(1, w - used - cells(size))) }, { text: size, color: C.faint }] });
    if (!o.narrow) out.push({ line: [{ text: r.delivered(e.delivery === 'send_text', e.required), color: C.faint }] });
    out.push({ line: [] });
    out.push(...fileRows(e, files, o, t));
  });
  return out;
}

/** A parameter's row: label, value, provenance at the right; `fold` names a row ↵ unfolds. */
function param(label: string, value: Line, o: Origin | Prov, t: Messages, g: Glyphs, w: number, narrow: boolean, extra: Partial<Row> = {}): Row {
  const k = typeof o === 'string' ? o : provOf(o);
  const p = typeof o === 'string' ? `${({ here: g.pvHere, inh: g.pvInh, abs: g.pvAbs, unk: g.pvUnk })[k]} ${({ here: t.roles.here, inh: '', abs: t.roles.abs, unk: t.roles.unk })[k]}`.trim() : provText(o, t, g, narrow);
  const lw = narrow ? 16 : 19;
  const room = Math.max(4, w - lw - cells(p) - 2);
  const lab = cut([{ text: label, color: C.dim }], lw - 1);
  const val = cut(value, room);
  const usedL = cells(lab.map(x => x.text).join('')), usedV = cells(val.map(x => x.text).join(''));
  return { line: [...lab, { text: ' '.repeat(lw - usedL) }, ...val, { text: ' '.repeat(Math.max(1, w - lw - usedV - cells(p))) }, { text: p, color: provColor(k) }], rail: k, ...extra };
}
const v = (text: string, color = C.fg): Line => [{ text, color }];

export function paramRows(d: RoleDetail, seat: RoleSeat | null, files: Files, open: ReadonlySet<string>, o: { width: number; narrow: boolean; g: Glyphs }, t: Messages): Row[] {
  const r = t.roles, w = o.width, g = o.g, n = o.narrow;
  const P = (label: string, value: Line, origin: Origin | Prov, extra: Partial<Row> = {}) => param(label, value, origin, t, g, w, n, extra);
  const out: Row[] = [];
  const legend: Line = [];
  (['here', 'inh', 'abs', 'unk'] as const).forEach((k, i) => legend.push({ text: `${({ here: g.pvHere, inh: g.pvInh, abs: g.pvAbs, unk: g.pvUnk })[k]} ${r.legend[i]}`, color: provColor(k) }, { text: '   ' }));
  out.push({ line: legend }, { line: [] });
  const sec = (s: string) => out.push({ line: [{ text: s, color: C.dim, bold: true }] });
  if (d.summary.importOnly) {
    out.push({ line: v(r.importOnly, C.dim) }, { line: [] });
    if (d.importedBy.length) out.push(P(r.importedBy, v(d.importedBy.join(', ')), 'here'));
    for (const x of d.resources) out.push(P(`${x.category}`, v(`${x.id}${x.path ? ` · ${x.path}` : ''}`), x.origin));
    return out;
  }
  if (d.error) { out.push({ line: v(r.invalid(d.error.message, d.error.line), C.yellow), rail: 'unk' }); return out; }
  const prof = profileOf(d, seat);
  sec(r.sec.exec);
  if (seat) {
    out.push(P(r.p.runtime, v(seat.runtime.value ?? '—'), seat.runtime.origin));
    out.push(P(r.p.model, v(seat.model.value ?? '—'), seat.model.origin));
    const launchRef = seat.effort.origin.kind === 'inherited' && seat.effort.origin.from === 'launch' ? seat.effort.origin.ref : undefined;
    out.push(P(r.p.effort, v(seat.effort.value ?? (launchRef === 'runtime_default' ? r.runtimeDefault : '—')), seat.effort.origin));
    out.push(P(r.p.cwd, v(tilde(seat.cwd.value ?? '—')), seat.cwd.origin));
    const cul = seat.cultureFile.origin.kind === 'inherited' && seat.cultureFile.origin.path ? tilde(seat.cultureFile.origin.path) : seat.cultureFile.value ?? '—';
    out.push(P(r.p.culture, v(cul), seat.cultureFile.origin));
  } else if (prof) {
    out.push(P(r.p.runtime, v(prof.runtime.value ?? '—'), prof.runtime.origin));
    out.push(P(r.p.model, v(prof.model.value ?? r.noModel, prof.model.value ? C.fg : C.faint), prof.model.origin));
    out.push(P(r.p.effort, v(prof.effort.value ?? '—', prof.effort.value ? C.fg : C.faint), prof.effort.origin));
    if (d.profiles.length > 1) out.push(P(r.p.profile, v(`${prof.name}  (${d.profiles.map(p => p.name).join(', ')})`), 'here'));
  }
  for (const i of d.imports) out.push(P(r.p.imports, v(`${i.ref}  ${i.resolved ? g.ok : g.fail}`), i.resolved ? 'here' : { kind: 'unknown', why: 'unreadable' }));
  if (prof) {
    out.push({ line: [] }); sec(r.sec.uses);
    const u = prof.uses;
    const loadout = seat?.live?.skills;
    if (loadout) {
      out.push(P(r.p.skills, v(`${r.skillsProjected(loadout.length)} ${open.has('loadout') ? g.unfolded : g.folded}`), { kind: 'inherited', from: 'launch' }, { fold: 'loadout' }));
      if (open.has('loadout')) for (const s of loadout) out.push({ line: [{ text: ' '.repeat(n ? 16 : 19) }, { text: s.id, color: C.dim }], rail: 'inh' });
    }
    const list = (label: string, l: RoleDetail['profiles'][number]['uses']['skills'], what: (x: RoleDetail['resources'][number]) => string, fold?: (x: RoleDetail['resources'][number]) => string | undefined) => {
      if (!l.declared) { out.push(P(label, v('—', C.faint), 'abs')); return; }
      if (!l.items.length) { out.push(P(label, v(r.empty, C.faint), 'here')); return; }
      l.items.forEach((x, i) => {
        const na = !!(seat && x.runtime && seat.runtime.value && x.runtime !== seat.runtime.value);
        const key = fold?.(x);
        const row = P(i === 0 ? label : '', v(`${what(x)}${na ? ` · ${r.na(x.runtime!)}` : ''}${key ? ` ${open.has(key) ? g.unfolded : g.folded}` : ''}`, na ? C.faint : C.fg), x.origin, key ? { fold: key } : {});
        out.push(na ? { ...row, line: row.line.map(s => ({ ...s, color: C.faint })) } : row);
        if (key && open.has(key)) {
          const body = x.plugin ? x.plugin.skills.join(', ') : (x.absolutePath && files[x.absolutePath]?.content) ?? t.roles.reading;
          for (const bl of body.split('\n')) out.push({ line: cut([{ text: ' '.repeat(n ? 16 : 19) }, { text: bl, color: C.dim }], w), rail: 'inh' });
        }
      });
    };
    if (!loadout) list(r.p.skills, u.skills, x => x.id);
    list(r.p.guidance, u.guidance, x => x.id);
    list(r.p.subagents, u.subagents, x => x.id);
    list(r.p.plugins, u.plugins, x => `${x.id}${x.plugin ? ` · ${r.pluginCarries(x.plugin.skills.length, x.plugin.hooks)}` : ''}`, x => (x.plugin ? `plugin:${x.id}` : undefined));
    list(n ? r.p.rr80 : r.p.rr, u.runtimeResources, x => `${x.id.replace(/^[^:]+:/, '')}${x.target ? ` ${g.arrow} ${base(x.target) === x.target ? x.target : x.target.replace(/^<cwd>\//, '')}` : ''}`, x => (x.absolutePath ? `rr:${x.id}` : undefined));
    out.push(P(n ? r.p.merged80 : r.p.merged, v('—'), { kind: 'unknown', why: 'not_exposed' }));
    out.push({ line: [] }); sec(r.sec.start);
    const entries = [...prof.startup, ...(seat?.memberStartup ?? [])];
    entries.forEach((e, i) => out.push(P(i === 0 ? r.p.files : '', v(e.kind === 'action' ? e.builtin ?? e.value ?? '—' : [e.path, ...(n ? [] : [r.channel[e.delivery === 'send_text' ? 'send' : 'merge'], e.required ? r.req : ''])].filter(Boolean).join(' · ')), e.origin)));
  }
  if (d.seats.length && !seat) {
    out.push({ line: [] }); sec(r.sec.seats);
    for (const s of d.seats) out.push(P(s.logicalId, v(`${s.rig} · ${[s.runtime.value, s.model.value].filter(Boolean).join(' · ')}`), 'here'));
  }
  return out;
}

export function contextRows(d: RoleDetail, seat: RoleSeat | null, files: Files, at: number, o: { width: number; raw: boolean; narrow: boolean; g: Glyphs; lang: string }, t: Messages): { rows: Row[]; selRow: number } {
  const r = t.roles, w = o.width, g = o.g;
  const ps = pieces(d, seat);
  const rows: Row[] = [{ line: cut([{ text: seat ? r.ctxIntro : r.ctxSpec, color: C.dim }], w) }, { line: [] }];
  let selRow = 2;
  ps.forEach((p, i) => {
    const s = i === at;
    if (s) selRow = rows.length;
    const e = p.kind === 'entry' ? p.entry : null;
    const k: Prov = e ? provOf(e.origin) : 'unk';
    const gl = ({ here: g.pvHere, inh: g.pvInh, abs: g.pvAbs, unk: g.pvUnk })[k];
    const title = e ? pieceTitle(e, t) : r.harness;
    const ch = e ? (e.kind === 'action' || e.delivery === 'send_text' ? r.channel.send! : e.delivery === 'guidance_merge' ? base(e.into ?? 'CLAUDE.md') : e.delivery) : r.harnessCh;
    const src = !e ? r.why.not_exposed! : e.appliesOn.length === 1 && e.appliesOn[0] === 'fresh_start' ? r.firstStart : provText(e.origin, t, g, true).slice(2);
    const tw = o.narrow ? Math.max(10, w - 26) : 35;
    const line: Line = [
      { text: String(i).padStart(2), color: C.faint }, { text: ` ${gl} `, color: provColor(k) },
      ...cut([{ text: title, color: C.fg, bold: s }], tw), { text: ' '.repeat(Math.max(1, tw - cells(cut([{ text: title }], tw).map(x => x.text).join('')) + 1)) },
      { text: ch.padEnd(10).slice(0, 10), color: C.dim }, { text: formatSize(e?.size, o.lang).padEnd(8), color: C.faint },
      ...(o.narrow ? [] : cut([{ text: src, color: k === 'here' ? C.dim : provColor(k) }], Math.max(0, w - 5 - tw - 1 - 18)))
    ];
    rows.push({ line: s ? line.map(x => ({ ...x, bg: C.sel })) : line, rail: k, sel: s });
  });
  if (seat) rows.push({ line: cut([{ text: r.notShown, color: C.faint }], w) });
  rows.push({ line: [{ text: '─'.repeat(w), color: C.line }] });
  const p = ps[at];
  if (p?.kind === 'harness') rows.push({ line: [{ text: r.harness, color: C.fg, bold: true }, { text: `  ${g.pvUnk} ${r.why.not_exposed}`, color: C.yellow }], rail: 'unk' }, { line: [{ text: r.opaque, color: C.dim }] });
  else if (p?.kind === 'entry') {
    const e = p.entry;
    rows.push({ line: [{ text: e.kind === 'action' ? pieceTitle(e, t) : e.path ?? '', color: C.fg, bold: true }, { text: `  ${provText(e.origin, t, g, o.narrow)}`, color: provColor(provOf(e.origin)) }] });
    if (e.absolutePath) rows.push({ line: cut([{ text: `${tilde(e.absolutePath)} · ${r.delivered(e.delivery === 'send_text', e.required)}`, color: C.faint }], w) });
    if (isMissing(e)) rows.push({ line: cut([{ text: r.missing(base(e.path ?? ''), tilde(e.into ?? 'CLAUDE.md')), color: C.yellow }], w), rail: 'unk' });
    else if (e.kind === 'action') for (const l of (e.value ?? '').split('\n')) rows.push({ line: [{ text: l, color: C.fg }], rail: provOf(e.origin) });
    else rows.push(...fileRows(e, files, o, t));
  }
  return { rows, selRow };
}

/** The YAML tab: the file as is, its imports, from a seat its member; keys, values and comments coloured. */
export function yamlRows(d: RoleDetail, seat: RoleSeat | null, files: Files, o: { width: number }, t: Messages): Row[] {
  const r = t.roles, w = o.width;
  const out: Row[] = [];
  const yaml = (text: string, hl?: number) => text.split('\n').forEach((l, i) => {
    const m = /^(\s*-?\s*)([A-Za-z_][\w.-]*)(:)(.*)$/.exec(l);
    const line: Line = /^\s*#/.test(l) ? [{ text: l, color: C.faint }] : m ? [{ text: m[1]! }, { text: m[2]!, color: C.blue }, { text: m[3]!, color: C.dim }, { text: m[4]!, color: C.green }] : [{ text: l, color: C.fg }];
    out.push(hl === i + 1 ? { line: line.map(x => ({ ...x, bg: C.code })), rail: 'unk' } : { line });
  });
  const file = (path: string, title: Line, hl?: number) => {
    out.push({ line: cut(title, w) });
    const f = files[path];
    if (!f) out.push({ line: [{ text: r.reading, color: C.faint }] });
    else if (f.content === undefined) out.push({ line: [{ text: r.fileMissing, color: C.yellow }], rail: 'unk' });
    else yaml(f.content, hl);
    out.push({ line: [] });
  };
  file(d.file.path, [{ text: tilde(d.file.path), color: C.fg, bold: true }], d.error?.kind === 'invalid' ? d.error.line : undefined);
  for (const i of d.imports) if (i.resolved && i.path) file(i.path, [{ text: `${r.importedYaml} · `, color: C.dim }, { text: tilde(i.path), color: C.fg, bold: true }]);
  if (seat?.member) { out.push({ line: cut([{ text: `${r.member(seat.logicalId)} · `, color: C.dim }, { text: tilde(seat.rigSpecPath ?? 'rig.yaml'), color: C.fg, bold: true }], w) }); yaml(seat.member); }
  return out;
}

/** The files a tab reads, to ask the daemon for. */
export function filesFor(d: RoleDetail, seat: RoleSeat | null, tab: number, at: number, open: ReadonlySet<string>): string[] {
  if (tab === 0) return roleDocs(d, seat).map(e => e.absolutePath).filter((x): x is string => !!x);
  if (tab === 1) return (profileOf(d, seat)?.uses.runtimeResources.items ?? []).filter(x => x.absolutePath && open.has(`rr:${x.id}`)).map(x => x.absolutePath!);
  if (tab === 2) { const p = pieces(d, seat)[at]; return p?.kind === 'entry' && p.entry.absolutePath && !isMissing(p.entry) ? [p.entry.absolutePath] : []; }
  return [d.file.path, ...d.imports.filter(i => i.resolved && i.path).map(i => i.path!)];
}

export type { Seg };
