import { useTui } from '../context.js';
import { Frame } from '../ui/Frame.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Réglages › Accès mobile (docs/mockups/ledge-mobile-access-tui.html): the local daemon's mobile access, its account and its devices. */
export function Mobile() {
  const { t } = useTui();
  return (
    <Frame crumb={t.mobile.title} keys={[['↑ ↓', t.mobile.keys.move], ['esc', t.mobile.keys.back]]}>
      <TitledBox title={t.mobile.title} flexGrow={1}>{null}</TitledBox>
    </Frame>
  );
}
