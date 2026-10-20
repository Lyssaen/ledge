import { copy } from '../copy';
import { OUTLINE } from '../ui/Board';

/** Without a secure context: the one screen shown, and @ledge/seal never loaded. */
export function Insecure() {
  return (
    <main className="app flex flex-col justify-center gap-2 text-center" role="alert">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-.025em]">{copy.insecure.title}</h1>
      <p className="text-muted">{copy.insecure.body}</p>
    </main>
  );
}

/** The app or its start could not load: said on screen rather than a blank page. */
export function BootFailed() {
  return (
    <main className="app flex flex-col justify-center gap-4 text-center" role="alert">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-.025em]">{copy.bootFailed.title}</h1>
      <p className="text-muted">{copy.bootFailed.body}</p>
      <button type="button" onClick={() => globalThis.location.reload()} className={OUTLINE}>{copy.bootFailed.reload}</button>
    </main>
  );
}
