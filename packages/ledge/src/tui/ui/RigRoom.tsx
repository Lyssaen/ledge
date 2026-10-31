import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { useColorPreview, useContextNear } from '@ledge/fleet';
import type { Exchange, Rig, RigRepo, Session } from '@ledge/protocol';
import { hhmm, seatName } from '@ledge/ui/chat/ledge/threadModel';
import { kernelSplit, rigColor, rigKey, rigPlace, shortCwd, workingCount } from '@ledge/ui/rigs/model';
import { HUMAN_ADDRESS, openrigBase } from '../../daemon/openrig/facts.js';
import { useRigExchanges } from '../brain.js';
import { LEDGE_FOCUS, useTui, type KeyHandler } from '../context.js';
import type { Line } from '../model/cells.js';
import { adoptable, adoptChoices, heldRepos, refusalText, rigCall, type RigCallMessage, type RigCallRequest } from '../model/rigActions.js';
import { queueOf, seatAddress, seatRows, type QueueItem, type SeatRow } from '../model/rigRoom.js';
import { C, projectColor } from '../theme.js';
import { BAR, barCells } from './LedgeRail.js';
import { AdoptBox, RestartLine, StopBox, type RigDialog } from './RigConfirm.js';
import { Button } from './SessionCard.js';
import { Lines } from './Lines.js';
import { Tail } from './Tail.js';
import { TitledBox } from './TitledBox.js';

type Keys = Array<readonly [string, string]>;
export type RoomTarget = { kind: 'rig'; machine: string; rigId: string } | { kind: 'kernel'; machine: string };

/** `s` in `w` cells, cut with a space left before the next column. */
const col = (s: string, w: number) => (s.length >= w ? `${s.slice(0, Math.max(0, w - 2))}… ` : s.padEnd(w));
const QUEUE_W = 44;

/**
 * A rig's room (the mockup's « La pièce d'un rig »): its plate (place, seats at work, branch, spec, since when, machine), its seat
 * table, its exchanges (`rig send`) beside OpenRig's queue (under it below 140 columns), and the chosen seat's terminal in colour.
 * The kernel's room (`target.kind === 'kernel'`) is the same, its plate saying OpenRig's daemon, advisor and the human's terminal
 * tucked away, Ledge's orders to the operator and the queue of every rig. Its keys go through `keys`, its key bar through `onBar`:
 * j k the seats (past the ends, the home's left column), ↵ the seat's session, a attaches it, w writes to it through Ledge.
 * A rig's life goes through OpenRig (rig.act, rig.adopt): r restarts the chosen seat, S stops the rig or only that seat, u resumes a
 * stopped rig, p files an off-project rig in a project; each asks first (but u), and ends in a toast.
 */
