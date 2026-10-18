import type { JSX } from 'react';
import { DEFAULT_ISLAND_PREFS } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { Card, Row } from './controls';
import { shownKeys } from './Island';
import type { SettingsContext } from './SettingsPage';

/** Settings › Keyboard shortcuts (settings.tsx, `shortcuts`): the system-wide ones first, as the island registers them (its own, set in
 *  Settings › Island where « Edit » goes), then the app's own table (`t.shortcuts.rows`, the ? help's), Ctrl , first as in the mockup. */
export function Shortcuts({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.shortcuts;
  const keys = shownKeys((ctx.island ?? DEFAULT_ISLAND_PREFS).shortcut, t.settings.island.keyNames);
  const rows = [...t.shortcuts.rows.filter(([k]) => k === 'Ctrl ,'), ...t.shortcuts.rows.filter(([k]) => k !== 'Ctrl ,')];
  return (
    <>
      <Card title={c.global} hint={c.globalNote}>
        <Row label={c.globalRows.island}>
          <span className="set-inline"><Kbd>{keys}</Kbd><Button size="sm" variant="ghost" aria-label={c.editLabel} onClick={() => ctx.dispatch({ type: 'settings', section: 'island' })}>{c.edit}</Button></span>
        </Row>
        <Row label={c.globalRows.newSession}><Kbd>Ctrl Alt N</Kbd></Row>
        <Row label={c.globalRows.theme}><Kbd>Ctrl Alt T</Kbd></Row>
        <Row label={c.globalRows.dnd}><Kbd>D</Kbd></Row>
      </Card>
      <Card title={c.title}>
        {rows.map(([k, label], i) => <Row key={i} label={label}><Kbd>{k}</Kbd></Row>)}
      </Card>
      <p className="set-footnote">{c.note}</p>
    </>
  );
}
