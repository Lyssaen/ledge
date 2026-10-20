import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { useBackquote } from '../term/keys';
import { Modal } from './Modal';

/** The keyboard shortcuts dialog (the mockup's `shortcut-list`). */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  // The focus key's row names the key the user's layout prints there (Ctrl ² on AZERTY).
  const backquote = useBackquote();
  return (
    <Modal title={t.shortcuts.title} onClose={onClose}>
      <div className="shortcut-list">
        <p>{t.shortcuts.intro}</p>
        {t.shortcuts.rows.map(([keys, action]) => <div key={keys}><span>{action}</span><Kbd>{keys === 'Ctrl `' ? `Ctrl ${backquote}` : keys}</Kbd></div>)}
        <p>{t.shortcuts.outro}</p>
      </div>
    </Modal>
  );
}
