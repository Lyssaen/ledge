import { transition } from '../motion';

export interface TabItem<T extends string> { value: T; label: string }

/** The ids a tab and its panel share: the panel renders with `id={panelId}` and `aria-labelledby={tabId}`. */
export const tabIds = (id: string, value: string) => ({ tabId: `${id}-tab-${value}`, panelId: `${id}-panel-${value}` });

/** A row of tabs in the segmented look (Settings): one tab in the tab order, Left/Right wrap, Home/End jump, and a
 *  tab chosen from the keyboard takes focus. The caller renders the chosen panel with `tabIds`. */
export function Tabs<T extends string>({ id, label, value, tabs, onChange }: { id: string; label: string; value: T; tabs: ReadonlyArray<TabItem<T>>; onChange: (v: T) => void }) {
  const choose = (v: T) => { onChange(v); document.getElementById(tabIds(id, v).tabId)?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(tabs[to]!.value);
  };
  return (
    <div role="tablist" aria-label={label} style={{ display: 'flex', padding: 2, gap: 2, borderRadius: 'var(--radius-md)', background: 'var(--muted)', border: '1px solid var(--input)' }}>
      {tabs.map((tab, i) => {
        const on = tab.value === value;
        const { tabId, panelId } = tabIds(id, tab.value);
        return (
          <button key={tab.value} type="button" role="tab" id={tabId} aria-selected={on} aria-controls={panelId} tabIndex={on ? 0 : -1} onClick={() => onChange(tab.value)} onKeyDown={e => onKeyDown(e, i)}
            style={{ flex: '1 1 0', height: 28, padding: 0, border: 'none', borderRadius: 'calc(var(--radius-md) - 2px)', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', background: on ? 'var(--sidebar)' : 'transparent', color: on ? 'var(--sidebar-foreground)' : 'var(--muted-foreground)', boxShadow: on ? '0 1px 2px rgb(0 0 0 / .2)' : 'none', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
