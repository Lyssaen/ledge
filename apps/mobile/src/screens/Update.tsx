import { copy } from '../copy';
import { formatFingerprint, shortFingerprint } from '../sw/fingerprint';
import type { BuildInfo } from '../sw/types';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { Icon } from '../ui/icons';

const U = copy.update;
const release = (version: string) => `https://github.com/Lyssaen/ledge/releases/tag/v${version}`;

/**
 * The sheet a waiting build raises over the screen: its version and fingerprint, the running one, where to compare it
 * with the release, and the choice. Nothing changes until « Mettre à jour »; Escape or a tap beside it is « Plus tard ».
 */
export function Update({ next, current, onLater, onApply }: { next: BuildInfo; current: BuildInfo | null; onLater: () => void; onApply: () => void }) {
  return (
    <Sheet labelledBy="update-title" onClose={onLater}>
      <div className="flex flex-col gap-1.5">
        <h2 id="update-title" className="text-xl leading-[26px] font-semibold tracking-[-.02em]">{U.version(next.version)}</h2>
        <p className="text-muted">{U.body}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-control border border-line bg-bg p-3.5">
        <span className="text-xs leading-4 text-muted">{U.fingerprint}</span>
        <code className="font-mono text-[15px] leading-[22px] tracking-[.02em] [word-spacing:4px]">{formatFingerprint(next.fingerprint)}</code>
        <span className="text-xs leading-4 text-muted">
          {U.current}
          <span className="font-mono">{current ? U.currentBuild(current.version, shortFingerprint(current.fingerprint)) : copy.connection.none}</span>
        </span>
      </div>
      <a href={release(next.version)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 font-medium">
        <Icon name="external" className="size-4" stroke={1.5} />
        {U.compare(`v${next.version}`)}
      </a>
      <div className="grid grid-cols-2 gap-2.5">
        <Button size="lg" onClick={onLater}>{U.later}</Button>
        <Button size="lg" variant="primary" onClick={onApply}>{U.apply}</Button>
      </div>
    </Sheet>
  );
}
