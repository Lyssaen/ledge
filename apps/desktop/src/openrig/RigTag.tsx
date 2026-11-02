import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** The rig an OpenRig seat belongs to, as a small label beside its name (docs/mockups/ledge-openrig.html, view 3). */
export function RigTag({ session }: { session: Session }) {
  const { t } = useI18n();
  if (!session.rig) return null;
  return <span className="rig-tag" title={t.openrig.seatOf(session.rig.name, session.rig.role)}>{session.rig.name}</span>;
}

/** The line under a seat's name: its role when it is an OpenRig seat, else what was there (the machine). */
export const seatLine = (s: Session, otherwise: string): string => (s.rig?.role ? `${s.rig.role} · ${otherwise}` : otherwise);
