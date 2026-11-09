import { useEffect, useState, type JSX } from 'react';
import type { Fleet, FleetPullRequest } from '@ledge/fleet';
import type { ShownPr } from '../../forge/useForge';
import { contextShare, isArchived, type HumanAsk, type Session, type Task } from '@ledge/protocol';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import { closedLedgeTasks, nearLimit, openDecisions, type TasksApi } from '../../tasks/useTasksApi';
import { NoteDecision } from '../../tasks/NoteDecision';
import { DecisionAnswer } from '../../tasks/DecisionAnswer';
import { RigAsks, rigAsksShown } from './RigAsks';
import { useI18n } from '../../i18n/lang';
import { readJson, writeJson } from '../../state/storage';
import { ProviderLogo } from '../ProviderLogo';
import { providerOf } from '../../workspace/sessionTab';
import { PipeDot } from '../../forge/PipeGraph';
import { PrIcon } from '../../forge/PrIcon';
import { MergeConfirm } from '../../forge/MergeConfirm';
import '../../styles/forge.css';
import '../../styles/atoi.css';

/** When the page was last opened (ms): « Terminé depuis ton passage » counts from there. */
export const ATOI_SEEN_KEY = 'ledge.ide.atoi.seen';

/** The sessions that finished since `since` (ms): idle, not archived, their last reply after it, the latest first. */
export function finishedSince(sessions: readonly Session[], since: number): Session[] {
  return sessions.filter(s => s.state === 'idle' && !isArchived(s) && s.lastReply && Date.parse(s.lastReply.at) > since)
    .sort((a, b) => Date.parse(b.lastReply!.at) - Date.parse(a.lastReply!.at));
}

export interface AtoiPageProps {
  /** The sessions waiting for the user (a permission or a question), as the sidebar's « À toi » has them. */
  waiting: readonly Session[];
  /** Every session, for those that finished since the last visit. */
  sessions: readonly Session[];
  /** « projet · branche », or « rig · rôle » for a seat. */
  where(s: Session): string;
  onOpen(id: string): void;
  /** A permission: allowed or refused. A question: one of its options, as an answer. */
  onDecide(s: Session, ok: boolean): void; onAnswer(s: Session, option: string): void;
  /** The requests waiting for the user: a failed pipeline, or ready to merge (prsWaitingForYou). */
  prs: readonly ShownPr[];
  agentOf(pr: FleetPullRequest): { name: string } | null;
  onOpenPr(pr: FleetPullRequest): void;
  /** « Demander à X de corriger »: the failed job's name is read from the detail. */
  onAskFix(pr: FleetPullRequest): void;
  fleet: Pick<Fleet, 'prAct' | 'prDetail'>;
  machineLabel(id: string): string;
  notify(text: string): void;
  /** What « Le point » showed (lot 12, docs/mockups/ledge-ide-tasks-history.html): the decisions sessions put through Ledge, the
   *  sessions near their context limit, and the closed tasks Ledge gave (in « Terminé depuis ton passage »). */
  tasks?: TasksApi;
  /** « Voir » of a closed task: the right panel on « Tâches », at its detail. */
  onSeeTask?(id: string): void;
  onHandover?(id: string): void; onLater?(s: Session): void;
  /** « Résumer la journée »: the question asked in the right panel's chat, on Conversation; off while it cannot be asked. */
  onSummarize?(): void; summarizeOff?: boolean;
  /** What OpenRig's rigs ask the person, the card the sidebar's « Voir » unfolds, and the local machine's name for the banner. */
  asks?: OpenRigAsksView; askFocus?: { id: string; n: number } | null; asksMachine?: string;
  askSourceOf?(ask: HumanAsk): ((path: string) => void) | null;
  onOpenSeat?(sessionId: string): void;
}

/** The page « À toi » (D3, docs/ide-workspace-plan.md 4.1 point 3; mockup atoiPage()): what waits for the user's decision or eye,
 *  every session and rig at once. Three blocks: the requests, decided in place; the MRs and PRs waiting (a failed pipeline,
 *  ready to merge, with the same confirmation as their tab); the sessions finished since the last visit. */
