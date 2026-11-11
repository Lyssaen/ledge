import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PrDetail, PrJob, PullRequest } from '@ledge/protocol';
import { copy } from '../../copy';
import {
  PIPE_DOT, approvalsText, canMerge, duration, failedJob, inFoot, logCut, mergeConditions, shortSha, stagesOf, type MergeCondition, type Stage
} from '../../model/prs';
import { LinkStrip, hostName, useShell } from '../../shell/Shell';
import { useForge, type DetailRead, type ForgeRun, type ForgeStore } from '../../state/forge';
import { useMobile, type MobileStore } from '../../state/store';
import { iconButtonClass } from '../../ui/Button';
import { Sheet } from '../../ui/Dialog';
import { BackLink } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { Dot } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { Receipt, RigSheet, Spinner, Strip, rigButtonClass } from '../rigs/kit';
import { Cancel, CheckedButton } from '../rigs/sheets';
import { PipeChip, condText, dayTime, forgeWords, repoName } from './parts';
import { ForgeRunNote } from './runs';

/*
 * A request (m5-mr-pr.html, §3 and §8, the board PhonePR): its head, four views, the overview (the pipeline top to bottom, the failed
 * job's log under it, the description and the details), and at the bottom what a merge still needs. The list is enough to open it;
 * the rest comes with `forge.detail`. Merged or closed, it reads without a button; offline, the last detail read, greyed.
 */

const C = copy.prs;
type View = 'overview' | 'discussion' | 'changes' | 'commits';

/** The head: back, the number and the title, forge · repository · branch → target, and the request on its forge. */
function Head({ pr }: { pr: PullRequest }) {
  const wide = useWide();
  const w = forgeWords(pr);
  return (
    <header className={`flex flex-none items-center gap-2 border-b border-line pr-1.5 ${wide ? 'pane-head h-[58px]' : 'h-14 pl-0.5'}`}>
      <BackLink fallback={{ name: 'prs' }} label={C.title} />
      <span className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-[15px] font-semibold">{`${pr.ref} ${pr.title}`}</h1>
        <small className="truncate text-[12px] text-muted">{[w.host, repoName(pr.repo), `${pr.branch} → ${pr.target}`].join(' · ')}</small>
      </span>
      <a href={pr.url} target="_blank" rel="noreferrer" aria-label={C.openOn(w.host)} title={C.openOn(w.host)} className={iconButtonClass()}>
        <Icon name="external" className="size-[18px]" />
      </a>
    </header>
  );
}

/** The four views in a band that scrolls sideways on a phone (Q57): the overview with its pipeline's dot, the others with their count. */
function Views({ pr, d, view, onView }: { pr: PullRequest; d: PrDetail | undefined; view: View; onView: (v: View) => void }) {
  const counts: Partial<Record<View, number>> = d ? { discussion: d.threads.length, changes: d.files.length, commits: d.commits.length } : {};
  return (
    <nav aria-label={C.title} className="flex flex-none gap-0.5 overflow-x-auto overflow-y-hidden border-b border-line p-2 [scrollbar-width:none]">
      {(['overview', 'discussion', 'changes', 'commits'] as const).map(v => (
        <button
          key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => onView(v)}
          className="group inline-flex h-9 flex-none items-center gap-[5px] rounded-lg px-[7px] text-[13px] font-medium whitespace-nowrap text-muted aria-[current=page]:bg-raised aria-[current=page]:text-fg"
        >
          {v === 'overview' && <Dot state={PIPE_DOT[pr.pipeline]} pulse={pr.pipeline === 'run'} />}
          {C.tabs[v]}
          {counts[v] !== undefined && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-raised px-1 font-mono text-[11px] group-aria-[current=page]:bg-bg">{counts[v]}</span>}
        </button>
      ))}
    </nav>
  );
}

const JOB_BORDER: Record<PrJob['status'], string> = {
  ok: 'border-ok/40', fail: 'border-approval/60 bg-danger-bg/70', run: 'border-info/50', wait: 'border-line text-muted', skip: 'border-line text-muted', none: 'border-line text-muted'
};

/** What a job says on its right: its duration, « en cours » while it runs, else its state when it did not run. */
function jobRight(j: PrJob): ReactNode {
  if (j.status === 'run') return <span className="font-mono text-[12px] text-info">{C.pipe.run}</span>;
  const t = duration(j.durationS);
  if (t) return <span className="font-mono text-[12px] text-muted">{t.hours ? C.hours(t.text) : t.text}</span>;
  return j.status === 'wait' || j.status === 'skip' ? <span className="text-[12px]">{C.pipe[j.status]}</span> : null;
}

