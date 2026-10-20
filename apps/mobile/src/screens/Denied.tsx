import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { copy } from '../copy';
import { Board, Fill, H1, OUTLINE } from '../ui/Board';

/** Board Denied: GitHub signed this account in, the relay's allow-list does not hold it. */
export function Denied({ onOther }: { onOther: () => void }) {
  return (
    <Board top="pt-40">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <ResidentMascot size={80} theme="dark" frozen />
        <h1 className={H1}>{copy.denied.title}</h1>
        <p className="max-w-[300px] text-muted">{copy.denied.bodyNoLogin}</p>
      </div>
      <Fill />
      <button type="button" onClick={onOther} className={OUTLINE}>{copy.denied.other}</button>
    </Board>
  );
}
