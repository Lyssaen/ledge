import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { dotOf, type Dot } from '../../nav/agents';
import { providerOf } from '../../workspace/sessionTab';
import { ProviderLogo } from '../ProviderLogo';
import { paletteRows, type PaletteCommand, type PaletteRow, type PaletteSession } from './model';
import '../../styles/ide.css';
import '../../styles/ide-rigs.css';

export interface IdePaletteProps {
  sessions: readonly PaletteSession[]; commands: readonly PaletteCommand[];
  /** The session behind a row, for its state dot. */
  sessionOf(id: string): Session | undefined;
  onClose(): void;
}

/** A session's dot, in the colours of the Rigs view's (`ide-rigs-dot`). */
const DOT: Record<Dot, string> = { approval: 'perm', question: 'ask', working: 'work', done: 'idle', offline: 'off', error: 'perm' };

/** The IDE palette (Ctrl+K, the title bar's field; mockup `openPal`, `palList`): a field, ten rows at most, the keys' reminder.
 *  ↑ ↓ choose, Enter runs, Escape or a click outside closes. */
export function IdePalette({ sessions, commands, sessionOf, onClose }: IdePaletteProps): JSX.Element {
  const { t } = useI18n();
  const p = t.ide.palette;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const rows = useMemo(() => paletteRows(query, sessions, commands), [query, sessions, commands]);
  const at = Math.min(index, Math.max(0, rows.length - 1));
  const list = useId();
  const box = useRef<HTMLDivElement>(null);
  const run = (r: PaletteRow) => { onClose(); r.run(); };
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);
  const rowId = (i: number) => `${list}-${i}`;
  return (
    <div ref={box} className="ide-palette" role="dialog" aria-label={p.label}>
      <div className="ide-pal-pin">
        <span className="ide-pal-mark" aria-hidden="true">›</span>
        <input autoFocus role="combobox" aria-label={p.label} placeholder={p.placeholder} value={query} autoComplete="off"
          aria-expanded="true" aria-controls={list} aria-activedescendant={rows.length ? rowId(at) : undefined}
          onChange={e => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))); }
            else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); run(rows[at]!); }
          }} />
      </div>
      <div id={list} role="listbox" aria-label={p.results} className="ide-pal-list">
        {rows.map((r, i) => (
          <div key={`${r.kind}:${r.id}`} id={rowId(i)} role="option" aria-selected={i === at} className={`ide-pal-it${i === at ? ' sel' : ''}`}
            onMouseMove={() => setIndex(i)} onClick={() => run(r)}>
            {r.kind === 'session' && (() => { const s = sessionOf(r.id); return s && <><span className={`ide-rigs-dot d-${DOT[dotOf(s)]}`} aria-hidden="true" /><ProviderLogo provider={providerOf(s.tool)} size={12} /></>; })()}
            <span className="ide-pal-l"><span aria-hidden="true">{r.kind === 'session' ? '@ ' : '› '}</span>{r.label}</span>
            {r.hint && <span className="ide-pal-r">{r.hint}</span>}
          </div>
        ))}
        {rows.length === 0 && <div className="ide-pal-it ide-pal-none">{p.empty}</div>}
      </div>
      <div className="ide-pal-foot"><span>{p.browse}</span><span>{p.open}</span><span>{p.close}</span></div>
    </div>
  );
}
