import type { JSX } from 'react';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { Card, Row } from './controls';

/** Settings › Keyboard shortcuts (settings.tsx, `shortcuts`): the app's own table (`t.shortcuts.rows`, the ? help's), Ctrl , first as in
 *  the mockup. The mockup's « Partout dans Windows » card is not built: the app has no system-wide shortcut. */
export function Shortcuts(): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.shortcuts;
  const rows = [...t.shortcuts.rows.filter(([k]) => k === 'Ctrl ,'), ...t.shortcuts.rows.filter(([k]) => k !== 'Ctrl ,')];
  return (
    <>
      <Card title={c.title}>
        {rows.map(([k, label], i) => <Row key={i} label={label}><Kbd>{k}</Kbd></Row>)}
      </Card>
      <p className="set-footnote">{c.note}</p>
    </>
  );
}
