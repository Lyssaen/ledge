import type { Ref } from 'react';
import { Kbd } from '../ui/Kbd';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';
import { useI18n } from '../i18n/lang';

/** Keyboard help inside the same surface (the `?` key or the list footer button). */
export function HelpView({ visible, onBack, onClose, contentRef, enterDelay = 120 }: { visible: boolean; onBack: () => void; onClose: () => void; contentRef?: Ref<HTMLDivElement>; enterDelay?: number }) {
  const { t } = useI18n();
  return (
    <div data-layer="help" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      <DetailHeader title={t.help.title} onBack={onBack} onClose={onClose} />
      <div style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }} className="ledge-scroll">
      <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 17px 16px' }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, columnGap: 12, fontSize: 13, lineHeight: '20px' }}>
          {t.help.keys.map(([what, keys]) => [
            <dt key={`${what}-t`} style={{ color: 'var(--sidebar-foreground)' }}>{what}</dt>,
            <dd key={`${what}-d`} style={{ margin: 0, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</dd>
          ])}
        </dl>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.help.tab}</span>
      </div>
      </div>
    </div>
  );
}
