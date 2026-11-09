import { useCallback, useEffect, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { Fleet, FleetPullRequest } from '@ledge/fleet';
import type { ForgeAction, PrDetail, PrFile, PrThread, PrReviewer } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { PipeDot, PipeGraph } from './PipeGraph';
import { ProviderLogo } from '../ide/ProviderLogo';
import type { Provider } from '../workspace/sessionTab';
import { MergeConfirm } from './MergeConfirm';
import { canMerge, mergeConditions, type MachineReach, type MergeCondition } from './states';
import '../styles/forge.css';

export type PrView = 'pipe' | 'disc' | 'diff' | 'commits';

/** The agent on the request's branch: its session or seat. */
export interface PrAgent { name: string; provider: Provider }

export interface PrPageProps {
  pr: FleetPullRequest & { stale?: boolean };
  /** Its machine: whether it can be acted on (states 4, 5), its name, when its requests were last read. */
  reach?: MachineReach; machine?: string; readAt?: number | null;
  fleet: Pick<Fleet, 'prDetail' | 'prAct'>;
  agent: PrAgent | null;
  /** Sends `text` to the agent (a message to the session, a `rig send` to a seat); false when it was refused. */
  onAskAgent(text: string): boolean;
  /** « Ouvrir X »: the agent's tab, to the right. */
  onOpenAgent(): void;
  /** « Ouvrir sur GitHub / GitLab »: the system browser. */
  onOpenUrl(url: string): void;
  notify(text: string): void;
}

/** A comment or a reply not posted (state 9): the reason under its field, the text kept, « Réessayer ». */
function NotPosted({ reason, onRetry }: { reason: string; onRetry(): void }): JSX.Element {
  const { t } = useI18n();
  return <div className="fg-ferr" role="alert"><span>{t.forge.notPosted(reason)}</span><button type="button" className="fg-btn sm" onClick={onRetry}>{t.forge.retry}</button></div>;
}

/** The mockup's `md`: paragraphs, and blocks whose every line starts with « - » as lists. Text only, never HTML. */
function Md({ text }: { text: string }): JSX.Element {
  return <>{text.split(/\n\n+/).map((b, i) => {
    const lines = b.split('\n');
    return lines.every(l => l.startsWith('- ')) ? <ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul> : <p key={i}>{b}</p>;
  })}</>;
}

const hm = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };
const base = (path: string) => path.split('/').pop() ?? path;
const REVIEWER_DOT: Record<PrReviewer['state'], 'ok' | 'fail' | 'wait'> = { approved: 'ok', changes: 'fail', pending: 'wait' };

/** A patch's lines, as the mockup's hunks: `@@` a header, `+` added, `-` removed, the rest context. */
function Patch({ file, empty }: { file: PrFile; empty: string }): JSX.Element {
  if (!file.patch) return <div className="fg-code"><div className="h">{empty}</div></div>;
  return (
    <div className="fg-code">
      {file.patch.split('\n').map((l, i) => <div key={i} className={l.startsWith('@@') ? 'h' : l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : undefined}>{l || ' '}</div>)}
    </div>
  );
}

/** A request in a tab (mockup prPage): its head (forge, ref, title, state, « Ouvrir sur … »), the line of its branch, and four
 *  views. « Vue d'ensemble »: description, details, the pipeline's graph with the failed job's log, « Relancer » and « Demander à
 *  X de corriger », the review with « Fusionner ». « Discussion »: the threads (reply, resolve, send one to the agent), « Tout
 *  envoyer à X », a new comment. « Modifications »: the files and the chosen one's patch with its threads. « Commits ». The
 *  detail is asked of the machine that read the request, again when it changes. */
