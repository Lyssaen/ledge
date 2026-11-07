import type { JSX } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';

export type EmptyPick = 'terminal' | 'launch' | 'openrig' | 'settings' | 'atelier' | 'shell';

/** A group without tabs (mockup emptyGroup()): what to put in it. `terminal` names the session it was split from, when that
 *  session still exists: its Terminal comes first, set forward, with the tip on linking; a seat's is its read-only capture (R3),
 *  « Capture · X ». « Terminal », last: a shell (the default one), in a tab of this group. */
export function EmptyGroup({ terminal, seat = false, onPick }: { terminal: string | null; seat?: boolean; onPick(p: EmptyPick): void }): JSX.Element {
  const { t } = useI18n();
  const e = t.ide.empty;
  const pick = (p: EmptyPick, label: string, primary = false) => (
    <Button key={p} size="sm" variant={primary ? 'primary' : 'outline'} className={primary ? 'pri' : undefined} onClick={() => onPick(p)}>{label}</Button>
  );
  return (
    <div className="ide-empty">
      <h3>{e.title}</h3>
      <span className="sub">{e.body}</span>
      <div className="go">
        {terminal !== null && pick('terminal', seat ? e.capture(terminal) : e.terminal(terminal), true)}
        {pick('launch', e.newSession)}
        {pick('openrig', e.openrig)}
        {pick('settings', e.settings)}
        {pick('atelier', e.atelier)}
        {pick('shell', e.shell)}
      </div>
      {terminal !== null && <span className="sub">{e.tip}</span>}
    </div>
  );
}
