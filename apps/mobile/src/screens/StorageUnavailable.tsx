import { copy } from '../copy';
import { Board, Fill, H1, OUTLINE, PRIMARY } from '../ui/Board';

const S = copy.storage;

/** The key store could not be read. Unreadable is not lost: nothing is erased and no pairing starts from here. */
export function StorageUnavailable({ onRetry, onReload }: { onRetry: () => void; onReload: () => void }) {
  return (
    <Board top="pt-40">
      <div className="flex flex-col gap-2 text-center">
        <h1 className={H1}>{S.title}</h1>
        <p className="text-muted">{S.body}</p>
      </div>
      <Fill />
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onRetry} className={PRIMARY}>{S.retry}</button>
        <button type="button" onClick={onReload} className={OUTLINE}>{S.reload}</button>
      </div>
    </Board>
  );
}
