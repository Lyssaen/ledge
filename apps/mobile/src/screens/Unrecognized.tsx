import { copy } from '../copy';
import { Board, Fill, H1, ICON, OUTLINE, PRIMARY } from '../ui/Board';

const U = copy.unrecognized;

/**
 * The PC answered a hello of this phone with `denied`. Nothing is sent, and nothing is erased until the user chooses:
 * relink (which forgets the keys and the cache) or sign out. Modelled on KeyChanged; no board of the mock-up shows it.
 */
export function Unrecognized({ pcName, onRelink, onSignOut }: { pcName: string | null; onRelink: () => void; onSignOut: () => void }) {
  return (
    <Board>
      <div className="flex flex-col gap-3.5">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
          <svg className={ICON} viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="m9.5 9.5 5 5" /><path d="m14.5 9.5-5 5" /></svg>
        </span>
        <h1 className={H1}>{U.title(pcName)}</h1>
        <p className="text-muted">{U.body}</p>
      </div>
      <p className="text-body leading-[1.6] text-muted">{U.kept}</p>
      <Fill />
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onRelink} className={PRIMARY}>{U.relink}</button>
        <button type="button" onClick={onSignOut} className={OUTLINE}>{U.signOut}</button>
      </div>
    </Board>
  );
}
