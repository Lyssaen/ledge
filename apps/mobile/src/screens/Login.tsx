import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { copy } from '../copy';
import { Board, Fill, ICON, PRIMARY } from '../ui/Board';

/** The relay's own route: GitHub, then back to `/?signin=<issue>`. */
export const GITHUB_START = '/auth/github/start';

/** What to say of the relay's `?signin=` issue; null for none or `ok`. */
export function signinError(issue: string | null): string | null {
  if (issue === 'denied') return copy.login.errors.denied;
  if (issue === 'bad_state' || issue === 'error') return copy.login.errors.failed;
  return null;
}

const NOTE_ICONS = [
  <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>,
  <><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></>,
  <><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>
];

/** Board Login: the relay this app talks to, what pairing guarantees, and GitHub. */
export function Login({ server, error }: { server: string; error: string | null }) {
  return (
    <Board>
      <div className="flex flex-col items-center gap-3.5 text-center">
        <ResidentMascot size={88} theme="dark" />
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-.025em]">{copy.login.title}</h1>
        <p className="max-w-[300px] text-muted">{copy.login.subtitle}</p>
      </div>
      <div className="flex h-8 items-center gap-2.5 self-center rounded-full border border-line px-3 text-xs text-muted">
        <svg className={`${ICON} size-3.5`} viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></svg>
        <span className="font-mono">{server}</span>
      </div>
      {error && <p role="alert" className="rounded-control border border-danger-fg/15 bg-danger-bg p-3.5 text-[13px] text-danger-fg">{error}</p>}
      <Fill />
      <ul className="flex flex-col gap-3.5 text-fg/85">
        {copy.login.notes.map((note, i) => (
          <li key={note} className="flex items-start gap-3">
            <svg className={`${ICON} text-fg`} viewBox="0 0 24 24" aria-hidden="true">{NOTE_ICONS[i]}</svg>
            <span>{note}</span>
          </li>
        ))}
      </ul>
      <a href={GITHUB_START} className={PRIMARY}>
        <svg className="size-5 flex-none fill-current" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3" /></svg>
        {copy.login.github}
      </a>
    </Board>
  );
}
