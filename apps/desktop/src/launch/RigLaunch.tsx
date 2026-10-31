import type { JSX } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';

/** « Nouveau rig »: a waiting window until lot 5 replaces this file with the real launch. */
export function RigLaunch({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <Modal title={t.modalTitles.rigLaunch} className="confirm-modal" onClose={onClose}>
      <div className="confirm-content">
        <p>{t.rigLaunch.soon}</p>
        <div className="confirm-actions"><Button variant="primary" autoFocus onClick={onClose}>{t.rigLaunch.close}</Button></div>
      </div>
    </Modal>
  );
}