/** A job's row: its dot (a spinner while it runs), its name and its time; a tap opens its log. */
function JobRow({ job, selected, onOpen }: { job: PrJob; selected: boolean; onOpen?: (() => void) | undefined }) {
  const inner = (
    <>
      {job.status === 'run' ? <Spinner /> : <Dot state={PIPE_DOT[job.status]} />}
      <span className="min-w-0 flex-1 truncate">{job.name}</span>
      {jobRight(job)}
    </>
  );
  const className = `flex h-11 w-full items-center gap-2.5 rounded-[10px] border bg-surface px-3 text-left text-[14px] dark:bg-transparent ${JOB_BORDER[job.status]} ${selected ? 'shadow-[0_0_0_2px_var(--color-ring)]' : ''}`;
  return onOpen
    ? <button type="button" data-job={job.id} onClick={onOpen} className={className}>{inner}</button>
    : <div data-job={job.id} className={className}>{inner}</div>;
}

/** The link between two stages: green after a stage that passed, dashed red after one that failed, grey else. */
function Link({ after }: { after: Stage }) {
  const fail = after.jobs.some(j => j.status === 'fail');
  const ok = after.jobs.every(j => j.status === 'ok');
  return <span aria-hidden="true" className={`mt-[5px] mb-[5px] ml-[22px] block h-3 ${fail ? 'border-l-2 border-dashed border-approval' : `w-0.5 ${ok ? 'bg-ok' : 'bg-input'}`}`} />;
}

