import { Kbd } from '../ui/Kbd';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';

const KEYS: Array<[string, string[]]> = [
  ['Open the list', ['Ctrl+Alt+L']], ['Choose a session', ['J', 'K', '1–9']], ['Open the selection', ['Enter']], ['Approve or deny', ['Y', 'N']],
  ['Next ask', ['Alt →']], ['Reply', ['R']], ['Open the terminal tab', ['O']], ['Do not disturb', ['D']], ['Back, then collapse', ['Esc']]
];

/** Keyboard help inside the same surface (the `?` key or the list footer button). */
export function HelpView({ visible, onBack, onClose }: { visible: boolean; onBack: () => void; onClose: () => void }) {
  return (
    <div data-layer="help" inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <DetailHeader title="Keyboard" onBack={onBack} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', overflowY: 'auto', minHeight: 0 }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, columnGap: 12, fontSize: 13, lineHeight: '20px' }}>
          {KEYS.map(([what, keys]) => [
            <dt key={`${what}-t`} style={{ color: 'var(--sidebar-foreground)' }}>{what}</dt>,
            <dd key={`${what}-d`} style={{ margin: 0, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</dd>
          ])}
        </dl>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>Tab keeps moving between the controls.</span>
      </div>
    </div>
  );
}