export function RigRoom({ target, side, height, keys, onBar }: { target: RoomTarget; side: boolean; height: number; keys: MutableRefObject<KeyHandler | null>; onBar(b: Keys): void }) {
  const tui = useTui();
  const { t, g, d, rigs, escalations, openrig, machines, projects, client } = tui;
  const kernel = target.kind === 'kernel';
  const rig = kernel ? rigs.find(r => r.kernel && r.machine === target.machine) : rigs.find(r => r.machine === target.machine && r.id === target.rigId);
  const status = openrig.find(s => s.machine === target.machine);
  const near = useContextNear(client);
  // The kernel's seats shown (advisor and the human's terminal tucked away); a rig's all of them, in the graph's order.
  const split = useMemo(() => (rig && kernel ? kernelSplit({ ...rig, seats: rig.seats.filter(s => s.state !== 'stopped') }) : null), [rig, kernel]);
  const rows = useMemo(() => (rig ? seatRows(split ? { ...rig, seats: split.shown } : rig, d.byId, escalations, t.seat) : []), [rig, split, d.byId, escalations, t]);
  const [chosen, setChosen] = useState(0);
  const key = kernel ? `kernel|${target.machine}` : `rig|${target.machine}|${target.rigId}`;
  const [dialog, setDialog] = useState<RigDialog | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChosen(0); setDialog(null); }, [key]);
  const on = Math.min(chosen, Math.max(0, rows.length - 1));
  const row = rows[on];
  // The exchanges: this rig's; for the kernel, its own and every rig's (its queue is all of them).
  const named = useMemo(() => (kernel ? rigs : rig ? [rig] : []).map(r => ({ machine: r.machine, rigId: r.id })), [kernel, rigs, rig]);
  const exchanges = useRigExchanges(client, named);
  const own = rig ? exchanges.get(rigKey(rig)) : undefined;
  const queue = useMemo<QueueItem[]>(() => (kernel
    ? rigs.flatMap(r => queueOf(r, exchanges.get(rigKey(r)) ?? [], escalations, { long: true })).sort((a, b) => b.at.localeCompare(a.at))
    : rig ? queueOf(rig, own ?? [], escalations) : []), [kernel, rigs, rig, exchanges, own, escalations]);
  const live = !!rig && rig.lifecycle !== 'unreachable' && status?.state !== 'unreachable';
  // `w` goes through the local Ledge, which resolves @… against its own machine's rigs only: not for a remote rig, nor the kernel.
  const writable = !kernel && rig?.machine === 'local';
  const machineLabel = (id: string) => machines.find(m => m.id === id)?.label ?? id;
  // A rig's actions (never the kernel's: stopping it would stop OpenRig), off while unreachable or while one is in flight.
  const acts = !kernel && live && !busy && !!rig;
  const stopped = rig?.lifecycle === 'stopped';
  const filing = !!rig && !kernel && adoptable(rig);
  const choices = useMemo(() => (rig && filing ? adoptChoices(rig, projects, t.rigAct) : []), [rig, filing, projects, t]);
  const where = kernel ? t.room.kernelWhere : rig?.name ?? '';

  const openSeat = (r: SeatRow) => {
    if (!r.session || !rig) return;
    const listed = tui.left.some(x => x.kind === 'seat' && x.rig.machine === rig.machine && x.rig.id === rig.id && x.seat.ref === r.seat.ref && x.session);
    tui.setFocus(listed ? { kind: 'seat', machine: rig.machine, rigId: rig.id, ref: r.seat.ref } : { kind: 'session', id: r.session.id });
    tui.go('session');
  };
  const attachSeat = (r: SeatRow) => {
    if (!rig) return;
    const argv = tui.fleet.seatTerminal(rig.machine, r.seat.ref);
    if (!argv) { tui.toast({ text: t.room.noTerminalCommand(r.seat.name), tone: 'info' }); return; }
    tui.runInTerminal(argv);
  };
  const writeTo = (r: SeatRow) => {
    if (!rig) return;
    const address = seatAddress(rig, r.seat, rigs);
    const kept = tui.kept.drafts.get('ledge');
    tui.kept.drafts.set('ledge', kept ? `${address} ${kept.replace(/^@\S+\s*/, '')}` : `${address} `);
    tui.setFocus({ kind: 'ledge' });
    tui.setLedgeFocus(LEDGE_FOCUS.field);
  };

  /** Sends the action, says its outcome in a toast: `done` when OpenRig took it, the refusal's reason otherwise. */
  const call = (msg: RigCallRequest, done: string) => {
    setDialog(null); setBusy(true);
    void rigCall(client, { ...msg, rid: randomUUID() } as RigCallMessage).then(r => {
      setBusy(false);
      tui.toast(r.ok ? { text: done, tone: 'ok' } : { text: refusalText(r, t.rigAct), tone: 'error' });
    });
  };
  const dialogKeys = (input: string, k: Parameters<KeyHandler>[1], d: RigDialog): void => {
    if (!rig) return;
    if (k.escape) { setDialog(null); return; }
    const count = d.kind === 'stop' ? (d.seat ? 2 : 1) : d.kind === 'adopt' ? choices.length : 1;
    if (d.kind !== 'restart' && (input === 'j' || k.downArrow)) { setDialog({ ...d, on: Math.min(count - 1, d.on + 1) }); return; }
    if (d.kind !== 'restart' && (input === 'k' || k.upArrow)) { setDialog({ ...d, on: Math.max(0, d.on - 1) }); return; }
    if (!k.return) return;
    const at = { machine: rig.machine, rigId: rig.id };
    if (d.kind === 'restart') call({ type: 'rig.act', ...at, seatRef: d.seat.ref, verb: 'restart' }, t.rigAct.done.restart(d.seat.name));
    else if (d.kind === 'stop') {
      if (d.on === 1 && d.seat) call({ type: 'rig.act', ...at, seatRef: d.seat.ref, verb: 'stop' }, t.rigAct.done.stop(d.seat.name));
      else call({ type: 'rig.act', ...at, verb: 'down' }, t.rigAct.done.down(rig.name));
    } else {
      const c = choices[d.on];
      // « Laisser hors projet »: nothing to send, the rig stays where it is.
      if (c?.projectId) call({ type: 'rig.adopt', ...at, projectId: c.projectId }, t.rigAct.done.adopted(rig.name, c.label));
      else setDialog(null);
    }
  };

  keys.current = (input, k) => {
    // A dialog has the keyboard while it is open.
    if (dialog) { dialogKeys(input, k, dialog); return true; }
    if (input === 'j' || k.downArrow) { if (on < rows.length - 1) { setChosen(on + 1); return true; } return false; }
    if (input === 'k' || k.upArrow) { if (on > 0) { setChosen(on - 1); return true; } return false; }
    if (!row) return false;
    if (k.return) { if (live) openSeat(row); return true; }
    if (input === 'a') { if (live) attachSeat(row); return true; }
    if (input === 'w' && !kernel) { if (live && writable) writeTo(row); return true; }
    if (kernel || !rig) return false;
    if (input === 'r') { if (acts) setDialog({ kind: 'restart', seat: row.seat }); return true; }
    if (input === 'S') { if (acts && !stopped) setDialog({ kind: 'stop', seat: row.seat.state === 'stopped' ? undefined : row.seat, on: 0 }); return true; }
    if (input === 'u') { if (acts && stopped) call({ type: 'rig.act', machine: rig.machine, rigId: rig.id, verb: 'restore' }, t.rigAct.done.restore(rig.name)); return true; }
    if (input === 'p') { if (acts && filing) setDialog({ kind: 'adopt', on: 0 }); return true; }
    return false;
  };
  useEffect(() => () => { keys.current = null; }, [keys]);
  const ak = t.rigAct.keys;
  const rigKeys: Keys = acts && row ? [['r', ak.restart], ...(stopped ? [['u', ak.resume] as const] : [['S', ak.stop] as const]), ...(filing ? [['p', ak.adopt] as const] : [])] : [];
  const bar: Keys = dialog ? [...(dialog.kind === 'restart' ? [] : [['j k', ak.choose] as const]), ['↵', ak.confirm], ['esc', ak.cancel]]
    : [['j k', t.keys.seats], ...(live && row ? [...(row.session ? [['↵', t.keys.openSeat] as const] : []), ['a', t.keys.attachSeat] as const, ...(writable ? [['w', t.keys.write] as const] : [])] : []), ...rigKeys, ['1', t.keys.ledge]];
  const barKey = bar.map(b => b.join(' ')).join('|');
  useEffect(() => onBar(bar), [barKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The plate: a rig's place, seats at work, branch, spec, since when, machine; the kernel's OpenRig daemon.
  const plate = (() => {
    if (kernel) {
      const state = status?.state ?? (rig ? 'running' : 'absent');
      const endpoint = target.machine === 'local' ? openrigBase(tui.env).replace(/^https?:\/\//, '') : null;
      return (
        <Text wrap="truncate">
          <Text color={state === 'running' ? C.green : state === 'error' ? C.red : C.dim}>{state === 'running' ? g.working : g.idle} </Text>
          <Text color={C.fg}>{t.room.daemon[state]}</Text>
          <Text color={C.dim}>{[endpoint, status?.version ? t.room.version(status.version) : null, rig ? shortCwd(rig.cwd) : null].filter(Boolean).map(x => ` · ${x}`).join('')}</Text>
          {status?.human ? <><Text color={C.dim}> · </Text><Text color={status.human === 'registered' ? C.coral : C.yellow}>{status.human === 'registered' ? t.room.human(HUMAN_ADDRESS) : t.room.noHuman}</Text></> : null}
        </Text>
      );
    }
    if (!rig) return null;
    const seats = rig.seats.filter(s => s.state !== 'stopped');
    const working = workingCount(rig), n = barCells(working, seats.length);
    const tail = [rig.spec ? `spec ${rig.spec}` : null, t.room.seats(seats.length), rig.launch ? t.room.since(hhmm(rig.launch.startedAt)) : null, machineLabel(rig.machine),
      rig.launch?.lead ? t.room.lead(seatName(rig.launch.lead)) : null].filter(Boolean);
    return (
      <Text wrap="truncate">
        {live ? <><Text color={C.blue}>{g.working} </Text><Text color={C.fg}>{t.home.working(working, seats.length)} </Text>
          <Text color={C.red}>{g.full.repeat(n)}</Text><Text color={C.line}>{g.empty.repeat(BAR - n)}</Text></>
          : <><Text color={C.dim}>{g.idle} </Text><Text color={C.dim}>{t.room.unreachable}</Text></>}
        {rig.branch ? <Text color={C.dim}>  {g.branch} {rig.branch}</Text> : null}
        <Text color={C.faint}>{tail.map(x => ` · ${x}`).join('')}</Text>
      </Text>
    );
  })();
  const placeOf = (r: Rig) => {
    const p = rigPlace(r, projects);
    return [t.room.rig, p.kind === 'project' ? t.home.inProject(p.name) : p.kind === 'off' ? t.home.offProject : '', r.machine !== 'local' ? t.home.onMachine(machineLabel(r.machine)) : ''].filter(Boolean).join(' · ');
  };
  const title = kernel ? `${g.kernel} ${t.room.kernel}` : `${g.rig} ${rig?.name ?? ''} · ${rig ? placeOf(rig) : ''}`;
  const ctxColor = (ctx: number | undefined) => (ctx !== undefined && ctx >= near * 100 ? C.yellow : C.dim);
  const h = t.room.head;
  const table = kernel
    ? <Text color={C.faint} wrap="truncate">  {col(h.seat, 12)}{col(h.name, 12)}{col(h.state, 15)}{col(h.agent, 23)}{h.role}</Text>
    : <Text color={C.faint} wrap="truncate">  {col(h.seat, 11)}{col(h.name, 12)}{col(h.state, 15)}{col(h.agent, 25)}{col(h.context, 10)}{h.on}</Text>;
  const hidden = split?.hidden ?? [];
  const buttons = !kernel && !!rig;
  const plateH = 5 + Math.max(1, rows.length) + (hidden.length ? 1 : 0) + (buttons ? 3 : 0);
  // An off-project rig's repos found on the way, and the projects already holding some of them.
  const repos = rig && !kernel && rig.offProject && !rig.projectId ? rig.repos : null;
  const held = useMemo(() => (repos && rig ? [...heldRepos(rig, projects)].flatMap(([id, rs]) => rs.map(r => ({ repo: r.name, project: projects?.projects.find(p => p.id === id)?.name ?? id }))) : []), [repos, rig, projects]);
  const reposH = repos ? 3 + Math.max(1, repos.length) + 1 + held.length : 0;
  const dialogH = dialog?.kind === 'stop' ? 4 + (dialog.seat ? 2 : 1) : dialog?.kind === 'adopt' ? 4 + choices.length : 0;
  const rest = Math.max(0, height - plateH - reposH - dialogH);
  const midH = side ? Math.max(6, Math.min(15, Math.floor(rest / 2))) : Math.max(4, Math.floor(rest / 3));

  const exchangeBox = (
    <TitledBox title={kernel ? t.room.orders : t.room.exchanges(where)} {...(kernel ? {} : { mark: { text: `· ${t.room.rigSend}`, color: C.faint } })}
      flexGrow={1} {...(side ? {} : { height: midH })}>
      {own === undefined || own === null ? <Text color={C.faint}>{rig ? t.room.loading : t.overview.noExchange}</Text>
        : own.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text>
        : <Lines lines={own.slice(-200).map(x => exchangeLine(x, g, t.room.you))} />}
    </TitledBox>
  );
  const queueBox = (
    <TitledBox title={t.room.queue(kernel ? t.room.all : where)} mark={{ text: `· ${queue.length}`, color: C.faint }} {...(side ? { width: QUEUE_W } : { height: midH })} flexShrink={0}>
      {queue.length === 0 ? <Text color={C.faint}>{t.room.emptyQueue}</Text> : queue.flatMap(q => {
        const [glyph, gc] = q.glyph === 'approval' ? [g.approval, C.yellow] : q.glyph === 'ok' ? [g.ok, C.green] : [g.task, C.green];
        const sc = q.state === 'à toi' ? C.red : q.state === 'fait' ? C.green : C.blue;
        return kernel
          ? [<Text key={q.id} wrap="truncate"><Text color={C.faint}>{q.id} </Text><Text color={gc}>{glyph} </Text><Text color={C.fg}>{col(q.to, 19)}</Text><Text color={sc}>{t.room.queueState[q.state]}</Text></Text>]
          : [<Text key={q.id} wrap="truncate"><Text color={C.faint}>{q.id} </Text><Text color={gc}>{glyph} </Text><Text color={C.fg} bold>{q.to}</Text><Text color={sc}> {t.room.queueState[q.state]}</Text></Text>,
            <Text key={`${q.id}-t`} color={C.dim} wrap="truncate">{'        '}{q.title}</Text>];
      })}
    </TitledBox>
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <TitledBox title={title} color={kernel || !rig ? C.dim : projectColor(rigColor(rig))} titleColor={C.fg} titleBold
        mark={{ text: `· ${kernel ? t.room.kernelMark : t.room.mark}`, color: C.faint }} flexShrink={0}>
        {plate ?? <Text> </Text>}
        <Text> </Text>
        {table}
        {rows.length === 0 ? <Text color={C.faint}>  {t.home.noSeat}</Text> : rows.map((r, i) => {
          const sel = i === on;
          return (
            <Box key={r.seat.ref} backgroundColor={sel ? C.sel : undefined} height={1}>
              <Text wrap="truncate">
                <Text color={sel ? C.coral : C.faint}>{sel ? '▌' : ' '}</Text><Text> </Text>
                <Text color={C.violet}>{col(r.seat.address, kernel ? 12 : 11)}</Text><Text color={C.fg} bold>{col(r.seat.name, 12)}</Text>
                <Text color={live ? r.state.color : C.dim}>{col(`${g[r.state.glyph] as string} ${r.state.label}`, 15)}</Text>
                <Text color={C.dim}>{col(r.agent, kernel ? 23 : 25)}</Text>
                {kernel ? <Text color={C.dim}>{t.room.roles[r.seat.name] ?? r.topic}</Text>
                  : <><Text color={ctxColor(r.ctx)}>{col(r.ctx === undefined ? '' : t.overview.context(r.ctx), 10)}</Text><Text color={C.dim}>{r.topic}</Text></>}
              </Text>
            </Box>
          );
        })}
        {hidden.length ? (
          <Text wrap="truncate">
            <Text color={C.faint}>  {t.room.tucked(hidden.length)}  </Text>
            {hidden.map((s, i) => <Text key={s.ref}><Text color={C.dim}>{s.name}</Text><Text color={C.faint}> {s.name.startsWith('advisor') ? t.room.advisor : t.room.humanSeat}{i < hidden.length - 1 ? ' · ' : ''}</Text></Text>)}
          </Text>
        ) : null}
        {buttons && rig ? <>
          <Text> </Text>
          {dialog?.kind === 'restart' ? <RestartLine seat={dialog.seat} /> : (
            <Box columnGap={2}>
              <Button label={t.rigAct.restartSeat} k="r" off={!acts} />
              {filing ? <Button label={t.rigAct.adoptRig} k="p" primary off={!acts} /> : null}
              {stopped ? <Button label={t.rigAct.resumeRig} k="u" primary off={!acts} /> : <Button label={t.rigAct.stopRig} k="S" danger off={!acts} />}
            </Box>
          )}
          <Text color={C.faint} wrap="truncate">{t.rigAct.viaOpenRig}</Text>
        </> : null}
      </TitledBox>
      {repos ? (
        <TitledBox title={t.rigAct.repos} mark={{ text: `· ${repos.length}`, color: C.faint }} titleColor={C.dim} flexShrink={0}>
          {repos.length === 0 ? <Text color={C.faint}>{t.rigAct.noRepo}</Text> : repos.map(r => <RepoLine key={r.path} repo={r} />)}
          <Text> </Text>
          <Text color={C.faint} wrap="truncate">{t.rigAct.found}</Text>
          {held.map(h => <Text key={`${h.repo}|${h.project}`} color={C.dim} wrap="truncate">{t.rigAct.already(h.repo, h.project)}</Text>)}
        </TitledBox>
      ) : null}
      {rig && dialog?.kind === 'stop' ? <StopBox rig={rig} seat={dialog.seat} on={dialog.on} /> : null}
      {rig && dialog?.kind === 'adopt' ? <AdoptBox rig={rig} choices={choices} on={dialog.on} projects={projects} /> : null}
      {side
        ? <Box flexDirection="row" height={midH} flexShrink={0}>{exchangeBox}{queueBox}</Box>
        : <>{exchangeBox}{queueBox}</>}
      <SeatTerminal title={t.room.terminal(row?.seat.name ?? '—', where)} session={row?.session} />
    </Box>
  );
}

/** A repo found on the way: « ⎇ api  github.com/…  cloné par dev · ⎇ feat/client ». */
function RepoLine({ repo }: { repo: RigRepo }) {
  const { t, g } = useTui();
  const how = repo.how && repo.by ? `${t.rigAct.how[repo.how]} ${seatName(repo.by)}` : '';
  return (
    <Text wrap="truncate">
      <Text color={C.faint}>{g.branch} </Text><Text color={C.fg} bold>{col(repo.name, 8)}</Text><Text color={C.dim}>{col(repo.remote ?? shortCwd(repo.path), 36)}</Text>
      <Text color={C.faint}>{[how, repo.branch ? `${g.branch} ${repo.branch}` : ''].filter(Boolean).join(' · ')}</Text>
    </Text>
  );
}

/** The chosen seat's terminal: its paired session's preview, in colour when the daemon sends it. */
function SeatTerminal({ title, session }: { title: string; session: Session | undefined }) {
  const { client, d, t } = useTui();
  const colored = useColorPreview(client, session?.id ?? null);
  return (
    <TitledBox title={`${title}${colored ? ` ${t.overview.inColor}` : ''}`} flexGrow={1}>
      {session
        ? <Tail lines={colored ?? d.previews.get(session.id) ?? []} ansi={colored !== undefined} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
        : <Text color={C.faint}>{t.room.noTerminal}</Text>}
    </TitledBox>
  );
}

/** An exchange, one line: « 16:22  orch-lead → build  ▤ texte »; Ledge and « toi » in coral. */
function exchangeLine(x: Exchange, g: ReturnType<typeof useTui>['g'], you: string): Line {
  const toLedge = x.to === 'ledge' || x.to === HUMAN_ADDRESS;
  const [mark, color] = toLedge ? [g.approval, C.yellow] : x.kind === 'task' || x.kind === 'handoff' ? [g.task, C.green] : [g.message, C.violet];
  const name = (ref: string) => (ref === HUMAN_ADDRESS ? 'ledge' : seatName(ref));
  const from = name(x.from), to = name(x.to);
  const who = (n: string) => (n === 'ledge' || n === you ? C.coral : C.fg);
  return [{ text: `${hhmm(x.at)}  `, color: C.faint }, { text: from, color: who(from) }, { text: ` ${g.arrow} `, color }, { text: to.padEnd(Math.max(0, 22 - from.length)), color: who(to) },
    { text: ` ${mark} `, color }, { text: x.text.replace(/\s*\n\s*/g, ' '), color: C.dim }];
}
