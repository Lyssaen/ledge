import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentContent, DocumentErrorCode } from '@ledge/protocol';
import { ResidentMascot } from '../bots/ResidentMascot';
import { useI18n } from '../i18n/lang';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { MarkdownDocument, type DocumentHeading } from '../documents/MarkdownDocument';
import type { DocumentReference } from '../documents/references';
import type { ReadingEntry } from '../documents/useDocumentReader';

export type DocumentViewState = { status: 'loading'; path: string } | { status: 'ready'; document: DocumentContent } | { status: 'error'; path: string; code: DocumentErrorCode | 'offline' | 'timeout' };
export function DocumentView({ state, originName, theme, expanded, onBack, onClose, onExpand, onReload, onDocument, reading, onReading }: {
  state: DocumentViewState; originName: string; theme: 'dark' | 'light'; expanded: boolean;
  onBack: () => void; onClose: () => void; onExpand: () => void; onReload: () => void; onDocument: (ref: DocumentReference) => void;
  reading: ReadingEntry; onReading: (patch: Partial<Pick<ReadingEntry, 'scroll' | 'sourceScroll' | 'raw'>>) => void;
}) {
  const { t } = useI18n();
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [outline, setOutline] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const path = state.status === 'ready' ? state.document.path : state.path;
  useEffect(() => { setOutline(false); }, [path]);
  const name = path.split('/').at(-1) || t.reader.title;
  const source = state.status === 'ready' ? state.document.text : '';
  const raw = reading.raw;
  const setHeadingsStable = useCallback((h: DocumentHeading[]) => setHeadings([...h]), []);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = raw ? reading.sourceScroll : reading.scroll; }, [path, raw, state.status]);
  useLayoutEffect(() => {
    if (state.status !== 'ready' || !scroll.current) return;
    let node: HTMLElement | null = null;
    if (reading.reference.line) {
      node = scroll.current.querySelector<HTMLElement>(`[data-source-line="${reading.reference.line}"]`);
    } else if (reading.reference.anchor) {
      node = [...scroll.current.querySelectorAll<HTMLElement>('[id]')].find(x => x.id === reading.reference.anchor) ?? null;
    }
    setTargetMissing(!!(reading.reference.line || reading.reference.anchor) && !node);
    if (node) node.scrollIntoView({ block: 'start' });
    else if (reading.reference.line || reading.reference.anchor) scroll.current.scrollTop = 0;
  }, [path, state.status]);
  return <div data-layer="reader" onKeyDownCapture={e => { if (e.key === 'Escape' && outline) { e.stopPropagation(); e.preventDefault(); setOutline(false); } }} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <header style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)', boxSizing: 'border-box' }}>
      <Button variant="ghost" size="icon" aria-label={t.reader.back} onClick={onBack} data-initial-focus><Icon {...ICONS.chevronLeft} /></Button>
      <ResidentMascot size={26} theme={theme} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong><span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{originName}</span></div>
      <Button variant="ghost" size="icon" aria-label={expanded ? t.reader.shrink : t.reader.expand} onClick={onExpand}><Icon {...ICONS.expand} /></Button>
      <Button variant="ghost" size="icon" aria-label={t.reader.close} onClick={onClose}><Icon {...ICONS.close} /></Button>
    </header>
    <div title={path} style={{ padding: '8px 24px', flexShrink: 0, fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', fontSize: 11, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' }}>{path}</div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
      <Button variant={raw ? 'ghost' : 'secondary'} size="sm" onClick={() => onReading({ raw: false })}>{t.reader.read}</Button>
      <Button variant={raw ? 'secondary' : 'ghost'} size="sm" onClick={() => onReading({ raw: true })}>{t.reader.source}</Button>
      <Button variant="ghost" size="sm" aria-expanded={outline} onClick={() => setOutline(x => !x)}>{t.reader.outline}</Button>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" onClick={onReload}>{t.reader.reload}</Button>
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t.reader.readonly}</span>
    </div>
    <div style={{ position: 'relative', minHeight: 0, flex: 1 }}>
      {outline && <nav aria-label={t.reader.outline} style={{ position: 'absolute', zIndex: 2, inset: '0 0 auto', maxHeight: '70%', overflowY: 'auto', padding: 16, background: 'var(--notch)', borderBottom: '1px solid var(--sidebar-border)', boxShadow: '0 8px 20px #0003' }}>
        {headings.map(h => <button key={h.id} type="button" style={{ display: 'block', marginLeft: (h.depth - 1) * 12, padding: '5px 4px', border: 0, background: 'none', color: 'var(--sidebar-foreground)', textAlign: 'left', cursor: 'pointer' }} onClick={() => { onReading({ raw: false }); setOutline(false); scroll.current?.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`)?.scrollIntoView({ block: 'start' }); }}>{h.text}</button>)}
      </nav>}
      <div ref={scroll} data-scroll className="ledge-scroll" onScroll={e => onReading(raw ? { sourceScroll: e.currentTarget.scrollTop } : { scroll: e.currentTarget.scrollTop })} style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {targetMissing && state.status === 'ready' && <p role="status" style={{ margin: 0, padding: '10px 24px', color: 'var(--muted-foreground)', fontSize: 12 }}>{t.reader.targetMissing}</p>}
        {state.status === 'loading' && <p role="status" style={{ padding: 24 }}>{t.reader.loading}</p>}
        {state.status === 'error' && <div role="alert" style={{ padding: 24 }}><p>{t.reader.error[state.code]}</p><Button variant="secondary" size="sm" onClick={onReload}>{t.reader.retry}</Button></div>}
        {state.status === 'ready' && (source ? raw ? <pre data-document-source style={{ margin: 0, padding: 24, fontSize: 12, lineHeight: '20px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{source.split('\n').map((line, i, all) => <span key={i} data-source-line={i + 1}>{line}{i < all.length - 1 ? '\n' : ''}</span>)}</pre> : <MarkdownDocument text={source} onDocument={onDocument} onHeadings={setHeadingsStable} /> : <p style={{ padding: 24 }}>{t.reader.empty}</p>)}
      </div>
    </div>
    <footer style={{ height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderTop: '1px solid var(--sidebar-border)', fontSize: 11 }}><Button variant="ghost" size="sm" onClick={onBack}>{t.reader.back}</Button><span style={{ color: 'var(--muted-foreground)' }}>{t.reader.escape}</span></footer>
  </div>;
}
