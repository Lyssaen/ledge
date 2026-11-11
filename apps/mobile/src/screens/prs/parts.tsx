import type { ReactNode } from 'react';
import type { PhoneForgeStatus, PhoneSession, PipeStatus, PullRequest } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import { cliOf, PIPE_DOT, type MergeCondition } from '../../model/prs';
import { daysAgo } from '../../model/rigs';
import { Icon } from '../../ui/icons';
import { Dot } from '../../ui/kit/marks';
import { clock } from '../Inbox';
import { Chip, type ChipTone } from '../rigs/kit';

/*
 * The MR/PR tab's own marks (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html): a pipeline's chip, a request's row, the words of a
 * forge (its host, its CLI, what it calls a request) and a day as the folded rows and the commits say it.
 */

const C = copy.prs;

/** A pipeline's chip tone: green passed, blue running, red failed, amber waiting, grey skipped or without CI. */
export const PIPE_TONE: Record<PipeStatus, ChipTone> = { ok: 'on', run: 'go', fail: 'bad', wait: 'part', skip: 'plain', none: 'plain' };

/** « pipeline échoué » in a row, « échoué » beside « Pipeline » (`short`); « sans CI » has no dot. */
export function PipeChip({ pipeline, short = false }: { pipeline: PipeStatus; short?: boolean }) {
  return <Chip tone={PIPE_TONE[pipeline]} flat={pipeline === 'none'}>{short ? C.pipe[pipeline] : C.pipeline[pipeline]}</Chip>;
}

/** The last part of a repository's path, as a row names it (« synapse » for `team/synapse`). */
export const repoName = (repo: string): string => repo.split('/').at(-1) ?? repo;

/** The words a forge's sentences need: its host's name (GitHub), its CLI (glab), what it calls a request (MR). */
export const forgeWords = (f: Pick<PullRequest, 'forge'> | Pick<PhoneForgeStatus, 'forge'>) => ({ host: C.host[f.forge], cli: cliOf(f.forge), kind: C.kind[f.forge] });

/** The sessions of the branch, most active first, as the phone knows them. */
export const sessionsOf = (pr: PullRequest, sessions: ReadonlyMap<string, PhoneSession>): PhoneSession[] =>
  pr.sessions.map(id => sessions.get(id)).filter((s): s is PhoneSession => !!s);

/** A day as a folded row says it: today's time, « hier », the weekday within a week, else the date. */
export function dayWord(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago <= 0) return clock(iso);
  if (ago === 1) return C.yesterday;
  if (ago < 7) return d.toLocaleDateString(locale, { weekday: 'long' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** A day with its time, as a commit or a merge says it: « aujourd'hui 10:24 », « hier 18:40 », else the date and the time. */
export function dayTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const t = clock(iso);
  const ago = daysAgo(d, now);
  if (ago <= 0) return C.today(t);
  if (ago === 1) return C.yesterdayAt(t);
  return `${d.toLocaleDateString(locale, ago < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' })} ${t}`;
}

/** A merge condition's sentence, Desktop's (« Il manque une approbation (0/1). », « Pipeline réussi »); a code the phone does not know, as is. */
export function condText(c: MergeCondition, host: string): string {
  if (c.ok) {
    if (c.key === 'approved') return C.ok.approved(c.given, c.required);
    return C.ok[c.key];
  }
  switch (c.key) {
    case 'draft': return C.blocker.draft(host);
    case 'approvals': return C.blocker.approvals(c.given, c.required);
    case 'changes_requested': return C.blocker.changes_requested(c.who);
    case 'raw': return c.code;
    default: return C.blocker[c.key];
  }
}

/** A request's row:the pipeline's dot, its number and title, then its line and what matters, in words. */
export function PrRow({ pr, sub, chips, href, dim = false, selected = false }: {
  pr: PullRequest; sub: string; chips?: ReactNode; href?: string; dim?: boolean; selected?: boolean;
}) {
  const body = (
    <>
      <span className="mt-1.5 self-start"><Dot state={dim ? 'done' : PIPE_DOT[pr.pipeline]} pulse={!dim && pr.pipeline === 'run'} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={`truncate text-[14px] ${dim ? 'text-muted' : ''}`}><b className="mr-1 font-mono text-[13px] font-semibold">{pr.ref}</b>{pr.title}</span>
        <small className="truncate text-[12px] text-muted">{sub}</small>
        {chips && <span className="flex flex-wrap gap-1.5">{chips}</span>}
      </span>
      {href && <Icon name="chevron" className="size-4 text-muted" />}
    </>
  );
  const className = `flex min-h-[60px] items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 ${selected ? 'bg-secondary' : ''}`;
  return href
    ? <a href={href} data-pr={pr.id} aria-current={selected ? 'page' : undefined} className={className}>{body}</a>
    : <div data-pr={pr.id} className={className}>{body}</div>;
}
