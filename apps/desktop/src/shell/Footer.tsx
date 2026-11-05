import type { ReactNode } from 'react';
import type { IslandPrefs } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';

export interface FooterMachine { id: string; label: string; offline: boolean; count: number }

/** The window's footer, on every screen (docs/mockups/ledge-harness-usage.html, v2 variant B): on the left local and SSH
 *  sessions and the island's state (« Island active » / « Island hidden », which opens Settings › Island; shown once the local
 *  daemon has spoken of it, null being its defaults: shown); in a narrow window (the sidebar a rail) the machines and their
 *  agents instead. On the right, `usage`: the harnesses' limits. The shortcuts live behind the sidebar's ?. */
export function Footer({ dispatch, localDown, island, machines = [], usage }: {
  dispatch: (a: NavAction) => void; localDown: boolean; island: IslandPrefs | null | undefined; machines?: FooterMachine[]; usage?: ReactNode;
}) {
  const { t } = useI18n();
  const visible = island?.visible ?? true;
  return (
    <footer className="workspace-footer" role="contentinfo">
      <div className="footer-status">
        <span className="footer-wide"><i className={localDown ? 'connection-dot off' : 'connection-dot'} />{t.foot.sessions}</span>
        {island !== undefined && (
          <button className={`${visible ? 'overlay-state' : 'overlay-state off'} footer-wide`} title={t.foot.islandTitle} onClick={() => dispatch({ type: 'settings', section: 'island' })}>
            <i />{visible ? t.foot.islandOn : t.foot.islandOff}
          </button>
        )}
        {machines.map(m => (
          <span key={m.id} className="footer-narrow"><i className={m.offline ? 'connection-dot off' : 'connection-dot'} />{m.label}{!m.offline && ` ${m.count}`}</span>
        ))}
      </div>
      {usage}
    </footer>
  );
}