/** The pipeline top to bottom: a stage per `column`, numbered on GitLab, named as its workflow on GitHub. */
function Pipeline({ pr, jobs, selected, onJob }: { pr: PullRequest; jobs: readonly PrJob[]; selected: string | null; onJob: (j: PrJob) => void }) {
  const stages = stagesOf(jobs);
  return (
    <div className="flex flex-col">
      {stages.map((s, i) => (
        <div key={s.column} className="flex flex-col">
          {i > 0 && <Link after={stages[i - 1]!} />}
          <div className="mb-[5px] text-[11px] tracking-[.5px] text-muted uppercase">{pr.forge === 'gitlab' ? C.stage(i + 1, s.name) : s.name}</div>
          <div className="flex flex-col gap-1.5">
            {s.jobs.map(j => <JobRow key={j.id} job={j} selected={j.id === selected} onOpen={j.id === selected ? undefined : () => onJob(j)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A log as the PC sends it: its last 60 lines, already masked. */
const LogText = ({ text, tall = false }: { text: string; tall?: boolean }) => (
  <pre className={`m-0 overflow-hidden rounded-[10px] border border-white/10 bg-[#0c0c0d] px-[11px] py-[9px] font-mono text-[11.5px] leading-[17px] break-all whitespace-pre-wrap text-[#e5e5e5] ${tall ? 'max-h-[300px] overflow-y-auto' : ''}`}>{text}</pre>
);

/** The log of `job`: while it is read, once it came, or why it did not. */
function LogBlock({ job, read, pr, onRetry, tall = false }: { job: PrJob; read: DetailRead | undefined; pr: PullRequest; onRetry: () => void; tall?: boolean }) {
  const w = forgeWords(pr);
  const log = read?.data?.log?.jobId === job.id ? read.data.log.text : null;
  if (log !== null) return <LogText text={log} tall={tall} />;
  if (read?.loading) return <div role="status" className="flex items-center gap-2 text-[12px] text-muted"><Spinner className="text-muted" />{C.log.reading(job.name)}</div>;
  return (
    <Receipt mark="bad" title={C.log.failed} sub={C.log.failedBody(w.cli, w.host)}>
      <button type="button" onClick={onRetry} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.retry}</button>
    </Receipt>
  );
}

/** Another job's log, in a sheet: its dot and name, its state and time, the lines, what they are, the forge and « Fermer ». */
function LogSheet({ job, read, pr, onRetry, onClose }: { job: PrJob; read: DetailRead | undefined; pr: PullRequest; onRetry: () => void; onClose: () => void }) {
  const id = useId();
  const w = forgeWords(pr);
  const t = duration(job.durationS);
  const log = read?.data?.log?.jobId === job.id ? read.data.log.text : null;
  return (
    <Sheet labelledBy={id} onClose={onClose}>
      <div className="flex items-center gap-2">
        <Dot state={PIPE_DOT[job.status]} />
        <h2 id={id} className="text-[15px] font-semibold">{C.log.title(job.name)}</h2>
        <span className="text-[12px] text-muted">{[C.pipe[job.status], t ? (t.hours ? C.hours(t.text) : t.text) : ''].filter(Boolean).join(' · ')}</span>
      </div>
      <LogBlock job={job} read={read} pr={pr} onRetry={onRetry} tall />
      {log !== null && <p className="m-0 text-[12px] leading-4 text-muted">{[C.log.note, logCut(log) ? C.log.cut(w.host) : ''].filter(Boolean).join(' ')}</p>}
      <div className="flex flex-col gap-2">
        <a href={pr.url} target="_blank" rel="noreferrer" className={rigButtonClass()}><Icon name="external" className="size-4" />{C.openOn(w.host)}</a>
        <button type="button" onClick={onClose} className={rigButtonClass()}>{C.close}</button>
      </div>
    </Sheet>
  );
}

/** A description as Desktop shows it: paragraphs, and the lists of « - » lines. */
function Md({ text }: { text: string }) {
  return (
    <div className="text-[13.5px] leading-5">
      {text.split(/\n\n+/).map((b, i) => {
        const lines = b.split('\n');
        return lines.every(l => l.startsWith('- '))
          ? <ul key={i} className="mt-1 list-disc pl-[18px]">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>
          : <p key={i} className="m-0 whitespace-pre-wrap">{b}</p>;
      })}
    </div>
  );
}

const REVIEWER_DOT = { approved: 'idle', changes: 'perm', pending: 'plain' } as const;

/** The author, the reviewers with their verdict, the labels, the tickets it closes. */
function Details({ d }: { d: PrDetail }) {
  const dt = 'text-muted';
  const dd = 'm-0 flex min-w-0 flex-wrap items-center gap-1.5';
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 border-t border-line pt-2.5 text-[13px]">
      <dt className={dt}>{C.author}</dt><dd className={dd}>{d.author}</dd>
      {d.reviewers.map((r, i) => (
        <div key={r.name} className="contents">
          <dt className={dt}>{i === 0 ? C.reviewers : ''}</dt>
          <dd className={dd}><Dot state={REVIEWER_DOT[r.state]} />{r.name} <span className="text-muted">{C.reviewer[r.state]}</span></dd>
        </div>
      ))}
      {d.labels.length > 0 && <><dt className={dt}>{C.labels}</dt><dd className={dd}>{d.labels.map(l => <span key={l} className="rounded-full border border-line px-2 text-[12px]">{l}</span>)}</dd></>}
      {d.issues.length > 0 && <><dt className={dt}>{C.issue}</dt><dd className={`${dd} font-mono text-[12px]`}>{d.issues.join(' ')}</dd></>}
    </dl>
  );
}

/** « Pour fusionner »: Desktop's list, the missing first, then what is met. */
function ToMerge({ conds, host }: { conds: MergeCondition[]; host: string }) {
  return (
    <section aria-label={C.toMerge} className="flex-none overflow-hidden rounded-[10px] border border-line bg-surface dark:bg-transparent">
      <div className="flex min-h-11 items-center border-b border-line px-3"><b className="text-[14px] font-semibold">{C.toMerge}</b></div>
      <ul className="m-0 flex list-none flex-col gap-1 p-2.5 text-[13px]">
        {conds.map((c, i) => (
          <li key={i} data-cond={c.ok ? 'ok' : c.key} className="flex items-baseline gap-2">
            <span aria-hidden="true" className={`w-3.5 flex-none text-center text-[12px] font-semibold ${c.ok ? 'text-ok' : 'text-approval'}`}>{c.ok ? '✓' : '✕'}</span>
            <span className={c.key === 'raw' ? 'font-mono' : ''}>{condText(c, host)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The footer's words: the approvals, then the first thing missing; ready, the pipeline and the approvals. */
export function footWords(d: PrDetail, host: string): ReactNode {
  const conds = mergeConditions(d);
  const missing = conds.find(c => !c.ok);
  if (missing) return <>{C.footApprovals(approvalsText(d.pr))} · <b className="font-medium text-fg">{inFoot(condText(missing, host), missing)}</b></>;
  const pipe = conds.find(c => c.key === 'pipeline' || c.key === 'noCi')!;
  const appr = conds.find(c => c.key === 'approved')!;
  return `${condText(pipe, host)} · ${inFoot(condText(appr, host), appr)}`;
}

/** The skeleton of the jobs while the detail comes, the pipeline's state already from the list. */
function Loading() {
  const sk = 'block animate-[ledge-pulse_1.6s_ease-in-out_infinite] rounded-[10px] bg-raised';
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <span aria-hidden="true" className={`${sk} h-11`} /><span aria-hidden="true" className={`${sk} h-11`} /><span aria-hidden="true" className={`${sk} h-[60px]`} />
      <span className="text-[12px] leading-4 text-muted">{C.detailLoading}</span>
    </div>
  );
}

/** The overview: the pipeline and the failed job's log, « Pour fusionner », the description, the details. */
function Overview({ pr, read, onJob, onLog }: { pr: PullRequest; read: DetailRead | undefined; onJob: (j: PrJob) => void; onLog: (j: PrJob) => void }) {
  const d = read?.data;
  const w = forgeWords(pr);
  const failed = d ? failedJob(d.jobs) : null;
  const open = pr.state !== 'merged' && pr.state !== 'closed';
  const pipeNote = pr.pipeline === 'none' ? C.noCi : d?.mergeBlockers.includes('pipeline_not_started') ? C.notStarted : null;
  return (
    <>
      <div className="flex items-center gap-2"><h2 className="m-0 text-[15px] font-semibold">{C.pipelineTitle}</h2><PipeChip pipeline={pr.pipeline} short /></div>
      {pipeNote && <p className="m-0 text-[12px] text-muted">{pipeNote}</p>}
      {!d ? <Loading /> : (
        <>
          {d.jobs.length > 0 && <Pipeline pr={pr} jobs={d.jobs} selected={failed?.id ?? null} onJob={onJob} />}
          {failed && (
            <>
              <div className="flex items-center gap-2 text-[12px] text-muted"><span>{`${C.log.title(failed.name)} · ${C.log.lines}`}</span></div>
              <LogBlock job={failed} read={read} pr={pr} onRetry={() => onLog(failed)} />
            </>
          )}
          {open && <ToMerge conds={mergeConditions(d)} host={w.host} />}
          {d.description && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
              <h2 className="m-0 text-[15px] font-semibold">{C.description}</h2>
              <Md text={d.description} />
            </div>
          )}
          <Details d={d} />
        </>
      )}
    </>
  );
}

/** Why a detail could not be read, in its words, never the PC's (§8). */
function ReadError({ read, pr, pc, onRetry }: { read: DetailRead; pr: PullRequest; pc: string; onRetry: () => void }) {
  const w = forgeWords(pr);
  if (read.error === 'unavailable') return <Receipt mark="warn" title={C.gone(w.kind, pc)} sub={C.goneBody} />;
  if (read.error === 'too_large') {
    return <Receipt mark="bad" title={C.tooLarge} sub={C.tooLargeBody(w.host)}><a href={pr.url} target="_blank" rel="noreferrer" className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.open}</a></Receipt>;
  }
  return (
    <Receipt mark="bad" title={C.readFailed(w.cli, w.kind)} sub={C.readFailedBody}>
      <button type="button" onClick={onRetry} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.retry}</button>
    </Receipt>
  );
}

/** « Fusionner #231 dans main ? »: the exact command the PC runs, the head read, then the device's check over this very merge (§4, Q54). */
function MergeSheet({ d, pc, confirm, live, onMerge, onClose }: { d: PrDetail; pc: string; confirm: boolean; live: boolean; onMerge: () => void; onClose: () => void }) {
  return (
    <RigSheet title={C.confirm(d.pr.ref, d.pr.target)} onClose={onClose}>
      <span className="text-[12.5px] text-muted">{C.runsOn(pc)}</span>
      <code className="block rounded-md bg-raised px-2 py-1.5 font-mono text-[12px] break-all">{d.mergeCommand}</code>
      <p className="m-0 text-[12px] leading-4 text-muted">{C.headRead(shortSha(d.pr.headSha))}</p>
      <CheckedButton verb={C.merge} confirm={confirm} disabled={!live} onClick={() => { onClose(); onMerge(); }} />
      <Cancel onClose={onClose} />
    </RigSheet>
  );
}

/** A run on this request still to show: the last one, under way or not dismissed. */
const lastRun = (runs: readonly ForgeRun[], id: string): ForgeRun | undefined => runs.filter(r => r.prId === id).at(-1);
const going = (r: ForgeRun | undefined) => !!r && (r.phase === 'checking' || r.phase === 'sending' || r.phase === 'received');

/** A request of the MR/PR tab (`#/prs/<id>`). */
export function PrView({ id, forge, store }: { id: string; forge: ForgeStore; store: MobileStore }) {
  const f = useForge(forge);
  const m = useMobile(store);
  const [merging, setMerging] = useState(false);
  const { pc, look } = useShell();
  const wide = useWide();
  const [view, setView] = useState<View>('overview');
  const [sheetJob, setSheetJob] = useState<string | null>(null);
  const offline = look === 'offline';
  const name = hostName(pc);
  const read = f.details[id];
  const listed = f.state?.prs.find(p => p.id === id);
  const pr = listed ?? read?.data?.pr;

  // Opening reads the detail; a failed pipeline's log comes with a second read, once its job is known (Q58).
  useEffect(() => { forge.readDetail(id); }, [forge, id]);
  const failed = read?.data ? failedJob(read.data.jobs) : null;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!failed || read?.data?.log?.jobId === failed.id || asked.current === failed.id) return;
    asked.current = failed.id;
    forge.readDetail(id, failed.id);
  }, [forge, id, failed?.id, read?.data?.log?.jobId]);

  const scroll = `tab-main flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pb-[18px] ${wide ? 'pt-[18px]' : 'pt-3'}`;
  // A request the list no longer holds, and never read: it is not followed any more (§4, §8).
  if (!pr) {
    return (
      <main data-tab-scroll="" className={scroll}>
        {f.state
          ? <Receipt mark="warn" title={C.gone(C.kind[f.state.forges.find(x => x.host === id.split('/')[0])?.forge ?? 'github'], name)} sub={C.goneBody} />
          : <Strip lead={<Spinner className="text-muted" />}><span>{C.loading}</span></Strip>}
      </main>
    );
  }
  const w = forgeWords(pr);
  const d = read?.data;
  const done = pr.state === 'merged' || pr.state === 'closed';
  const gone = !!f.state && !listed;
  const job = sheetJob && d ? d.jobs.find(j => j.id === sheetJob) : undefined;
  const openLog = (j: PrJob) => { forge.readDetail(id, j.id); };
  const run = lastRun(f.runs, id);
  const busy = going(run);
  const live = m.fresh && !offline;
  // The merge names the head the person read: the detail's, which a new head in the list reads again.
  const merge = () => { if (d) void forge.act(id, { kind: 'merge', headSha: d.pr.headSha }); };

  return (
    <>
      <Head pr={pr} />
      <Views pr={pr} d={d} view={view} onView={setView} />
      <main data-tab-scroll="" className={scroll}>
        <LinkStrip body={C.offlineBody} />
        {gone && !run && <Receipt mark="warn" title={C.gone(w.kind, name)} sub={C.goneBody} />}
        {run && <ForgeRunNote run={run} pr={pr} detail={d} forge={forge} pc={name} onReload={() => forge.readDetail(id)} />}
        {read?.error && !d && <ReadError read={read} pr={pr} pc={name} onRetry={() => forge.readDetail(id)} />}
        {read?.cut && <Strip lead={<Icon name="alert" className="mt-px size-4 text-muted" />}><span>{C.cut(w.host)}</span></Strip>}
        <div className={`flex flex-col gap-2.5 ${offline ? 'opacity-50' : ''}`}>
          {view === 'overview' && (!read?.error || d) && (
            <Overview pr={pr} read={read} onJob={j => { setSheetJob(j.id); openLog(j); }} onLog={openLog} />
          )}
        </div>
      </main>
      <footer className="flex flex-none items-center gap-2.5 border-t border-line bg-sidebar px-3.5 py-[9px]">
        {done ? (
          <span data-foot="done" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[12px] leading-4 text-muted">
            <span className="inline-flex h-[22px] items-center rounded-full border border-input px-[9px] text-[12px] font-medium">{C.state[pr.state]}</span>
            {pr.state === 'merged' ? C.mergedInto(pr.target, dayTime(pr.updatedAt)) : dayTime(pr.updatedAt)}
          </span>
        ) : (
          <>
            <span data-foot="why" className="min-w-0 flex-1 text-[12px] leading-4 text-muted">{d ? footWords(d, w.host) : C.footApprovals(approvalsText(pr))}</span>
            <button type="button" disabled={!live || gone || busy || !d || !canMerge(d)} onClick={() => setMerging(true)} className={rigButtonClass({ tone: 'primary', className: 'h-[42px]' })}>
              <Icon name="merge" className="size-4" />{C.merge}
            </button>
          </>
        )}
      </footer>
      {merging && d && <MergeSheet d={d} pc={name} confirm={!!m.device?.confirm} live={live} onMerge={merge} onClose={() => setMerging(false)} />}
      {job && <LogSheet job={job} read={read} pr={pr} onRetry={() => openLog(job)} onClose={() => setSheetJob(null)} />}
    </>
  );
}
