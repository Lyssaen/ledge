import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ModelIdSchema } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';

/** The glyphs of the model menu (mockup ledge-model-picker v2): a chip, the up-down chevron, the loupe, the minus. */
export const MODEL_ICONS = {
  chip: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
  upDown: ['m7 15 5 5 5-5', 'm7 9 5-5 5 5'],
  down: ['m6 9 6 6 6-6'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'm20 20-3.5-3.5'],
  minus: ['M5 12h14']
} as const;

/** A row of the menu: `id` null is the agent's own default (nothing passed). */
export interface MenuModel { id: string | null; label: string; description?: string; isDefault?: boolean }
/** Rows drawn at once: Cursor offers hundreds of models, the rest is reached by searching. */
export const MENU_ROWS = 50;

/** Where the floating list goes: under its anchor, or above when the room under it is short; never wider than the window. */
function place(anchor: DOMRect, up: boolean): CSSProperties {
  const width = Math.min(Math.max(anchor.width, 340), window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = window.innerHeight - anchor.bottom;
  return up || below < 300 ? { left, width, bottom: window.innerHeight - anchor.top + 6 } : { left, width, top: anchor.bottom + 6 };
}

/**
 * The list of an agent's models (#58, mockup v2): a search field, one line per model (its name, « default », its description
 * cut to the line), a model typed that the machine does not list « used as is ». Floats over the page from `anchor` (a portal:
 * a modal's scroll never clips it); Escape or a click outside closes it, arrows and Enter pick from the field.
 */
export function ModelMenu(p: {
  anchor: HTMLElement; up?: boolean; label: string; models: readonly MenuModel[]; selected: string | null; total?: number;
  /** Shown beside the model the agent runs now, in a live session. */ current?: string | null;
  onPick(id: string | null): void; onClose(): void; children?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const tl = t.launch;
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState<CSSProperties>(() => place(p.anchor.getBoundingClientRect(), !!p.up));
  useLayoutEffect(() => {
    const follow = () => setStyle(place(p.anchor.getBoundingClientRect(), !!p.up));
    window.addEventListener('resize', follow); window.addEventListener('scroll', follow, true);
    return () => { window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow, true); };
  }, [p.anchor, p.up]);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const outside = (e: MouseEvent) => { const n = e.target as Node; if (!box.current?.contains(n) && !p.anchor.contains(n)) p.onClose(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [p.anchor, p.onClose]);

  const typed = query.trim();
  const q = typed.toLowerCase();
  const hits = q ? p.models.filter(m => `${m.label} ${m.id ?? ''} ${m.description ?? ''}`.toLowerCase().includes(q)) : p.models;
  const rows = hits.slice(0, MENU_ROWS);
  // A model the machine does not list, passed as typed: offered when the text is an id and none of the rows is it.
  const raw = typed && ModelIdSchema.safeParse(typed).success && !p.models.some(m => m.id === typed) ? typed : null;
  const options: Array<{ id: string | null; raw?: true }> = [...rows.map(m => ({ id: m.id })), ...(raw ? [{ id: raw, raw: true as const }] : [])];
  const [active, setActive] = useState(() => Math.max(0, rows.findIndex(m => m.id === p.selected)));
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, options.length - 1))); }, [options.length]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, listId]);
  const hidden = (q ? hits.length : (p.total ?? p.models.length)) - rows.length;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = options[active]; if (o) p.onPick(o.id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose(); p.anchor.focus(); }
  };

  return createPortal(
    <div ref={box} className="model-menu" style={style} role="dialog" aria-label={p.label}>
      <div className="model-search">
        <Icon d={MODEL_ICONS.search} size={15} />
        <input ref={field} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={tl.searchModel}
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined} spellCheck={false} value={query}
          placeholder={p.total ? tl.searchMany(p.total) : tl.searchFew} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
      </div>
      <div className="model-options" role="listbox" id={listId} aria-label={p.label}>
        {rows.map((m, i) => {
          const on = m.id === p.selected;
          return (
            <div key={m.id ?? ''} id={`${listId}-${i}`} role="option" aria-selected={on} className={cls('model-option', i === active && 'active')}
              onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => p.onPick(m.id)}>
              <span className="model-name">{m.label}</span>
              {m.isDefault && <span className="model-badge">{tl.defaultBadge}</span>}
              {p.current !== undefined && m.id === p.current && <span className="model-badge">{tl.currentBadge}</span>}
              <span className="model-desc">{m.description}</span>
              {on && <Icon d={ICONS.check.d} size={15} />}
            </div>
          );
        })}
        {raw && (
          <div id={`${listId}-${rows.length}`} role="option" aria-selected={false} className={cls('model-option raw', active === rows.length && 'active')}
            onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(rows.length)} onClick={() => p.onPick(raw)}>
            <span className="model-name">{tl.useAsIs}</span><span className="model-desc mono">{raw}</span>
          </div>
        )}
        {rows.length === 0 && !raw && <p className="model-note">{typed ? tl.notAnId : tl.noMatch}</p>}
        {hidden > 0 && <p className="model-note">{tl.moreModels(hidden)}</p>}
      </div>
      {p.children}
    </div>,
    document.body
  );
}

/** The effort as a stepper of fixed width (− label +, one dot per level): four, five or six levels never overflow. */
export function EffortStepper(p: { efforts: readonly string[]; value: string | undefined; disabled?: boolean; onChange(effort: string): void }): JSX.Element {
  const { t } = useI18n();
  const tl = t.launch;
  const i = p.value ? p.efforts.indexOf(p.value) : -1;
  const label = (e: string) => (tl.efforts as Record<string, string | undefined>)[e] ?? e;
  return (
    <div className="effort-stepper" role="group" aria-label={tl.effort} title={tl.effortHint}>
      <button type="button" aria-label={tl.lessEffort} disabled={p.disabled || i <= 0} onClick={() => p.onChange(p.efforts[i - 1]!)}><Icon d={MODEL_ICONS.minus} size={14} /></button>
      <span className="effort-value">
        <output aria-live="polite">{p.value ? label(p.value) : '—'}</output>
        <span className="effort-dots" aria-hidden="true">{p.efforts.map((e, j) => <i key={e} className={cls(j <= i && 'on')} />)}</span>
      </span>
      <button type="button" aria-label={tl.moreEffort} disabled={p.disabled || i >= p.efforts.length - 1} onClick={() => p.onChange(p.efforts[Math.max(i, -1) + 1]!)}><Icon d={ICONS.plus.d} size={14} /></button>
    </div>
  );
}
