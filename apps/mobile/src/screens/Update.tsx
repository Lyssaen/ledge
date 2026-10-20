import { copy } from '../copy';
import { formatFingerprint, shortFingerprint } from '../sw/fingerprint';
import type { BuildInfo } from '../sw/types';
import { OUTLINE, PRIMARY } from '../ui/Board';

const U = copy.update;
const release = (version: string) => `https://github.com/Lyssaen/ledge/releases/tag/v${version}`;

/**
 * The sheet a waiting build raises over the screen: its version and fingerprint, the running one, where to compare it
 * with the release, and the choice. Nothing changes until « Mettre à jour ».
 */
export function Update({ next, current, onLater, onApply }: { next: BuildInfo; current: BuildInfo | null; onLater: () => void; onApply: () => void }) {
  return (
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-black/65" aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby="update-title" className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[480px] flex-col gap-4 rounded-t-[28px] border-t border-line bg-surface px-5 pt-3 pb-[calc(34px+env(safe-area-inset-bottom))]">
        <span className="h-[5px] w-9 self-center rounded-full bg-[#525252]" aria-hidden="true" />
        <div className="flex flex-col gap-1.5">
          <h2 id="update-title" className="text-xl leading-[26px] font-semibold tracking-[-.02em]">{U.version(next.version)}</h2>
          <p className="text-muted">{U.body}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-bg p-3.5">
          <span className="text-xs leading-4 text-muted">{U.fingerprint}</span>
          <code className="font-mono text-[15px] leading-[22px] tracking-[.02em] [word-spacing:4px]">{formatFingerprint(next.fingerprint)}</code>
          <span className="text-xs leading-4 text-muted">
            {U.current}
            <span className="font-mono">{current ? U.currentBuild(current.version, shortFingerprint(current.fingerprint)) : copy.connection.none}</span>
          </span>
        </div>
        <a href={release(next.version)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 font-medium">
          <svg className="size-4 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          {U.compare(`v${next.version}`)}
        </a>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onLater} className={OUTLINE}>{U.later}</button>
          <button type="button" onClick={onApply} className={PRIMARY}>{U.apply}</button>
        </div>
      </section>
    </div>
  );
}
