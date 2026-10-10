import { Kbd } from '../ui/Kbd';
import { Button } from '../ui/Button';
import { transition } from '../motion';

const KEY = 'ledge.coachmarks';
export const COACHMARK_OPENS = 3;
/** Fixed card height, so the surface can place it (below or above the row) without a layout pass. */
export const COACHMARK_H = 128;
/** Counts a keyboard open; true while it is one of the first three. Storage failures show nothing and count nothing. */
export function countCoachmarkOpen(): boolean {
  try {
    const n = Number(localStorage.getItem(KEY) ?? '0') || 0;
    if (n >= COACHMARK_OPENS) return false;
    localStorage.setItem(KEY, String(n + 1));
    return true;
  } catch { return false; }
}

export function Coachmark({ visible, top, onDismiss }: { visible: boolean; top: number; onDismiss: () => void }) {
  return (
    <div role="dialog" aria-label="Keyboard" aria-hidden={!visible || undefined} inert={!visible} data-coachmark style={{ position: 'absolute', left: 44, top, width: 300, height: COACHMARK_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, padding: '12px 14px', background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--input)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)', opacity: visible ? 1 : 0, transform: `translateY(${visible ? 0 : -6}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', 'grow', visible ? 140 : 0]]) }}>
      {/* Title and button share the first row; the caption gets a row of its own, so nothing wraps into the button. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, flexGrow: 1, minWidth: 0 }}>Move with the keyboard</span>
        <Button variant="secondary" size="sm" onClick={onDismiss} style={{ flexShrink: 0, whiteSpace: 'nowrap', height: 28, padding: '0 10px' }}>Got it</Button>
      </div>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
        <span><Kbd>J</Kbd> <Kbd>K</Kbd> up and down</span><span><Kbd>Alt →</Kbd> next ask</span><span><Kbd>1</Kbd>…<Kbd>9</Kbd> jump</span><span><Kbd>Y</Kbd> <Kbd>N</Kbd> decide</span><span><Kbd>Esc</Kbd> close</span>
      </span>
      <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Shown on the first three keyboard opens</span>
    </div>
  );
}
