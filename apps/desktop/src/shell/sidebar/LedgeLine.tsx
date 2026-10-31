import type { JSX } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import type { LedgeLine as Line } from '@ledge/ui/rigs/model';
import { useI18n } from '../../i18n/lang';
import { useMotionPreferences } from '../../motionPreferences';
import { cls } from '../cls';
import { useTheme } from '../theme';

/** « 16:44 », in the user's time zone. */
const clock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Ledge as a messaging line (mockup 1a): the resident, « Ledge. », the time, a one-line preview and the unread count.
 *  Its name reads as the line (« Accueil : Ledge, l’opérateur · Ledge. 16:44 Une décision t’attend · factory 1 non lu »); `on` styles it (home or chat), `current` is the home page itself; a click opens
 *  Ledge's screen on the conversation. */
export function LedgeLine(p: { line: Line; on: boolean; current: boolean; paused: boolean; onOpen(): void }): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const v = p.line.preview;
  const text = v.kind === 'decision' ? t.side.ledge.decision(v.count, v.rig)
    : v.kind === 'grace' ? t.side.ledge.grace(v.rig)
    : v.kind === 'said' ? v.text
    : t.side.ledge.calm(v.rigs);
  const at = p.line.at ? clock(p.line.at) : '';
  // Spelled out after what the button opens (the brand's dot is its own span, which some accessibility trees read as « Ledge . »);
  // it never starts with « Ledge », the name a project row may have.
  const label = `${t.side.ledgeHome} · ${['Ledge.', at, text, p.line.unread > 0 ? t.side.ledge.unread(p.line.unread) : ''].filter(Boolean).join(' ')}`;
  return (
    <button type="button" className={cls('st-ledge', p.on && 'on')} aria-current={p.current ? 'page' : undefined} aria-label={label} title={t.side.ledgeHome} onClick={p.onOpen}>
      <span className="st-mascot" aria-hidden="true"><ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={reduced} /></span>
      <span className="st-ledge-body">
        <span className="st-ledge-top">
          <span className="st-ledge-brand">Ledge<span className="brand-dot">.</span></span>
          {at && <time className="st-ledge-at" dateTime={p.line.at}>{at}</time>}
        </span>
        <span className="st-ledge-bottom">
          <span className="st-ledge-preview">{text}</span>
          {p.line.unread > 0 && <span className="st-ledge-unread" title={t.side.ledge.unread(p.line.unread)}>{p.line.unread}</span>}
        </span>
      </span>
    </button>
  );
}
