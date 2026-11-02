import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { readRoleFile, useOpenRigRole, useOpenRigRoles } from '@ledge/fleet/openrig';
import { useEditing, useScreenKeys, useScreenSize, useTui } from '../context.js';
import { cells, cut, type Line } from '../model/cells.js';
import { step } from '../model/openrig.js';
import { contextRows, filesFor, headRows, lenses, listItems, listLines, paramRows, pieces, roleRows, seatKey, yamlRows, type Files, type Prov, type Row } from '../model/roles.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { LineText } from '../ui/Lines.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Two panes from this many columns (the mockup's 120: a list of 40, the role in 80); below, one at a time. */
const WIDE = 100;
const LIST_W = 40;
const railColor = (k: Prov | undefined): string => (k === undefined ? C.faint : k === 'here' ? C.dim : k === 'inh' ? C.blue : k === 'abs' ? C.faint : C.yellow);

/**
 * OpenRig › Rôles (docs/mockups/ledge-openrig-roles-tui.html): the machine's roles, and the one chosen with its tabs Rôle
 * (role.md first), Paramètres, Contexte, YAML. v goes back to the rigs; ← → change tab, f « vu » (the spec, then each
 * seat), r rendered / raw, / searches. Read-only: no key changes a spec.
 */
export function RolesScreen({ onRigs, machineId, onMachine }: { onRigs: () => void; machineId: string | null; onMachine: (step: 1 | -1) => void }) {
  const tui = useTui();
  const { t, g, lang, machines } = tui;
  const r = t.roles;
  const machine = machines.find(m => m.id === machineId) ?? machines[0] ?? null;
  const { columns, rows } = useScreenSize();
  const wide = columns >= WIDE;
  const roles = useOpenRigRoles(tui.client, machine?.id ?? null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  useEditing(searching);
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(tui.kept.role?.id ?? null);
  const [seatK, setSeatK] = useState<string | null>(tui.kept.role?.seat ?? null);
  // Arriving from a seat (i on the Rigs view) opens the role itself; else the list has the keys.
  const [focus, setFocus] = useState<'list' | 'detail'>(tui.kept.role?.seat ? 'detail' : 'list');
  const [tab, setTab] = useState(0);
  const [raw, setRaw] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [at, setAt] = useState(0);
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [files, setFiles] = useState<Files>({});

  const { items } = listItems(roles.roles, query, builtinOpen);
  const firstRole = items.find(i => i.kind === 'role');
  const currentId = roleId ?? (firstRole?.kind === 'role' ? firstRole.role.id : null);
  const summary = roles.roles.find(x => x.id === currentId) ?? null;
  const sel = Math.max(0, items.findIndex(i => i.kind === 'role' && i.role.id === currentId));
  const [listAt, setListAt] = useState<number | null>(null);
  const listSel = listAt ?? sel;
  tui.kept.role = currentId ? { id: currentId, ...(seatK ? { seat: seatK } : {}) } : undefined;

  const view = useOpenRigRole(tui.client, machine?.id ?? null, currentId);
  const d = view.role;
  const seats = d ? lenses(d) : [null];
  const seat = seats.find(s => s && seatKey(s) === seatK) ?? null;
  const tabs = summary?.importOnly ? [1, 3] : [0, 1, 2, 3];
  const shownTab = tabs.includes(tab) ? tab : tabs[0]!;
  // A new role, lens or tab starts at the top.
  useEffect(() => { setScroll(0); setAt(0); setReading(false); }, [currentId, seatK, shownTab]);

  // The files the tab reads, asked once each per role; an answer for a role no longer open is dropped.
  const asked = useRef(new Set<string>());
  const openRole = useRef<string | null>(null);
  useEffect(() => { asked.current = new Set(); openRole.current = currentId; setFiles({}); }, [currentId, machine?.id]);
  const wanted = (d ? filesFor(d, seat, shownTab, at, open) : []).join('\n');
  useEffect(() => {
    if (!wanted || !machine || !currentId) return;
    const id = currentId;
    for (const p of wanted.split('\n')) {
      if (asked.current.has(p)) continue;
      asked.current.add(p);
      void readRoleFile(tui.client, machine.id, id, p).then(m => {
        if (openRole.current === id) setFiles(f => ({ ...f, [p]: m.content !== undefined && !m.error ? { content: m.content } : { error: m.error ?? 'missing' } }));
      });
    }
  }, [wanted, machine, currentId, tui.client]);

  // Geometry: the status bar and the key bar, then the boxes' borders.
  const detailW = wide ? columns - LIST_W : columns;
  const w = Math.max(20, detailW - 4);
  const bodyH = Math.max(3, rows - 4);
  const head = d && summary ? headRows(d, summary, { seat, tab: shownTab, width: w, narrow: !wide, seats }, t) : [];
  const ctx = d && shownTab === 2 ? contextRows(d, seat, files, at, { width: w, raw, narrow: !wide, g, lang }, t) : null;
  const body: Row[] = !d ? [] : shownTab === 0 ? roleRows(d, seat, files, { width: w, raw, narrow: !wide, g, lang }, t)
    : shownTab === 1 ? paramRows(d, seat, files, open, { width: w, narrow: !wide, g }, t)
    : shownTab === 2 ? ctx!.rows : yamlRows(d, seat, files, { width: w }, t);
  const room = Math.max(1, bodyH - head.length);
  const maxScroll = Math.max(0, body.length - room);
  // Parameters: a cursor on the value rows, ↵ unfolds; Context: a cursor on the pieces, ↵ reads on (j k then scroll).
  const params = shownTab === 1 ? body.map((x, i) => (x.rail ? i : -1)).filter(i => i >= 0) : [];
  const nPieces = d && shownTab === 2 ? pieces(d, seat).length : 0;
  const cursorRow = shownTab === 1 ? params[Math.min(at, params.length - 1)] ?? 0 : shownTab === 2 ? ctx!.selRow : -1;
  const top = shownTab === 1 || (shownTab === 2 && !reading) ? Math.min(maxScroll, Math.max(0, cursorRow - Math.floor(room / 2))) : Math.min(scroll, maxScroll);
  const below = Math.max(0, body.length - top - room);

  const pickRole = (i: number) => { const it = items[i]; setListAt(i); if (it?.kind === 'role') { setRoleId(it.role.id); setSeatK(null); } };
  useScreenKeys((input, key) => {
    if (searching) {
      if (key.escape) { setSearching(false); setQuery(''); setListAt(null); return true; }
      if (key.return) { setSearching(false); return true; }
      if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); setListAt(0); return true; }
      if (input && !key.ctrl && !key.meta) { setQuery(q => q + input); setListAt(0); }
      return true;
    }
    if (input === 'v') { onRigs(); return true; }
    if (key.tab) { onMachine(key.shift ? -1 : 1); setRoleId(null); setSeatK(null); setFocus('list'); return true; }
    if (key.leftArrow || key.rightArrow) { const i = tabs.indexOf(shownTab); setTab(tabs[step(i, key.rightArrow ? 1 : -1, tabs.length)]!); return true; }
    if (input === 'f' && d && !summary?.importOnly) { const i = seats.indexOf(seat); const n = seats[step(i, 1, seats.length)] ?? null; setSeatK(n ? seatKey(n) : null); return true; }
    if (input === 'r') { setRaw(x => !x); return true; }
    if (input === '/') { setSearching(true); setFocus('list'); return true; }
    if (focus === 'list') {
      if (key.upArrow || input === 'k') { pickRole(step(listSel, -1, items.length)); return true; }
      if (key.downArrow || input === 'j') { pickRole(step(listSel, 1, items.length)); return true; }
      if (key.return) {
        const it = items[listSel];
        if (it?.kind === 'builtin') setBuiltinOpen(o => !o);
        else if (it) setFocus('detail');
        return true;
      }
      if (key.escape && query) { setQuery(''); setListAt(null); return true; }
      return false;
    }
    // The detail has the keys.
    if (key.escape) { if (reading) setReading(false); else setFocus('list'); return true; }
    const down = key.downArrow || input === 'j', up = key.upArrow || input === 'k';
    if (shownTab === 1 && (down || up)) { setAt(a => Math.max(0, Math.min(params.length - 1, a + (down ? 1 : -1)))); return true; }
    if (shownTab === 1 && key.return) { const f = body[params[at] ?? -1]?.fold; if (f) setOpen(o => { const n = new Set(o); if (n.has(f)) n.delete(f); else n.add(f); return n; }); return true; }
    if (shownTab === 2 && !reading && (down || up)) { setAt(a => Math.max(0, Math.min(nPieces - 1, a + (down ? 1 : -1)))); return true; }
    if (shownTab === 2 && !reading && key.return) { setReading(true); setScroll(top); return true; }
    if (down || up) { setScroll(s => Math.max(0, Math.min(maxScroll, Math.min(s, maxScroll) + (down ? 1 : -1)))); return true; }
    if (key.pageDown || input === ' ') { setScroll(s => Math.min(maxScroll, s + room - 1)); return true; }
    if (key.pageUp) { setScroll(s => Math.max(0, s - room + 1)); return true; }
    return true;
  });

  const k = r.k;
  const keys: Array<[string, string]> = searching ? [['↵', k.done], ['esc', k.clear]]
    : focus === 'list' ? [['tab', t.openrig.machine], ['v', k.view], ['j k', k.nav], ['↵', k.open], ['← →', k.tab], ['f', k.from], ['/', k.search], ['esc', t.keys.back]]
    : shownTab === 1 ? [['tab', t.openrig.machine], ['v', k.view], ['j k', k.nav], ['↵', k.unfold], ['← →', k.tab], ['f', k.from], ['esc', k.list]]
    : shownTab === 2 && !reading ? [['tab', t.openrig.machine], ['v', k.view], ['j k', k.nav], ['↵', k.read], ['← →', k.tab], ['f', k.from], ['r', k.raw], ['esc', k.list]]
    : [['tab', t.openrig.machine], ['v', k.view], ['j k', k.scroll], ['← →', k.tab], ['f', k.from], ['r', k.raw], ['/', k.search], ['esc', k.list]];
  const version = roles.openrigVersion;
  const crumb = [version ? t.openrig.version(version) : t.openrig.title, machine?.label, r.crumb].filter(Boolean).join(' · ');

  const message = (text: string, color = C.dim, more?: string) => (
    <TitledBox title={r.title} mark={{ text: machine?.label ?? '', color: C.dim }} flexGrow={1}>
      <Text color={color}>{text}</Text>{more ? <Text color={C.faint}>{more}</Text> : null}
    </TitledBox>
  );
  let content;
  if (!machine) content = null;
  else if (roles.status !== 'ready') content = message(`${g.starting} ${r.loading}`, C.blue);
  else if (roles.error === 'daemon_stopped') content = message(`${g.idle} ${r.daemonStopped(machine.label)}`, C.faint, r.daemonStopped2);
  else if (roles.error === 'outdated') content = message(r.outdated, C.yellow);
  else if (roles.error === 'offline') content = message(t.openrig.offline, C.yellow);
  else if (roles.error === 'not_installed') content = message(t.openrig.notInstalled);
  else if (roles.error) content = message(r.failed(roles.error), C.yellow);
  else {
    const list = listLines(roles.roles, { query, searching, builtinOpen, sel: listSel, width: (wide ? LIST_W : columns) - 4, narrow: !wide, focused: focus === 'list' }, t, g);
    const listRoom = Math.max(1, bodyH);
    const listTop = Math.max(0, Math.min(list.lines.length - listRoom, list.selLine - Math.floor(listRoom / 2)));
    const listBox = (
      <TitledBox title={`${r.title} · ${roles.roles.length}`} width={wide ? LIST_W : columns} flexShrink={0} color={!wide || focus === 'list' ? C.line : C.line}>
        {searching && listTop === 0 ? (
          <Box flexShrink={0}><Text color={C.coral}>/ </Text><TextInput value={query} active onChange={q => { setQuery(q); setListAt(0); }} onSubmit={() => setSearching(false)} onEscape={() => { setSearching(false); setQuery(''); setListAt(null); }} /></Box>
        ) : null}
        {list.lines.slice(listTop, listTop + listRoom).map((l, i) => (searching && listTop === 0 && i === 0 ? null : <Box key={i} flexShrink={0}><LineText line={l} /></Box>))}
      </TitledBox>
    );
    const detailFocused = focus === 'detail';
    const title = summary?.name ?? '';
    const mark = seat ? { text: `· ${r.from} ${seat.logicalId}`, color: C.blue } : { text: `${summary?.version ? `· v${summary.version} ` : ''}· ${summary?.source === 'builtin' ? r.builtin : r.mine}`, color: C.dim };
    const detailBox = !summary ? null : (
      <TitledBox title={title} mark={mark} flexGrow={1} paddingX={0} color={C.coral} titleColor={C.coral} titleBold foot={below > 0 ? r.more(below) : undefined}>
        {!d ? <Text color={C.faint}>{view.status === 'ready' ? (view.error === 'role_not_found' ? r.fileMissing : r.failed(view.error ?? '')) : `  ${r.loadingRole}`}</Text> : <>
          {head.map((l, i) => <Box key={`h${i}`} flexShrink={0}><LineText line={[{ text: ' ' }, ...l]} /></Box>)}
          {body.slice(top, top + room).map((x, i) => {
            const selected = (shownTab === 1 && top + i === cursorRow && detailFocused) || x.sel;
            const line: Line = [{ text: x.rail ? g.rail : ' ', color: railColor(x.rail), ...(selected ? { bg: C.sel } : {}) }, ...cut(x.line, w).map(s => (selected ? { ...s, bg: C.sel } : s))];
            const pad = selected ? [{ text: ' '.repeat(Math.max(0, w + 1 - cells(line.map(s => s.text).join('')))), bg: C.sel }] : [];
            return <Box key={`b${top + i}`} flexShrink={0}><LineText line={[...line, ...pad]} /></Box>;
          })}
        </>}
      </TitledBox>
    );
    content = wide ? <Box flexGrow={1}>{listBox}{detailBox}</Box> : focus === 'list' ? listBox : detailBox ?? listBox;
  }
  return <Frame crumb={crumb} crumbShort={r.crumb} keys={keys}>{content}</Frame>;
}
