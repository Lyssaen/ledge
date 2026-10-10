import type { ReactNode } from 'react';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';
import { UI_SCALES, percent, type UiScale } from '../scale';

export interface SettingsViewProps {
  visible: boolean; theme: 'dark' | 'light'; dnd: boolean;
  /** The app's own reduced-motion setting, and whether the OS already asks for it (which always wins). */
  reduced: boolean; osReduced: boolean;
  onToggleTheme?: () => void; onToggleDnd: () => void; onReduced: (on: boolean) => void; onBack: () => void; onClose: () => void;
  /** The Size setting, the scale Auto resolves to on this screen, and how to change it (applied live). */
  uiScale?: UiScale; autoScale?: number; onUiScale?: (s: UiScale) => void;
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="dnd-switch" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', cursor: 'pointer' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
        <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span className="dnd-track" aria-hidden="true" style={{ flexShrink: 0, display: 'inline-block', width: 32, height: 18, borderRadius: 9999, background: checked ? 'var(--sidebar-primary)' : 'var(--muted)', border: '1px solid var(--input)', boxSizing: 'border-box', position: 'relative', transition: transition([['background-color', 'hover']]) }}>
        <span style={{ position: 'absolute', left: checked ? 16 : 2, top: 2, width: 12, height: 12, borderRadius: 9999, background: checked ? 'var(--primary-foreground)' : 'var(--muted-foreground)', transition: transition([['left', 'hover']]) }} />
      </span>
    </label>
  );
}

/** The UI scale as a segmented radio group: Auto (with the value it resolves to) or a fixed percentage. */
function SizeRow({ value, auto, onChange }: { value: UiScale; auto: number; onChange?: (s: UiScale) => void }) {
  return (
    <fieldset style={{ margin: 0, padding: '10px 0', border: 'none', minWidth: 0 }}>
      <legend style={{ padding: 0, fontSize: 14, lineHeight: '18px', fontWeight: 500 }}>Size</legend>
      <span style={{ display: 'block', marginTop: 2, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>Scale the whole overlay for large screens.</span>
      <div style={{ display: 'flex', marginTop: 8, padding: 2, gap: 2, borderRadius: 'var(--radius-md)', background: 'var(--muted)', border: '1px solid var(--input)' }}>
        {UI_SCALES.map(s => {
          const on = s === value;
          return (
            <label key={String(s)} className="ledge-opt" data-checked={on || undefined} style={{ position: 'relative', flex: s === 'auto' ? '1.6 1 0' : '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, borderRadius: 'calc(var(--radius-md) - 2px)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', background: on ? 'var(--sidebar)' : 'transparent', color: on ? 'var(--sidebar-foreground)' : 'var(--muted-foreground)', boxShadow: on ? '0 1px 2px rgb(0 0 0 / .2)' : 'none', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
              <input type="radio" name="ledge-ui-scale" value={String(s)} checked={on} onChange={() => onChange?.(s)} disabled={!onChange} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
              {s === 'auto' ? `Auto (${percent(auto)})` : percent(s)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div style={{ borderBottom: '1px solid var(--sidebar-border)' }}>{children}</div>;

/** Preferences inside the same surface; they are the app's own (theme, do not disturb, motion), not a local copy. */
export function SettingsView(p: SettingsViewProps) {
  const light = p.theme === 'light';
  return (
    <div data-layer="settings" inert={!p.visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none', transition: transition([['opacity', p.visible ? 'fadeIn' : 'fadeOut', p.visible ? 120 : 0]]) }}>
      <DetailHeader title="Your Ledge" onBack={p.onBack} onClose={p.onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 16px 12px', overflowY: 'auto', minHeight: 0 }}>
        <Row><SizeRow value={p.uiScale ?? 'auto'} auto={p.autoScale ?? 1} onChange={p.onUiScale} /></Row>
        <Row><Switch label="Do not disturb" hint="New asks stay in the handle." checked={p.dnd} onChange={on => { if (on !== p.dnd) p.onToggleDnd(); }} /></Row>
        <Row><Switch label="Reduced motion" hint="States stay readable without animation." checked={p.reduced} onChange={p.onReduced} /></Row>
        {p.osReduced && !p.reduced && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', padding: '8px 0' }}>Your system asks for reduced motion; Ledge keeps respecting it.</span>}
        <button type="button" onClick={p.onToggleTheme} disabled={!p.onToggleTheme} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
            <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 500 }}>{light ? 'Light theme · Pebble' : 'Dark theme · Signal'}</span>
            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>Switch the theme and the mascot material</span>
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Ctrl+Alt+T</span>
        </button>
      </div>
    </div>
  );
}
