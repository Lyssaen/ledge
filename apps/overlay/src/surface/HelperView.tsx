import type { Ref } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { transition } from '../motion';
import { helperThread } from '../thread/turns';
import { Thread } from './Thread';

export interface HelperViewProps {
  session: Session; helperId: string; items: ThreadItem[]; visible: boolean;
  onBack: () => void; onClose: () => void; theme: 'dark' | 'light';
  contentRef?: Ref<HTMLDivElement>; enterDelay?: number; paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
}

const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;

/** Spec 2026-10-13 §6: a helper's own thread. The session view stays mounted behind it, so going back keeps its scroll. */
export function HelperView({ session, helperId, items, visible, onBack, onClose, theme, contentRef, enterDelay = 120, paused, frozen, reducedMotion, now }: HelperViewProps) {
  const { t } = useI18n();
  const { helper, items: own, report } = helperThread(items, helperId);
  const live = session.helpers.find(h => h.id === helperId);
  const working = (live?.state ?? helper?.state) !== 'exited';
  const prompt = [...items].reverse().find((i): i is Extract<ThreadItem, { kind: 'prompt' }> => i.kind === 'prompt' && !i.helperId && i.turn === (helper?.turn ?? -1));
  const helperSession: Session = { ...session, helpers: [] };
  return (
    <div data-layer="helper" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      {/* Header and body are measured together (natural height, capped by the layer) so the panel fits both. */}
      <div ref={contentRef} data-helper-content style={{ display: 'flex', flexDirection: 'column', flex: '0 1 auto', minHeight: 0, maxHeight: '100%' }}>
      <div style={{ position: 'relative', flex: '0 0 auto', padding: '12px 17px 10px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" data-back data-initial-focus onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, background: 'none', border: 0, font: 'inherit', fontSize: 12, color: 'var(--sidebar-foreground)', cursor: 'pointer', textAlign: 'left' }}>
          <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>←</span>
          <span>{session.name} · {t.thread.backTo}</span>
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
          <span style={muted}>{t.thread.delegatedBy} {session.name}{helper?.agentType ? ` · ${helper.agentType}` : ''}</span>
          <span style={{ ...muted, color: working ? 'var(--warning)' : 'var(--success, var(--sidebar-primary))' }}>{working ? t.thread.helperWorking : t.thread.helperDone}</span>
        </div>
        <h2 data-helper-task style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', fontWeight: 500, overflowWrap: 'anywhere' }}>{helper?.task || live?.task || ''}</h2>
        <button type="button" aria-label={t.session.close} onClick={onClose} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 0, color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      <div className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
        <div style={{ padding: '8px 17px 16px' }}>
          {prompt && <div style={{ padding: '8px 0 10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ ...muted, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{t.thread.instruction}</span>
            <p style={{ ...muted, margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prompt.text}</p>
          </div>}
          <Thread session={helperSession} items={own.map(i => ({ ...i, helperId: undefined }))} t={t} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} now={now} />
          {report
            ? <article data-report style={{ marginTop: 12, borderLeft: '2px solid var(--success, var(--sidebar-primary))', padding: '2px 0 2px 10px' }}>
                <span style={{ ...muted, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--success, var(--sidebar-primary))' }}>{t.thread.report}</span>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.text}</p>
              </article>
            : working && <p style={{ ...muted, margin: '12px 0 0' }}>{helper?.agentType ?? session.name} {t.thread.helperWaiting}</p>}
        </div>
      </div>
      </div>
    </div>
  );
}
