import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentContent, DocumentErrorCode } from '@ledge/protocol';
import { ResidentMascot } from '../bots/ResidentMascot';
import { useI18n } from '../i18n/lang';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { MarkdownDocument, splitMarkdownFrontmatter, type DocumentHeading } from '../documents/MarkdownDocument';
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
  const source = state.status === 'ready' ? state.document.text : '';
  const name = splitMarkdownFrontmatter(source).title || path.split('/').at(-1) || t.reader.title;
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
      <Button variant="ghost" size="icon" aria-label={t.reader.reload} title={t.reader.reload} onClick={onReload}><Icon {...ICONS.refresh} /></Button>
      <Button variant="ghost" size="icon" aria-label={expanded ? t.reader.shrink : t.reader.expand} onClick={onExpand}><Icon {...ICONS.expand} /></Button>
      <Button variant="ghost" size="icon" aria-label={t.reader.close} onClick={onClose}><Icon {...ICONS.close} /></Button>
    </header>
    <div title={path} style={{ padding: '8px 24px', flexShrink: 0, fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', fontSize: 11, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' }}>{path}</div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
      <Button variant={raw ? 'ghost' : 'secondary'} size="sm" onClick={() => onReading({ raw: false })}>{t.reader.read}</Button>
      <Button variant={raw ? 'secondary' : 'ghost'} size="sm" onClick={() => onReading({ raw: true })}>{t.reader.source}</Button>
      <Button variant="ghost" size="sm" aria-expanded={outline} onClick={() => setOutline(x => !x)}>{t.reader.outline}</Button>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t.reader.readonly}</span>
    </div>
    <div style={{ position: 'relative', minHeight: 0, flex: 1 }}>
      {outline && <nav aria-label={t.reader.outline} className="ledge-outline">
        <div className="ledge-outline-header"><strong>{t.reader.outline}</strong><span aria-hidden="true" className="ledge-outline-count">{headings.length}</span><Button variant="ghost" size="icon" aria-label={t.reader.close} onClick={() => setOutline(false)}><Icon {...ICONS.close} size={14} /></Button></div>
        <div className="ledge-outline-list">{headings.map((h, i) => <button key={h.id} type="button" className="ledge-outline-item" data-depth={h.depth} style={{ paddingLeft: 15 + Math.min(h.depth - 1, 4) * 17 }} onClick={() => { onReading({ raw: false }); setOutline(false); scroll.current?.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`)?.scrollIntoView({ block: 'start' }); }}><span className="ledge-outline-marker">{h.depth === 1 ? String(i + 1).padStart(2, '0') : '·'}</span><span>{h.text}</span></button>)}</div>
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
