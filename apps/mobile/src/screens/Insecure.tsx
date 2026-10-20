import { copy } from '../copy';

/** Without a secure context: the one screen shown, and @ledge/seal never loaded. */
export function Insecure() {
  return (
    <main className="app flex flex-col justify-center gap-2 text-center" role="alert">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-.025em]">{copy.insecure.title}</h1>
      <p className="text-muted">{copy.insecure.body}</p>
    </main>
  );
}
