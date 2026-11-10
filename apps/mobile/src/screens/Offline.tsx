import { copy } from '../copy';
import { Board, Fill, H1, OUTLINE } from '../ui/Board';

/** Another tab of this phone took the relay's socket: this one stays quiet until asked to take it back. */
export function Replaced({ onHere }: { onHere: () => void }) {
  return (
    <Board top="pt-40">
      <div className="flex flex-col gap-2 text-center">
        <h1 className={H1}>{copy.replaced.title}</h1>
        <p className="text-muted">{copy.replaced.body}</p>
      </div>
      <Fill />
      <button type="button" onClick={onHere} className={OUTLINE}>{copy.replaced.here}</button>
    </Board>
  );
}
