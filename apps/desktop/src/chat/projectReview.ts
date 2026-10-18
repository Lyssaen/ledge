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

/** A chat turn's project block as the editor's proposal (lot 11, task 5), built at the click from the projects as they are now: the
 *  repositories on the turn's machine that no project has (projectOf), each with the LLM's reason; « Add to » the project `addTo`
 *  names when it still exists, else a new project under the block's name and the first free colour. Null when the turn is gone, has
 *  no block, or every repository is taken. */
export function proposalFromTurn(turn: ChatTurn | undefined, projects: Projects, label: (machine: string) => string): Proposal | null {
  const block = turn?.projectProposal;
  if (!turn || !block) return null;
  const machine = turn.machineId ?? 'local';
  const repos: ProposedRepo[] = block.repos
    .map(r => ({ machine, path: normalizePath(r.path), why: { kind: 'chat' as const, text: r.why } }))
    .filter(r => projectOf({ machineId: machine, cwd: r.path }, projects) === null);
  if (repos.length === 0) return null;
  const target = block.addTo === undefined ? undefined : projectNamed(projects, block.addTo);
  return {
    pid: `chat-${turn.qid}`,
    name: target?.name ?? block.name,
    color: target?.color ?? firstFreeColor(projects.projects),
    description: target?.description ?? block.description ?? '',
    repos, file: [],
    ...(target ? { targetId: target.id } : {}),
    summary: { repos: repos.length, machines: [label(machine)], ...(target ? { target: target.name } : {}), agents: [] }
  };
}

const NO_PROJECTS: Projects = { projects: [], rules: [] };

/** The project card's « Review the proposal »: the proposal is kept (rememberProposal) and its pid handed to the editor; a turn the chat
 *  no longer has (chat.reset) or whose repositories were all taken meanwhile opens nothing, and the notice says the proposal no longer
 *  exists. Reads the latest turns, so a click racing a reset finds the turn gone. Nothing is written here. */
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
    const p = proposalFromTurn(now.chat.find(x => x.qid === qid), now.projects ?? NO_PROJECTS, label);
    if (!p) { notify(t.projects.ledge.gone); return; }
    onProposal(rememberProposal(p));
  }, [notify, onProposal, t]);
  const named = useCallback((name: string) => (projects ? projectNamed(projects, name)?.name : undefined), [projects]);
  return { review, projectNamed: named };
}