export function AtoiPage(p: AtoiPageProps): JSX.Element {
  const { t } = useI18n();
  const a = t.atoiPage;
  const f = t.forge;
  // The last visit, read once: this one is noted for the next.
  const [since] = useState(() => { const v = readJson(ATOI_SEEN_KEY); return typeof v === 'number' ? v : 0; });
  useEffect(() => { writeJson(ATOI_SEEN_KEY, Date.now()); }, []);
  // The confirmation open under a row: its command, and whether the detail read at the click refuses the merge (its blockers).
  const [merging, setMerging] = useState<{ id: string; command: string; blocked: boolean } | null>(null);
  const done = finishedSince(p.sessions, since);
  const perm = p.waiting.some(s => s.pending?.kind === 'permission');
  const api = p.tasks;
  const asked = api ? openDecisions(api.tasks) : [];
  const closed = api ? closedLedgeTasks(api.tasks) : [];
  const near = api ? nearLimit(p.sessions, api.later, api.near) : [];
  const [answering, setAnswering] = useState<string | null>(null);
  const pt = t.home.point;

  const ask = (s: Session) => {
    const r = s.pending!;
    return (
      <div key={s.id} className={`atoi-row ${r.kind === 'question' ? 'ask' : 'perm'}`}>
        <div className="hd">
          <span className={`fg-dot ${r.kind === 'question' ? 'wait' : 'fail'}`} aria-hidden="true" />
          <ProviderLogo provider={providerOf(s.tool)} size={13} /><b>{s.name}</b><span className="atoi-where">{p.where(s)}</span>
          <button type="button" className="fg-btn" onClick={() => p.onOpen(s.id)}>{a.open}</button>
        </div>
        {r.kind === 'question' ? <span>{r.text}</span> : <><span>{a.allowCommand}</span><code>{r.text}</code></>}
        <div className="fg-go">
          {r.kind === 'question'
            ? (r.options ?? []).map((o, i) => <button key={o} type="button" className={`fg-btn${i ? '' : ' pri'}`} onClick={() => p.onAnswer(s, o)}>{o}</button>)
            : <><button type="button" className="fg-btn pri" onClick={() => p.onDecide(s, true)}>{a.allow}</button><button type="button" className="fg-btn" onClick={() => p.onDecide(s, false)}>{a.deny}</button></>}
        </div>
      </div>
    );
  };
  const merge = (pr: ShownPr) => {
    if (merging?.id === pr.id) return;
    p.fleet.prDetail(pr.id, pr.machineId).then(d => setMerging({ id: pr.id, command: d.mergeCommand, blocked: d.mergeBlockers.length > 0 }),
      (e: { message?: string }) => { if (e?.message) p.notify(e.message); });
  };
  /** A decision a session put through Ledge: « Répondre » unfolds the answer form under it; a proposal about the notes keeps its buttons. */
  const decision = (x: Task, tasks: TasksApi) => (
    <div key={x.id} className="atoi-dec" data-decision={x.id}>
      <div className="atoi-line">
        <span className="atoi-mk asked" aria-hidden="true">?</span>
        <span className="grow" title={t.decision.asks(x.giverName)}><b>{x.giverName}</b> {x.title}</span>
        {!x.brain && answering !== x.id && <button type="button" className="fg-btn pri" onClick={() => setAnswering(x.id)}>{t.decision.answer}</button>}
      </div>
      {x.brain && <NoteDecision task={{ ...x, brain: x.brain }} api={tasks} />}
      {!x.brain && answering === x.id && <DecisionAnswer task={x} api={tasks} onClose={() => setAnswering(null)} />}
    </div>
  );
  /** A request of a machine down, as last read (state 4): dimmed, its actions off with the reason, as in its tab. */
  const prRow = (pr: ShownPr) => {
    const agent = p.agentOf(pr);
    const fail = pr.pipeline === 'fail';
    const down = !!pr.stale;
    const why = down ? f.machineOffline(p.machineLabel(pr.machineId)) : undefined;
    return (
      <div key={pr.id} className={`atoi-pr${down ? ' stale' : ''}`}>
        <div className="atoi-line">
          <PipeDot status={pr.pipeline} />
          <span className="grow"><b>{pr.ref}</b> {pr.title} <span className="fg-mut">· {f.host[pr.forge]} · {fail ? a.prFailed : pr.pipeline === 'none' ? a.prReadyNoCi : a.prReady}</span></span>
          <button type="button" className="fg-btn" onClick={() => p.onOpenPr(pr)}>{a.open}</button>
          {fail && agent && <button type="button" className="fg-btn pri" disabled={down} title={why} onClick={() => p.onAskFix(pr)}>{f.askFix(agent.name)}</button>}
          {!fail && <button type="button" className="fg-btn pri" disabled={down} title={why} aria-expanded={merging?.id === pr.id} onClick={() => merge(pr)}>{f.merge}</button>}
        </div>
        {merging?.id === pr.id && <MergeConfirm pr={pr} fleet={p.fleet} command={merging.command} machine={p.machineLabel(pr.machineId)} notify={p.notify}
          blocked={merging.blocked || down} why={why} onDone={() => setMerging(null)} onReload={() => { setMerging(null); p.onOpenPr(pr); }} onCancel={() => setMerging(null)} />}
      </div>
    );
  };
  return (
    <div className="fg-page atoi-page" data-keep-scroll>
      <div className="atoi-top"><div className="grow"><h3>{a.title}</h3><span className="fg-sub">{a.sub}</span></div>
        {p.onSummarize && <button type="button" className="fg-btn" disabled={p.summarizeOff} onClick={p.onSummarize}>{pt.summarize}</button>}</div>
      <div className="fg-blk">
        <div className="fg-blk-h"><span className={`fg-dot ${perm ? 'fail' : p.waiting.length ? 'wait' : 'ok'}`} aria-hidden="true" /><b>{a.requests}</b><span className="fg-sub">{p.waiting.length}</span>
          <span className="fg-sp" /><span className="fg-sub">{a.keysBefore}<kbd>Y</kbd> / <kbd>N</kbd>{a.keysAfter}</span></div>
        <div className="fg-blk-b">{p.waiting.length ? p.waiting.map(ask) : <span className="fg-mut">{a.noRequest}</span>}</div>
      </div>
      {api && asked.length > 0 && (
        <div className="fg-blk" data-block="decisions">
          <div className="fg-blk-h"><span className="atoi-mk asked" aria-hidden="true">?</span><b>{t.asks.sections.decisions}</b><span className="fg-sub">{asked.length} · {a.decisionsSub}</span></div>
          <div className="fg-blk-b">{asked.map(x => decision(x, api))}</div>
        </div>
      )}
      {p.asks && rigAsksShown(p.asks) && <RigAsks view={p.asks} sessions={p.sessions} machineLabel={p.asksMachine ?? 'local'} focus={p.askFocus ?? null}
        {...(p.askSourceOf ? { sourceOf: p.askSourceOf } : {})} {...(p.onOpenSeat ? { onOpenSeat: p.onOpenSeat } : {})} />}
      <div className="fg-blk">
        <div className="fg-blk-h"><PrIcon size={14} /><b>{f.view}</b><span className="fg-sub">{a.prsSub}</span></div>
        <div className="fg-blk-b">{p.prs.length ? p.prs.map(prRow) : <span className="fg-mut">{a.noPr}</span>}</div>
      </div>
      {near.length > 0 && (
        <div className="fg-blk" data-block="near">
          <div className="fg-blk-h"><span className="atoi-mk near" aria-hidden="true">◔</span><b>{a.near}</b><span className="fg-sub">{near.length}</span></div>
          <div className="fg-blk-b">{near.map(s => {
            const failed = s.handover?.state === 'failed';
            return (
              <div key={s.id} className="atoi-line" data-near={s.id}>
                <span className={`atoi-mk ${failed ? 'bad' : 'near'}`} aria-hidden="true">{failed ? '!' : '◔'}</span>
                <span className="grow" title={failed ? s.handover?.reason : t.handover.nearHint}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(s.name, Math.round((contextShare(s.context) ?? 0) * 100))}</span>
                <button type="button" className="fg-btn pri" title={t.handover.passTitle} onClick={() => p.onHandover?.(s.id)}>{failed ? t.handover.retry : t.handover.pass}</button>
                {!failed && <button type="button" className="fg-btn" onClick={() => p.onLater?.(s)}>{t.handover.later}</button>}
              </div>
            );
          })}</div>
        </div>
      )}
      <div className="fg-blk">
        <div className="fg-blk-h"><span className="fg-dot ok" aria-hidden="true" /><b>{a.finished}</b><span className="fg-sub">{done.length + closed.length}</span></div>
        <div className="fg-blk-b">{done.length + closed.length ? <>{done.map(s => (
          <div key={s.id} className="atoi-line">
            <span className="fg-dot ok" aria-hidden="true" /><ProviderLogo provider={providerOf(s.tool)} size={12} /><b>{s.name}</b>
            <span className="grow fg-mut">{s.lastReply!.text}</span>
            <button type="button" className="fg-btn" onClick={() => p.onOpen(s.id)}>{a.open}</button>
          </div>
        ))}{closed.map(x => (
          <div key={x.id} className="atoi-line" data-task={x.id}>
            <span className={`atoi-mk ${x.state === 'done' ? 'done' : 'bad'}`} aria-hidden="true">{x.state === 'done' ? '✓' : '!'}</span>
            <span className="grow">{pt.closed(x.ownerName, x.title, x.state as 'done' | 'refused' | 'dropped')} <span className="fg-mut">· {pt.ofLedge}</span></span>
            <button type="button" className="fg-btn" onClick={() => p.onSeeTask?.(x.id)}>{pt.see}</button>
            <button type="button" className="fg-btn" onClick={() => api?.seen(x.id)}>{pt.dismiss}</button>
          </div>
        ))}</> : <span className="fg-mut">{a.noFinished}</span>}</div>
      </div>
    </div>
  );
}