type Failure = { code?: string; message?: string };
export function PrPage({ pr, fleet, agent, onAskAgent, onOpenAgent, onOpenUrl, notify, reach = 'ok', machine = pr.machineId, readAt = null }: PrPageProps): JSX.Element {
  const { t } = useI18n();
  const f = t.forge;
  // The merge's confirmation, open under the review (MergeConfirm).
  const [merge, setMerge] = useState(false);
  const [failed_, setFailed] = useState<Record<string, string>>({});
  // Its machine down, offline, or the request as last read: every action off, its reason in the tip; « Ouvrir sur … » stays.
  const down = !!pr.stale || reach === 'offline' || reach === 'daemonDown';
  const why = down ? f.machineOffline(machine) : undefined;
  const reason = (e: Failure) => (e?.code === 'busy' ? f.busy : e?.code === 'offline' ? f.machineOffline(machine) : e?.message || '');
  const [view, setView] = useState<PrView>('pipe');
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [log, setLog] = useState<PrDetail['log'] | null>(null);
  const [file, setFile] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN(x => x + 1), []);

  // The detail, again when the request moves (a push, a pipeline, a comment), and the failed job's log.
  useEffect(() => {
    let live = true;
    fleet.prDetail(pr.id, pr.machineId).then(d => {
      if (!live) return;
      setDetail(d);
      const failed = d.jobs.find(j => j.status === 'fail');
      if (failed) fleet.prDetail(pr.id, pr.machineId, { log: failed.id }).then(x => { if (live) setLog(x.log ?? null); }, () => {});
      else setLog(null);
    }, (e: { message?: string }) => { if (live && e?.message) notify(e.message); });
    return () => { live = false; };
  }, [fleet, pr.id, pr.machineId, pr.updatedAt, pr.headSha, pr.pipeline, n]); // eslint-disable-line react-hooks/exhaustive-deps

  /** An action; its failure where the user looks (state 9): under its field for a comment or a reply (`field`, the text
   *  kept), else a toast. */
  const act = (action: ForgeAction, then?: () => void, field?: string) => {
    if (field) setFailed(x => { const { [field]: _, ...rest } = x; return rest; });
    fleet.prAct(pr.id, pr.machineId, action).then(r => { then?.(); if (action.kind === 'rerun' && r.command) notify(r.command); reload(); },
      (e: Failure) => {
        const r = reason(e);
        if (field) setFailed(x => ({ ...x, [field]: r }));
        else if (action.kind === 'resolve') notify(f.resolveFailed(r));
        else if (action.kind === 'rerun') notify(f.rerunFailed(r));
        else if (r) notify(r);
      });
  };
  const draft = (k: string) => drafts[k] ?? '';
  const setDraft = (k: string, v: string) => setDrafts(d => ({ ...d, [k]: v }));
  const onEnter = (k: string, send: (body: string) => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const body = draft(k).trim();
    if (body) send(body);
  };

  const merged = pr.state === 'merged';
  const threads = detail?.threads ?? [];
  const unresolved = threads.filter(x => !x.resolved);
  const comments = threads.reduce((s, x) => s + x.comments.length, 0);
  const failed = detail?.jobs.find(j => j.status === 'fail');
  const where = (x: PrThread) => (x.file && x.line !== undefined ? `${base(x.file)}:${x.line}` : null);
  const appr = `${pr.approvals.given}${pr.approvals.required !== undefined ? `/${pr.approvals.required}` : ''}`;

  const conditions: MergeCondition[] = detail ? mergeConditions(pr, detail) : [];
  const ready = detail !== null && canMerge(conditions);
  const conditionText = (c: MergeCondition): string => {
    if (c.ok) return c.key === 'approved' ? f.ok.approved(c.given, c.required) : f.ok[c.key];
    switch (c.key) {
      case 'draft': return f.blocker.draft(f.host[pr.forge]);
      case 'approvals': return f.blocker.approvals(c.given, c.required);
      case 'changes_requested': return f.blocker.changes_requested(c.who);
      case 'raw': return c.code;
      default: return f.blocker[c.key];
    }
  };
  const askFix = () => { if (failed && onAskAgent(f.fixText(pr.ref, failed.name))) onOpenAgent(); };
  const sendAll = () => {
    if (onAskAgent(f.notesText(pr.ref, unresolved.map(x => f.note(x.comments[0]!.author, where(x), x.comments[0]!.body))))) onOpenAgent();
  };
  const sendThread = (x: PrThread) => {
    if (onAskAgent(f.threadText(pr.ref, x.comments[0]!.author, where(x), x.comments[0]!.body))) { notify(f.sentTo(agent!.name)); onOpenAgent(); }
  };

  const comment = (c: PrThread['comments'][number]) => (
    <div key={c.id} className="fg-c">
      <span className="fg-av" aria-hidden="true">{(c.author[0] ?? '?').toUpperCase()}</span><b>{c.author}</b><span className="fg-c-at">{hm(c.at)}</span>
      <div>{c.body}</div>
    </div>
  );
  const thread = (x: PrThread, compact = false) => (
    <div key={x.id} className={`fg-th${x.resolved ? ' res' : ''}`}>
      {x.file && x.line !== undefined && (compact
        ? <div className="fg-mono fg-mut" style={{ fontSize: 11 }}>{f.line(x.line)}</div>
        : <><div className="fg-mono fg-mut" style={{ fontSize: 11 }}>{f.fileLine(x.file, x.line)}</div>{x.code && <div className="fg-code"><div className="a">{x.code}</div></div>}</>)}
      {x.comments.map(comment)}
      {x.resolved ? <span className="fg-mut" style={{ fontSize: 11.5 }}>{f.resolved}</span> : (
        <div className="fg-go">
          <input className={`fg-cin small${failed_[`r:${x.id}`] !== undefined ? ' bad' : ''}`} aria-label={f.replyPh} placeholder={f.replyPh} value={draft(`r:${x.id}`)} onChange={e => setDraft(`r:${x.id}`, e.target.value)}
            disabled={down} title={why} onKeyDown={onEnter(`r:${x.id}`, body => act({ kind: 'reply', threadId: x.id, body }, () => setDraft(`r:${x.id}`, ''), `r:${x.id}`))} />
          {x.resolvable && <button type="button" className="fg-btn" disabled={down} title={why} onClick={() => act({ kind: 'resolve', threadId: x.id })}>{f.resolve}</button>}
          {agent && <button type="button" className="fg-btn" disabled={down} title={why ?? f.sendThreadTip} onClick={() => sendThread(x)}><ProviderLogo provider={agent.provider} size={12} />{agent.name}</button>}
          {failed_[`r:${x.id}`] !== undefined && <NotPosted reason={failed_[`r:${x.id}`]!} onRetry={() => { const body = draft(`r:${x.id}`).trim(); if (body) act({ kind: 'reply', threadId: x.id, body }, () => setDraft(`r:${x.id}`, ''), `r:${x.id}`); }} />}
        </div>
      )}
    </div>
  );

  const files = detail?.files ?? [];
  const k = Math.min(file, Math.max(0, files.length - 1));
  const tabs: [PrView, ReactNode][] = [
    ['pipe', <><PipeDot status={pr.pipeline} />{f.tabs.pipe}</>],
    ['disc', f.tabs.disc(comments)],
    ['diff', f.tabs.diff(files.length)],
    ['commits', f.tabs.commits(detail?.commits.length ?? 0)]
  ];

  let body: ReactNode;
  if (!detail) body = <span className="fg-mut">{f.loading}</span>;
  else if (view === 'diff') {
    const sel = files[k];
    const added = files.reduce((s, x) => s + x.added, 0), removed = files.reduce((s, x) => s + x.removed, 0);
    body = !sel ? <span className="fg-mut">{f.noChange}</span> : (
      <div className="fg-blk">
        <div className="fg-blk-h"><b>{f.files}</b><span className="fg-sub"><span className="fg-add">+{added}</span> <span className="fg-del">−{removed}</span> · {f.fileCount(files.length)}</span></div>
        <div className="fg-blk-b">
          <div className="fg-files" role="listbox" aria-label={f.files}>
            {files.map((x, i) => (
              <button key={x.path} type="button" role="option" aria-selected={i === k} className={i === k ? 'on' : undefined} onClick={() => setFile(i)}>
                <span>{x.path}</span><span className="p"><span className="fg-add">+{x.added}</span>{x.removed > 0 && <span className="fg-del">−{x.removed}</span>}</span>
              </button>
            ))}
          </div>
          <Patch file={sel} empty={f.noChange} />
          {threads.filter(x => x.file === sel.path).map(x => thread(x, true))}
        </div>
      </div>
    );
  } else if (view === 'disc') {
    body = (
      <div className="fg-blk">
        <div className="fg-blk-h"><b>{f.discussion}</b><span className="fg-sub">{f.discSub(unresolved.length, threads.length - unresolved.length)}</span><span className="fg-sp" />
          {unresolved.length > 0 && agent && !merged && <button type="button" className="fg-btn" disabled={down} title={why} onClick={sendAll}>{f.sendAll(agent.name)}</button>}</div>
        <div className="fg-blk-b">
          {threads.length ? threads.map(x => thread(x)) : <span className="fg-mut">{f.noComment}</span>}
          <div className="fg-go">
            <input className={`fg-cin${failed_.c !== undefined ? ' bad' : ''}`} aria-label={f.addComment} placeholder={f.addComment} value={draft('c')} onChange={e => setDraft('c', e.target.value)}
              disabled={down} title={why} onKeyDown={onEnter('c', body => act({ kind: 'comment', body }, () => setDraft('c', ''), 'c'))} />
          </div>
          {failed_.c !== undefined && <NotPosted reason={failed_.c} onRetry={() => { const body = draft('c').trim(); if (body) act({ kind: 'comment', body }, () => setDraft('c', ''), 'c'); }} />}
        </div>
      </div>
    );
  } else if (view === 'commits') {
    body = (
      <div className="fg-blk"><div className="fg-blk-b">
        {detail.commits.map(c => <div key={c.sha} className="fg-crow"><span className="sha">{c.sha.slice(0, 7)}</span><b>{c.title}</b><span className="fg-mut">{c.author} · {hm(c.at)}</span></div>)}
      </div></div>
    );
  } else {
    body = <>
      <div className="fg-grid">
        <div className="fg-blk"><div className="fg-blk-h"><b>{f.description}</b></div><div className="fg-blk-b fg-desc"><Md text={detail.description} /></div></div>
        <div className="fg-blk"><div className="fg-blk-h"><b>{f.details}</b></div><div className="fg-blk-b"><div className="fg-kv">
          <span>{f.author}</span><span>{agent ? <span className="fg-cell"><ProviderLogo provider={agent.provider} size={12} />{agent.name}</span> : detail.author || '—'}</span>
          <span>{f.reviewers}</span><span>{detail.reviewers.map(r => <span key={r.name} className="fg-cell"><PipeDot status={REVIEWER_DOT[r.state]} />{r.name} <span className="fg-mut">{f.reviewer[r.state]}</span></span>)}</span>
          <span>{f.labels}</span><span>{detail.labels.map(l => <span key={l} className="fg-pill">{l}</span>).reduce<ReactNode[]>((a, x) => (a.length ? [...a, ' ', x] : [x]), [])}</span>
          <span>{f.issue}</span><span className="fg-mono">{detail.issues.join(' ')}</span>
          <span>{f.approvals}</span><span>{appr}</span>
        </div></div></div>
      </div>
      <div className="fg-blk">
        <div className="fg-blk-h"><PipeDot status={pr.pipeline} /><b>{f.pipeline}</b><span className="fg-pill">{f.pipe[pr.pipeline]}</span><span className="fg-sp" />
          {pr.pipeline !== 'run' && !merged && <button type="button" className="fg-btn" disabled={down} title={why} onClick={() => act({ kind: 'rerun' })}>{f.rerun}</button>}</div>
        <div className="fg-blk-b">
          <div className="fg-graph-wrap"><PipeGraph jobs={detail.jobs} /></div>
          {failed && log && log.jobId === failed.id && <div className="fg-log" data-keep-scroll>{log.text}</div>}
          {failed && agent && <div className="fg-go">
            <button type="button" className="fg-btn pri" disabled={down} title={why} onClick={askFix}>{f.askFix(agent.name)}</button>
            <button type="button" className="fg-btn" onClick={onOpenAgent}>{f.openAgent(agent.name)}</button>
          </div>}
        </div>
      </div>
      <div className="fg-blk">
        <div className="fg-blk-h"><b>{f.review}</b><span className="fg-sub">{f.reviewSub(appr, unresolved.length)}</span><span className="fg-sp" />
          <button type="button" className="fg-btn" onClick={() => setView('disc')}>{f.seeDiscussion}</button>
          {/* State 6: visible, off while a condition is missing; state 7: the main button once they all are met. */}
          {!merged && <button type="button" className={`fg-btn${ready ? ' pri' : ''}`} disabled={!ready || down} title={why}
            aria-expanded={merge} onClick={() => setMerge(true)}>{f.merge}</button>}
        </div>
        <div className="fg-blk-b">
          {!merged && <div className="fg-check" role="list" aria-label={f.toMerge}>
            <span className="fg-sub">{f.toMerge}</span>
            {conditions.map((c, i) => <div key={i} role="listitem" className={c.ok ? 'y' : 'n'}><span aria-hidden="true">{c.ok ? '✓' : '✕'}</span>{conditionText(c)}</div>)}
          </div>}
          {merge && detail && <MergeConfirm pr={pr} fleet={fleet} command={detail.mergeCommand} machine={machine} notify={notify} blocked={!ready || down} why={why}
            onDone={() => { setMerge(false); reload(); }} onReload={() => { setMerge(false); reload(); }} onCancel={() => setMerge(false)} />}
          {unresolved.length ? unresolved.slice(-2).map(x => comment(x.comments[0]!)) : <span className="fg-mut">{f.nothing}</span>}
        </div>
      </div>
    </>;
  }

  return (
    <div className="fg-page" data-keep-scroll>
      {down && <div className="fg-banner off" role="status"><span className="fg-dot" aria-hidden="true" />
        <span>{(reach === 'daemonDown' ? f.daemonDown : f.offline)(machine, readAt === null ? '' : hm(new Date(readAt).toISOString()))}</span></div>}
      <div className="fg-head">
        <span className="fg-pill">{f.kind[pr.forge]}</span><h3>{pr.ref} {pr.title}</h3>
        <span className={`fg-pill${merged ? ' run' : ''}`}>{f.state[pr.state]}</span><span className="fg-sp" />
        <button type="button" className="fg-btn" onClick={() => onOpenUrl(pr.url)}>{f.openOn(f.host[pr.forge])}</button>
      </div>
      <span className="fg-sub fg-mono">{[pr.repo, `${pr.branch} → ${pr.target}`, ...(agent ? [agent.name] : []), ...(detail?.issues ?? [])].join(' · ')}</span>
      <div className="fg-seg" role="tablist" aria-label={pr.ref}>
        {tabs.map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>{label}</button>)}
      </div>
      {body}
    </div>
  );
}
