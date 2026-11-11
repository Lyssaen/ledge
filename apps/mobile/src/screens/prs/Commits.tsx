import type { PrDetail } from '@ledge/protocol';
import { copy } from '../../copy';
import { shortSha } from '../../model/prs';
import { Icon } from '../../ui/icons';
import { Frame } from '../rigs/kit';
import { dayTime } from './parts';

/*
 * A request's Commits (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html §7): most recent first, whatever order the forge gave
 * (GitHub lists the oldest first), each with its short sha, its title as written, its author and its time. Read-only: a commit's
 * detail is on the forge.
 */

const C = copy.prs;

/** The commits newest first; two at the same time keep the forge's order. */
export const newestFirst = (commits: PrDetail['commits']): PrDetail['commits'] =>
  [...commits].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

/** The Commits tab of a request's detail. */
export function Commits({ detail }: { detail: PrDetail }) {
  return (
    <div className="flex flex-col gap-2.5">
      {detail.commits.length > 0 && (
        <Frame label={C.tabs.commits}>
          {newestFirst(detail.commits).map(c => (
            <div key={c.sha} data-commit={c.sha} className="flex min-h-[52px] items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0">
              <Icon name="commit" className="size-4 text-muted" />
              <span className="flex-none font-mono text-[12px] text-muted">{shortSha(c.sha)}</span>
              <span className="flex min-w-0 flex-1 flex-col text-[13.5px]">
                <span className="truncate">{c.title}</span>
                <small className="text-[12px] text-muted">{`${c.author} · ${dayTime(c.at)}`}</small>
              </span>
            </div>
          ))}
        </Frame>
      )}
      <p className="text-[12px] leading-4 text-muted">{C.commitsReadOnly(C.host[detail.pr.forge])}</p>
    </div>
  );
}
