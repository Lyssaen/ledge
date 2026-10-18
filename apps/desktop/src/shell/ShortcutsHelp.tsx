import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { Modal } from './Modal';

/** The keyboard shortcuts dialog (the mockup's `shortcut-list`). */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t.shortcuts.title} onClose={onClose}>
      <div className="shortcut-list">
        <p>{t.shortcuts.intro}</p>
        {t.shortcuts.rows.map(([keys, action]) => <div key={keys}><span>{action}</span><Kbd>{keys}</Kbd></div>)}
        <p>{t.shortcuts.outro}</p>
      </div>
    </Modal>
  );
}
