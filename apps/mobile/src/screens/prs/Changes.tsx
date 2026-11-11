import { useState } from 'react';
import type { PrDetail, PrFile } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import { diffTotal, fileThreads } from '../../model/prs';
import { Icon } from '../../ui/icons';
import { Att, Frame, Lbl } from '../rigs/kit';

/*
 * A request's Modifications (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html §7): « 3 fichiers · +48 −12 », then a file per row,
 * its path cut from the start so its name stays, and its + / −. A tap unfolds its diff under it; long lines end with « … », the
 * phone never scrolls sideways. A file the PC sent without its patch says so. Read-only.
 */

const C = copy.prs;

/** A count as the mockup writes it (« 1 204 » in French). */
const n = (v: number) => v.toLocaleString(locale);

/** A diff line's look: a hunk header in blue, an addition on green, a removal on red, the context muted. */
export function lineKind(line: string): 'hunk' | 'add' | 'del' | 'ctx' {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

const LINE: Record<ReturnType<typeof lineKind>, string> = {
  hunk: 'bg-info/8 text-info',
  add: 'bg-ok/15',
  del: 'bg-danger-fg/15',
  ctx: 'text-muted'
};

/** A path cut from its start: the end (the file's name) stays when it is too long. */
function Path({ path }: { path: string }) {
  return <span className="min-w-0 flex-1 overflow-hidden text-left font-mono text-[12px] text-ellipsis whitespace-nowrap [direction:rtl]"><span dir="ltr">{path}</span></span>;
}

function Counts({ f }: { f: PrFile }) {
  return (
    <>
      <span className="font-mono text-[12px] text-ok">+{n(f.added)}</span>
      <span className="font-mono text-[12px] text-danger-fg">−{n(f.removed)}</span>
    </>
  );
}

function FileRow({ f, threads, host }: { f: PrFile; threads: number; host: string }) {
  const [open, setOpen] = useState(false);
  const att = threads > 0 && <Att>{C.fileThreads(threads)}</Att>;
  if (f.patch === undefined) {
    return (
      <div data-file={f.path} className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[13px] last:border-b-0">
        <Icon name="file" className="size-3.5 text-muted" />
        <Path path={f.path} />{att}<Counts f={f} />
        <span className="basis-full pl-[22px] text-[12px] text-muted">{C.noPatch(host)}</span>
      </div>
    );
  }
  return (
    <div data-file={f.path} className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex min-h-[46px] w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]">
        <Icon name={open ? 'down' : 'chevron'} className="size-3.5 text-muted" />
        <Path path={f.path} />{att}<Counts f={f} />
      </button>
      {open && (
        <pre className="m-0 overflow-hidden border-t border-line bg-well font-mono text-[11px] leading-[17px]">
          {f.patch.split('\n').map((line, i) => (
            <span key={i} data-line={lineKind(line)} className={`block overflow-hidden px-3 text-ellipsis whitespace-pre ${LINE[lineKind(line)]}`}>{line || ' '}</span>
          ))}
        </pre>
      )}
    </div>
  );
}

/** The Modifications tab of a request's detail. */
export function Changes({ detail }: { detail: PrDetail }) {
  if (detail.files.length === 0) return <p className="p-2.5 text-center text-[12px] text-muted">{C.noChange}</p>;
  const total = diffTotal(detail);
  const host = C.host[detail.pr.forge];
  return (
    <div className="flex flex-col gap-2.5">
      <Lbl aside={<><span className="font-mono text-ok">+{n(total.added)}</span> <span className="font-mono text-danger-fg">−{n(total.removed)}</span></>}>
        {C.fileCount(detail.files.length)}
      </Lbl>
      <Frame label={C.tabs.changes}>
        {detail.files.map(f => <FileRow key={f.path} f={f} threads={fileThreads(detail, f.path)} host={host} />)}
      </Frame>
    </div>
  );
}
