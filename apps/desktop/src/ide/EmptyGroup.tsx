import type { JSX } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';

export type EmptyPick = 'terminal' | 'launch' | 'openrig' | 'settings' | 'atelier';

// The mockup's `.btn`: 26 px, 12 px type (Button's own sizes are the dialogs').
const SMALL = { height: 26, padding: '0 10px', fontSize: 12 };

/** A group without tabs (mockup emptyGroup()): what to put in it. `terminal` names the session it was split from, when that
 *  session still exists: its Terminal comes first, set forward, with the tip on linking. The shell's own Terminal is lot 5. */
export function EmptyGroup({ terminal, onPick }: { terminal: string | null; onPick(p: EmptyPick): void }): JSX.Element {
  const { t } = useI18n();
  const e = t.ide.empty;
  const pick = (p: EmptyPick, label: string, primary = false) => (
    <Button key={p} size="sm" variant={primary ? 'primary' : 'outline'} className={primary ? 'pri' : undefined} style={SMALL} onClick={() => onPick(p)}>{label}</Button>
  );
  return (
    <div className="ide-empty">
      <h3>{e.title}</h3>
      <span className="sub">{e.body}</span>
      <div className="go">
        {terminal !== null && pick('terminal', e.terminal(terminal), true)}
        {pick('launch', e.newSession)}
        {pick('openrig', e.openrig)}
        {pick('settings', e.settings)}
        {pick('atelier', e.atelier)}
      </div>
      {terminal !== null && <span className="sub">{e.tip}</span>}
    </div>
  );
}
