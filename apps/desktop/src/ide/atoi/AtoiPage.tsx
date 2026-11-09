import { useEffect, useState, type JSX } from 'react';
import type { Fleet, FleetPullRequest } from '@ledge/fleet';
import type { ShownPr } from '../../forge/useForge';
import { isArchived, type Session } from '@ledge/protocol';
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
          <span className="grow"><b>{pr.ref}</b> {pr.title} <span className="fg-mut">· {f.host[pr.forge]} · {fail ? a.prFailed : a.prReady}</span></span>
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
      <div><h3>{a.title}</h3><span className="fg-sub">{a.sub}</span></div>
      <div className="fg-blk">
        <div className="fg-blk-h"><span className={`fg-dot ${perm ? 'fail' : p.waiting.length ? 'wait' : 'ok'}`} aria-hidden="true" /><b>{a.requests}</b><span className="fg-sub">{p.waiting.length}</span>
          <span className="fg-sp" /><span className="fg-sub">{a.keysBefore}<kbd>Y</kbd> / <kbd>N</kbd>{a.keysAfter}</span></div>
        <div className="fg-blk-b">{p.waiting.length ? p.waiting.map(ask) : <span className="fg-mut">{a.noRequest}</span>}</div>
      </div>
      <div className="fg-blk">
        <div className="fg-blk-h"><PrIcon size={14} /><b>{f.view}</b><span className="fg-sub">{a.prsSub}</span></div>
        <div className="fg-blk-b">{p.prs.length ? p.prs.map(prRow) : <span className="fg-mut">{a.noPr}</span>}</div>
      </div>
      <div className="fg-blk">
        <div className="fg-blk-h"><span className="fg-dot ok" aria-hidden="true" /><b>{a.finished}</b><span className="fg-sub">{done.length}</span></div>
        <div className="fg-blk-b">{done.length ? done.map(s => (
          <div key={s.id} className="atoi-line">
            <span className="fg-dot ok" aria-hidden="true" /><ProviderLogo provider={providerOf(s.tool)} size={12} /><b>{s.name}</b>
            <span className="grow fg-mut">{s.lastReply!.text}</span>
            <button type="button" className="fg-btn" onClick={() => p.onOpen(s.id)}>{a.open}</button>
          </div>
        )) : <span className="fg-mut">{a.noFinished}</span>}</div>
      </div>
    </div>
  );
}
