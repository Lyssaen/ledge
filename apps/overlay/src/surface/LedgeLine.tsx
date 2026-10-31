import type { CSSProperties, Ref } from 'react';
import { CategoryChip } from '@ledge/ui/chat/ledge/CategoryChip';
import { LedgeThreadCopyProvider } from '@ledge/ui/chat/ledge/copy';
import { useI18n, ledgeThreadCopy } from '../i18n/lang';
import type { Messages } from '../i18n/messages';
import { FILET, LINE } from './geometry';
import type { HandleLine } from './handleLine';

/** The line's accessible sentence (« factory · build → review-a : … », « Architecture · orch-lead : … · 1 pour toi »). */
export function lineLabel(line: HandleLine, t: Messages): string {
  switch (line.kind) {
    case 'calm': return '';
    case 'exchange': return t.notchLine.exchange(line.rigName, line.from, line.to, line.text);
    case 'decided': return line.text;
    case 'forYou': return t.notchLine.forYou(line.category ? t.ledgeThread.category(line.category) : undefined, line.summary, line.count);
  }
}

/** The resting filet's mark for each state: the counter's red for « pour toi ». */
const MARK: Record<Exclude<HandleLine['kind'], 'calm'>, string> = { forYou: 'var(--danger-text)', decided: 'var(--success)', exchange: 'var(--info)' };

const cut: CSSProperties = { minWidth: 0, maxWidth: LINE.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const muted: CSSProperties = { color: 'var(--muted-foreground)', whiteSpace: 'nowrap' };

/**
 * Ledge's line in the closed notch (spec §8.5, `nn-closed-*`), in place of the bot row: nothing when calm; awake, the last exchange
 * (rig, from → to, its text), « J'ai tranché … » with « Revenir dessus », or the category chip, the summary and the red counter;
 * resting (the 10 px filet), a single mark in the state's tone. It opens the notch as Ledge does. `lineRef` gets the element whose
 * width the notch measures.
 */
export function LedgeLine({ line, variant, onOpen, lineRef }: { line: HandleLine; variant: 'filet' | 'island'; onOpen?: () => void; lineRef?: Ref<HTMLButtonElement> }) {
  const { t } = useI18n();
  if (line.kind === 'calm') return null;
  const label = lineLabel(line, t);
  const button: CSSProperties = { display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 0, padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' };
  if (variant === 'filet') {
    return (
      <button ref={lineRef} type="button" data-ledge-line data-kind={line.kind} aria-label={label} title={label} onClick={() => onOpen?.()}
        style={{ ...button, flexShrink: 0, height: 6, marginLeft: FILET.sep }}>
        <span data-line-mark={line.kind} style={{ display: 'block', width: FILET.dash, height: 3, borderRadius: 1, background: MARK[line.kind] }} />
      </button>
    );
  }
  return (
    <button ref={lineRef} type="button" data-ledge-line data-kind={line.kind} aria-label={label} onClick={() => onOpen?.()}
      style={{ ...button, gap: 10, marginLeft: LINE.gap, fontSize: 13, lineHeight: '20px', color: 'var(--sidebar-foreground)' }}>
      {line.kind === 'exchange' && <>
        <span style={muted}>{line.rigName}</span>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{line.from} → {line.to}</span>
        <span style={{ ...cut, color: 'var(--muted-foreground)' }}>{line.text}</span>
      </>}
      {line.kind === 'decided' && <>
        <span style={cut}>{line.text}</span>
        <span aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: 1, height: 16, background: 'var(--sidebar-border)' }} />
        <span style={muted}>{t.ledgeThread.decided.revisit}</span>
      </>}
      {line.kind === 'forYou' && <>
        {line.category && <LedgeThreadCopyProvider value={ledgeThreadCopy(t)}><CategoryChip category={line.category} /></LedgeThreadCopyProvider>}
        {line.summary && <span style={cut}>{line.summary}</span>}
        <span data-counter className="mono" aria-hidden="true" style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 'var(--radius-sm)', background: 'var(--status-danger-soft)', color: 'var(--danger-text)', fontSize: 12, fontWeight: 600, lineHeight: '20px', textAlign: 'center' }}>{line.count}</span>
      </>}
    </button>
  );
}
