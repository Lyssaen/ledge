import { useCallback, useRef } from 'react';
import { normalizePath, projectOf, type ChatTurn, type Projects } from '@ledge/protocol';
import { firstFreeColor, type Proposal, type ProposedRepo } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { nameKey } from '../projects/draft';
import { rememberProposal } from '../projects/proposals';

/** The project `addTo` designates, compared as the editor's name_taken does (case and accents aside). */
export function projectNamed(projects: Projects, name: string): Projects['projects'][number] | undefined {
  const k = nameKey(name);
  return projects.projects.find(p => nameKey(p.name) === k);
}

/** Why a turn's block opens nothing: the turn is gone (chat.reset), its folders all went to other projects (`gone`), or every one
 *  is already among the `addTo` target's repositories (`already`, the target's name). */
export type ReviewOutcome = { proposal: Proposal } | { problem: 'gone' } | { problem: 'already'; target: string };

/** A chat turn's project block as the editor's proposal (lot 11, task 5), built at the click from the projects as they are now
 *  (the mockup's proposeFromChat): « Add to » the project `addTo` names when it still exists, else a new project under the block's
 *  name and the first free colour. The repositories go on the turn's machine, each with the LLM's reason; a folder another project
 *  has (projectOf) or that holds another project's repository is left out, one the target files (a remembered folder) stays, one already among the target's repositories is
 *  not proposed again. */
export function proposalFromTurn(turn: ChatTurn | undefined, projects: Projects, label: (machine: string) => string): ReviewOutcome {
  const block = turn?.projectProposal;
  if (!turn || !block) return { problem: 'gone' };
  const machine = turn.machineId ?? 'local';
  const target = block.addTo === undefined ? undefined : projectNamed(projects, block.addTo);
  const listed = (path: string) => !!target?.repos.some(r => r.machine === machine && normalizePath(r.path) === path);
  // A folder that holds another project's repository on this machine would take it in: left out too.
  const others = projects.projects.filter(p => p.id !== target?.id).flatMap(p => p.repos).filter(r => r.machine === machine).map(r => normalizePath(r.path));
  const holdsOther = (path: string) => others.some(o => o.startsWith(path === '/' ? '/' : `${path}/`) && o !== path);
  const mine = block.repos
    .map(r => ({ machine, path: normalizePath(r.path), why: { kind: 'chat' as const, text: r.why } }))
    .filter(r => { const owner = projectOf({ machineId: machine, cwd: r.path }, projects); return (owner === null || owner === target?.id) && !holdsOther(r.path); });
  const repos: ProposedRepo[] = mine.filter(r => !listed(r.path));
  if (repos.length === 0) return target && mine.length > 0 ? { problem: 'already', target: target.name } : { problem: 'gone' };
  return { proposal: {
    pid: `chat-${turn.qid}`,
    name: target?.name ?? block.name,
    color: target?.color ?? firstFreeColor(projects.projects),
    description: target?.description ?? block.description ?? '',
    repos, file: [],
    ...(target ? { targetId: target.id } : {}),
    summary: { repos: repos.length, machines: [label(machine)], ...(target ? { target: target.name } : {}), agents: [] }
  } };
}

const NO_PROJECTS: Projects = { projects: [], rules: [] };

/** The project card's « Review the proposal »: the proposal is kept (rememberProposal) and its pid handed to the editor; a turn the chat
 *  no longer has (chat.reset) or whose folders all went to other projects opens nothing, and the notice says the proposal no longer
 *  exists; every folder already in the target: « Everything is already in X ». Reads the latest turns, so a click racing a reset finds the turn gone. Nothing is written here. */
export function useProjectReview({ chat, projects, machines, notify, onProposal }: {
  chat: readonly ChatTurn[]; projects: Projects | null; machines: readonly { id: string; label: string }[];
  notify(text: string): void; onProposal(pid: string): void;
}): { review(qid: string): void; projectNamed(name: string): string | undefined } {
  const { t } = useI18n();
  const latest = useRef({ chat, projects, machines });
  latest.current = { chat, projects, machines };
  const review = useCallback((qid: string) => {
    const now = latest.current;
    const label = (id: string) => now.machines.find(m => m.id === id)?.label ?? id;
    const r = proposalFromTurn(now.chat.find(x => x.qid === qid), now.projects ?? NO_PROJECTS, label);
    if ('proposal' in r) onProposal(rememberProposal(r.proposal));
    else notify(r.problem === 'already' ? t.projects.ledge.already(r.target) : t.projects.ledge.gone);
  }, [notify, onProposal, t]);
  const named = useCallback((name: string) => (projects ? projectNamed(projects, name)?.name : undefined), [projects]);
  return { review, projectNamed: named };
}
