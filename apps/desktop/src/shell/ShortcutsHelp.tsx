import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { useBackquote } from '../term/keys';
import { useIdeEnabled } from '../workspace/prefs';
import { Modal } from './Modal';

/** The keyboard shortcuts dialog (the mockup's `shortcut-list`); with the IDE on, its tab keys after the others. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  // The focus key's row names the key the user's layout prints there (Ctrl ² on AZERTY).
  const backquote = useBackquote();
  const [ide] = useIdeEnabled();
  return (
    <Modal title={t.shortcuts.title} onClose={onClose}>
      <div className="shortcut-list">
        <p>{t.shortcuts.intro}</p>
        {t.shortcuts.rows.map(([keys, action]) => <div key={keys}><span>{action}</span><Kbd>{keys === 'Ctrl `' ? `Ctrl ${backquote}` : keys}</Kbd></div>)}
        {ide && <>
          <h3>{t.shortcuts.ide.title}</h3>
          {t.shortcuts.ide.rows.map(([keys, action]) => <div key={keys}><span>{action}</span><Kbd>{keys}</Kbd></div>)}
        </>}
        <p>{t.shortcuts.outro}</p>
      </div>
    </Modal>
  );
}
