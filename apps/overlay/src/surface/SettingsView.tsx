import type { ReactNode, Ref } from 'react';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';
import { UI_SCALES, percent, type ScaleTarget, type UiScale } from '../scale';
import { useI18n } from '../i18n/lang';
import { LANGS, type Lang } from '../i18n/messages';

export interface SettingsViewProps {
  visible: boolean; theme: 'dark' | 'light'; dnd: boolean;
  /** The app's own reduced-motion setting, and whether the OS already asks for it (which always wins). */
  reduced: boolean; osReduced: boolean;
  onToggleTheme?: () => void; onToggleDnd: () => void; onReduced: (on: boolean) => void; onBack: () => void; onClose: () => void;
  /** The handle and window size settings, the scales Auto resolves to on this screen, and how to change them (live). */
  scales?: Record<ScaleTarget, UiScale>; autoScales?: Record<ScaleTarget, number>; onScale?: (target: ScaleTarget, s: UiScale) => void;
  /** The Language setting (applied live). */
  onLang?: (l: Lang) => void;
  /** The body's natural height, measured by the surface to size itself. */
  contentRef?: Ref<HTMLDivElement>;
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="dnd-switch" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', cursor: 'pointer' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
        <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span className="dnd-track" aria-hidden="true" style={{ flexShrink: 0, display: 'inline-block', width: 32, height: 18, borderRadius: 9999, background: checked ? 'var(--sidebar-primary)' : 'var(--muted)', border: '1px solid var(--input)', boxSizing: 'border-box', position: 'relative', transition: transition([['background-color', 'hover']]) }}>
        <span style={{ position: 'absolute', left: checked ? 16 : 2, top: 2, width: 12, height: 12, borderRadius: 9999, background: checked ? 'var(--primary-foreground)' : 'var(--muted-foreground)', transition: transition([['left', 'hover']]) }} />
      </span>
    </label>
  );
}

/** A labelled segmented radio group (Size, Language): native radios, so arrows and Tab behave as usual. */
export function Segmented<T extends string | number>({ name, label, hint, value, options, onChange }: { name: string; label: string; hint: string; value: T; options: Array<{ value: T; label: string; wide?: boolean }>; onChange?: (v: T) => void }) {
  return (
    <fieldset style={{ margin: 0, padding: '0 0 12px', border: 'none', minWidth: 0 }}>
      {/* A fieldset's padding sits under its legend: the row's top space goes on the legend itself. */}
      <legend style={{ padding: '12px 0 0', fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{label}</legend>
      <span style={{ display: 'block', marginTop: 3, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{hint}</span>
      <div style={{ display: 'flex', marginTop: 8, padding: 2, gap: 2, borderRadius: 'var(--radius-md)', background: 'var(--muted)', border: '1px solid var(--input)' }}>
        {options.map(o => {
          const on = o.value === value;
          return (
            <label key={String(o.value)} className="ledge-opt ledge-seg" data-seg-checked={on || undefined} style={{ position: 'relative', flex: o.wide ? '1.6 1 0' : '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, borderRadius: 'calc(var(--radius-md) - 2px)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', background: on ? 'var(--sidebar)' : 'transparent', color: on ? 'var(--sidebar-foreground)' : 'var(--muted-foreground)', boxShadow: on ? '0 1px 2px rgb(0 0 0 / .2)' : 'none', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
              <input type="radio" name={name} value={String(o.value)} checked={on} onChange={() => onChange?.(o.value)} disabled={!onChange} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div style={{ borderBottom: '1px solid var(--sidebar-border)' }}>{children}</div>;

/** Preferences inside the same surface; they are the app's own (language, size, theme, do not disturb, motion), not a local copy. */
export function SettingsView(p: SettingsViewProps) {
  const { t, lang } = useI18n();
  const light = p.theme === 'light';
  return (
    <div data-layer="settings" inert={!p.visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none', transition: transition([['opacity', p.visible ? 'fadeIn' : 'fadeOut', p.visible ? 120 : 0]]) }}>
      <DetailHeader title={t.settings.title} onBack={p.onBack} onClose={p.onClose} />
      <div className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
        <div ref={p.contentRef} style={{ display: 'flex', flexDirection: 'column', padding: '4px 17px 12px' }}>
          <Row><Segmented name="ledge-lang" label={t.lang.label} hint={t.lang.hint} value={lang} onChange={p.onLang} options={LANGS.map(l => ({ value: l, label: t.lang[l] }))} /></Row>
          {(['handle', 'panel'] as const).map(target => (
            <Row key={target}><Segmented<UiScale> name={`ledge-${target}-scale`} label={target === 'handle' ? t.settings.handleSize : t.settings.windowSize} hint={target === 'handle' ? t.settings.handleSizeHint : t.settings.windowSizeHint}
              value={p.scales?.[target] ?? 'auto'} onChange={p.onScale ? s => p.onScale!(target, s) : undefined}
              options={UI_SCALES.map(s => ({ value: s, label: s === 'auto' ? t.settings.auto(percent(p.autoScales?.[target] ?? 1)) : percent(s), wide: s === 'auto' }))} /></Row>
          ))}
          <Row><Switch label={t.settings.dnd} hint={t.settings.dndHint} checked={p.dnd} onChange={on => { if (on !== p.dnd) p.onToggleDnd(); }} /></Row>
          <Row><Switch label={t.settings.reduced} hint={t.settings.reducedHint} checked={p.reduced} onChange={p.onReduced} /></Row>
          {p.osReduced && !p.reduced && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', padding: '8px 0' }}>{t.settings.osReduced}</span>}
          <button type="button" onClick={p.onToggleTheme} disabled={!p.onToggleTheme} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
              <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{light ? t.settings.themeLight : t.settings.themeDark}</span>
              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.settings.themeHint}</span>
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Ctrl Alt T</span>
          </button>
        </div>
      </div>
    </div>
  );
}
