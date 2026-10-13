import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { DEFAULT_ACCENT, parseAccent } from '../accent';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';
import { UI_SCALES, percent, type ScaleTarget, type UiScale } from '../scale';
import { ISLAND_POSITIONS, type IslandPosition } from '../island';
import { useI18n } from '../i18n/lang';
import { LANGS, type Lang } from '../i18n/messages';
import { Button } from '../ui/Button';
import { Tabs, tabIds } from '../ui/Tabs';
import { CATEGORIES, FINISHED_VALUES, VOLUMES, type FinishedNotify, type SoundPrefs, type SoundPatch } from '../sounds/preferences';
import { resolveMonitor, type MonitorInfo } from '../monitor';
import { TOOLS } from '../defaultTool';
import { toolName, duration } from '../format';
import { compareVersions } from '../update/semver';
import type { DaemonInfo, Tool } from '@ledge/protocol';
import { MachineSettings } from './MachineSettings';
import type { MachineConfig, MachineState, ProbeResult } from '../daemon/machines';

export interface SettingsViewProps {
  /** The Machines tab (absent: no tab): the machines, how to change them, test an SSH alias and reconnect one now. */
  machines?: MachineState[]; onMachines?: (config: MachineConfig[]) => void; onProbe?: (ssh: string) => Promise<ProbeResult>; onRetry?: (id: string) => void;
  visible: boolean; theme: 'dark' | 'light'; dnd: boolean;
  /** When the layer's fade-in starts, in ms (see `enterDelay` in motion). */
  enterDelay?: number;
  /** The app's own reduced-motion setting, and whether the OS already asks for it (which always wins). */
  reduced: boolean; osReduced: boolean;
  finished: FinishedNotify; onFinished: (v: FinishedNotify) => void; sounds: SoundPrefs; onSounds: (patch: SoundPatch) => void; onTestSound: () => void;
  onToggleTheme?: () => void; onToggleDnd: () => void; onReduced: (on: boolean) => void; onBack: () => void; onClose: () => void;
  /** The handle and window size settings, the scales Auto resolves to on this screen, and how to change them (live). */
  scales?: Record<ScaleTarget, UiScale>; autoScales?: Record<ScaleTarget, number>; onScale?: (target: ScaleTarget, s: UiScale) => void;
  /** The Language setting (applied live). */
  onLang?: (l: Lang) => void;
  /** The island's position on the top edge and the discreet strip under a covering window (both applied live). */
  islandPosition?: IslandPosition; onIslandPosition?: (p: IslandPosition) => void; discreet?: boolean; onDiscreet?: (on: boolean) => void;
  /** The Screen setting: the monitors to choose from (none: the group is not shown), the choice (null: the primary)
   *  and how to change it (live). */
  monitors?: MonitorInfo[]; monitor?: string | null; onMonitor?: (id: string | null) => void;
  /** Launch at Windows login (null or absent: not offered, the switch is not shown) and how to change it. */
  autostart?: boolean | null; onAutostart?: (on: boolean) => void;
  /** The default harness (new sessions and the Ledge chat). */
  defaultTool?: Tool; onDefaultTool?: (tool: Tool) => void;
  /** The brand colour (null: factory coral) and how to change it (live). */
  accent?: string | null; onAccent?: (hex: string | null) => void;
  /** The About tab: both versions, the latest known release and the update check (absent: no tab). */
  about?: { app: string | null; daemon: DaemonInfo | null; latest: string | null; auto: boolean; checkedAt: number | null; onAuto: (on: boolean) => void; onCheck: () => void };
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
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
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

function AccentRow({ value, onChange }: { value: string | null; onChange?: (hex: string | null) => void }) {
  const { t } = useI18n();
  const shown = parseAccent(value) ?? DEFAULT_ACCENT;
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = (raw: string) => {
    const parsed = parseAccent(raw);
    if (parsed) onChange?.(parsed);
    else setDraft(shown);
  };
  return (
    <div style={{ padding: '12px 0' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{t.settings.accent}</span>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.settings.accentHint}</span>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minWidth: 0 }}>
        <input type="color" aria-label={t.settings.accent} value={shown} disabled={!onChange} onChange={e => onChange?.(e.target.value)}
          style={{ width: 32, height: 28, padding: 0, border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', background: 'transparent', cursor: onChange ? 'pointer' : 'default' }} />
        <input className="ledge-field mono" aria-label={t.settings.accentHex} value={draft} spellCheck={false} disabled={!onChange}
          onChange={e => { setDraft(e.target.value); const parsed = parseAccent(e.target.value); if (parsed) onChange?.(parsed); }}
          onBlur={() => commit(draft)}
          style={{ width: 88, height: 28, boxSizing: 'border-box', padding: '0 8px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 12 }} />
        <Button variant="ghost" size="sm" disabled={!onChange} onClick={() => onChange?.(null)}>{t.settings.accentReset}</Button>
      </div>
    </div>
  );
}

/** The settings sections, one tab each; the last one opened is remembered. */
export const SETTINGS_TABS = ['display', 'machines', 'notifications', 'sounds', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const TAB_KEY = 'ledge.settings.tab';
const isTab = (v: unknown): v is SettingsTab => (SETTINGS_TABS as readonly unknown[]).includes(v);
export const loadSettingsTab = (): SettingsTab => { try { const v = localStorage.getItem(TAB_KEY); return isTab(v) ? v : 'display'; } catch { return 'display'; } };
const saveSettingsTab = (tab: SettingsTab) => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* in-memory only */ } };

/** The Screen group's options: the primary (value `primary`), then the other monitors by their index in the OS order;
 *  a chosen monitor that is not plugged in is one more option, checked, so the choice stays visible. */
export function monitorOptions(monitors: MonitorInfo[], choice: string | null, t: { primary: string; nth: (n: number) => string; missing: string }): Array<{ value: string; label: string }> {
  const opts = monitors.map((m, i) => ({ value: m.primary ? 'primary' : m.id, label: m.primary ? t.primary : t.nth(i + 1) }));
  opts.sort((a, b) => Number(b.value === 'primary') - Number(a.value === 'primary'));
  if (choice !== null && !monitors.some(m => m.id === choice)) opts.push({ value: choice, label: t.missing });
  return opts;
}

/** Preferences inside the same surface; they are the app's own (language, size, theme, colour, do not disturb, motion), not a local copy. */
export function SettingsView(p: SettingsViewProps) {
  const enterDelay = p.enterDelay ?? 120;
  const { t, lang } = useI18n();
  const light = p.theme === 'light';
  const monitors = p.monitors ?? [];
  const choice = p.monitor ?? null;
  const chosen = resolveMonitor(choice, monitors);
  const chosenValue = choice !== null && !monitors.some(m => m.id === choice) ? choice : chosen && !chosen.primary ? chosen.id : 'primary';
  const [storedTab, setTab] = useState<SettingsTab>(loadSettingsTab);
  const fleet = !!(p.machines && p.onMachines);
  const tab: SettingsTab = (storedTab === 'about' && !p.about) || (storedTab === 'machines' && !fleet) ? 'display' : storedTab;
  const chooseTab = (next: SettingsTab) => { setTab(next); saveSettingsTab(next); };
  const tabLabel = { display: t.settings.tabDisplay, machines: t.machines.title, notifications: t.settings.tabNotifications, sounds: t.settings.tabSounds, about: t.settings.tabAbout } as const;
  const about = p.about;
  const tabs = SETTINGS_TABS.filter(v => (v !== 'about' || about) && (v !== 'machines' || fleet));
  const { tabId, panelId } = tabIds('ledge-settings', tab);
  return (
    <div data-layer="settings" data-delay={enterDelay} inert={!p.visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none', transition: transition([['opacity', p.visible ? 'fadeIn' : 'fadeOut', p.visible ? enterDelay : 0]]) }}>
      <DetailHeader title={t.settings.title} onBack={p.onBack} onClose={p.onClose} />
      <div className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
        <div ref={p.contentRef} style={{ display: 'flex', flexDirection: 'column', padding: '12px 17px 12px' }}>
          <Tabs<SettingsTab> id="ledge-settings" label={t.settings.tabs} value={tab} onChange={chooseTab} tabs={tabs.map(v => ({ value: v, label: tabLabel[v] }))} />
          <div role="tabpanel" id={panelId} aria-labelledby={tabId} style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            {tab === 'display' && <>
              {p.autostart != null && p.onAutostart && <Row><Switch label={t.settings.autostart} hint={t.settings.autostartHint} checked={p.autostart} onChange={p.onAutostart} /></Row>}
              <Row><Segmented<Tool> name="ledge-default-tool" label={t.settings.defaultTool} hint={t.settings.defaultToolHint} value={p.defaultTool ?? 'claude'} onChange={p.onDefaultTool} options={TOOLS.map(v => ({ value: v, label: toolName(v) }))} /></Row>
              <Row><Segmented name="ledge-lang" label={t.lang.label} hint={t.lang.hint} value={lang} onChange={p.onLang} options={LANGS.map(l => ({ value: l, label: t.lang[l] }))} /></Row>
              {monitors.length > 0 && (
                <Row><Segmented name="ledge-monitor" label={t.settings.screen} hint={chosen ? t.settings.screenHint(chosen.width, chosen.height) : t.settings.screenHintNone} value={chosenValue}
                  onChange={p.onMonitor ? v => p.onMonitor!(v === 'primary' ? null : v) : undefined}
                  options={monitorOptions(monitors, choice, { primary: t.settings.screenPrimary, nth: t.settings.screenNth, missing: t.settings.screenMissing })} /></Row>
              )}
              <Row><Segmented<IslandPosition> name="ledge-island-position" label={t.settings.islandPosition} hint={t.settings.islandPositionHint} value={p.islandPosition ?? 'center'} onChange={p.onIslandPosition}
                options={ISLAND_POSITIONS.map(v => ({ value: v, label: t.settings.islandPositions[v] }))} /></Row>
              <Row><Switch label={t.settings.discreet} hint={t.settings.discreetHint} checked={p.discreet ?? true} onChange={on => p.onDiscreet?.(on)} /></Row>
              {(['handle', 'panel'] as const).map(target => (
                <Row key={target}><Segmented<UiScale> name={`ledge-${target}-scale`} label={target === 'handle' ? t.settings.islandSize : t.settings.windowSize} hint={target === 'handle' ? t.settings.islandSizeHint : t.settings.windowSizeHint}
                  value={p.scales?.[target] ?? 'auto'} onChange={p.onScale ? s => p.onScale!(target, s) : undefined}
                  options={UI_SCALES.map(s => ({ value: s, label: s === 'auto' ? t.settings.auto(percent(p.autoScales?.[target] ?? 1)) : percent(s), wide: s === 'auto' }))} /></Row>
              ))}
              <Row>
                <button type="button" onClick={p.onToggleTheme} disabled={!p.onToggleTheme} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 0', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
                    <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{light ? t.settings.themeLight : t.settings.themeDark}</span>
                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.settings.themeHint}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Ctrl Alt T</span>
                </button>
              </Row>
              <Row><AccentRow value={p.accent ?? null} onChange={p.onAccent} /></Row>
              <Switch label={t.settings.reduced} hint={t.settings.reducedHint} checked={p.reduced} onChange={p.onReduced} />
              {p.osReduced && !p.reduced && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', padding: '0 0 8px' }}>{t.settings.osReduced}</span>}
            </>}
            {tab === 'machines' && p.machines && p.onMachines && <MachineSettings machines={p.machines} onChange={p.onMachines} onProbe={p.onProbe} onRetry={p.onRetry} />}
            {tab === 'notifications' && <>
              <Row><Switch label={t.settings.dnd} hint={t.settings.dndHint} checked={p.dnd} onChange={on => { if (on !== p.dnd) p.onToggleDnd(); }} /></Row>
              <Segmented<FinishedNotify> name="ledge-finished" label={t.settings.finished} hint={t.settings.finishedHint} value={p.finished} onChange={p.onFinished}
                options={FINISHED_VALUES.map(v => ({ value: v, label: { both: t.settings.finishedBoth, bubble: t.settings.finishedBubble, sound: t.settings.finishedSound, none: t.settings.finishedNone }[v], wide: v === 'both' }))} />
            </>}
            {tab === 'about' && about && (() => {
              const mismatch = !!about.app && !!about.daemon && compareVersions(about.app, about.daemon.version) !== 0;
              const newer = !!about.latest && [about.app, about.daemon?.version].some(v => !!v && compareVersions(about.latest!, v) > 0);
              const col = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, lineHeight: '20px', margin: 0 } as const;
              return <>
                <Row>
                  <div style={{ padding: '12px 0' }}>
                    <div style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{t.settings.versions}</div>
                    <div style={{ marginTop: 3, fontSize: 12, lineHeight: '16px', color: mismatch ? 'var(--warning)' : 'var(--muted-foreground)' }}>{mismatch ? t.settings.versionsMismatch : t.settings.versionsHint}</div>
                    <dl style={{ margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={col}><dt style={{ color: 'var(--muted-foreground)' }}>{t.settings.versionApp}</dt><dd style={{ margin: 0 }}>{about.app ?? t.settings.unknownVersion}</dd></div>
                      <div style={col}><dt style={{ color: 'var(--muted-foreground)' }}>{t.settings.versionDaemon}</dt><dd style={{ margin: 0 }}>{about.daemon ? `${about.daemon.version} · ${t.settings.installKind[about.daemon.install]}` : t.settings.unknownVersion}</dd></div>
                      <div style={col}><dt style={{ color: 'var(--muted-foreground)' }}>{t.settings.versionLatest}</dt><dd style={{ margin: 0, color: newer ? 'var(--sidebar-primary)' : undefined }}>{about.latest ?? t.settings.unknownVersion}</dd></div>
                    </dl>
                  </div>
                </Row>
                <Row><Switch label={t.settings.autoUpdate} hint={t.settings.autoUpdateHint} checked={about.auto} onChange={about.onAuto} /></Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
                    <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{about.checkedAt != null ? t.settings.checked(duration(Date.now() - about.checkedAt, t)) : t.settings.neverChecked}</span>
                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.settings.checkedHint}</span>
                  </span>
                  <Button variant="outline" size="sm" onClick={about.onCheck}>{t.settings.checkNow}</Button>
                </div>
              </>;
            })()}
            {tab === 'sounds' && <>
              <Row><Switch label={t.settings.sounds} hint={t.settings.soundsHint} checked={p.sounds.enabled} onChange={on => p.onSounds({ enabled: on })} /></Row>
              <div data-testid="sound-sections" style={{ opacity: p.sounds.enabled ? 1 : 0.5, transition: transition([['opacity', 'hover']]) }}>
                <Row>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <div style={{ flexGrow: 1 }}><Segmented name="ledge-volume" label={t.settings.volume} hint={t.settings.volumeHint} value={p.sounds.volume} onChange={v => p.onSounds({ volume: v })}
                      options={VOLUMES.map(v => ({ value: v, label: { quiet: t.settings.volumeQuiet, normal: t.settings.volumeNormal, loud: t.settings.volumeLoud }[v] }))} /></div>
                    <Button variant="outline" size="sm" onClick={p.onTestSound}>{t.settings.test}</Button>
                  </div>
                </Row>
                <Row>
                  <fieldset style={{ margin: 0, padding: 0, border: 'none' }}>
                    <legend style={{ padding: '12px 0 4px', fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{t.settings.playWhen}</legend>
                    {CATEGORIES.map(c => (
                      <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={p.sounds.categories[c]} onChange={e => p.onSounds({ categories: { [c]: e.target.checked } })} style={{ margin: 0, width: 16, height: 16, accentColor: 'var(--sidebar-primary)' }} />
                        {t.settings.category[c]}
                      </label>
                    ))}
                  </fieldset>
                </Row>
                <Switch label={t.settings.behind} hint={t.settings.behindHint} checked={p.sounds.onlyWhenTerminalBehind} onChange={on => p.onSounds({ onlyWhenTerminalBehind: on })} />
                <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', padding: '0 0 8px' }}>{t.settings.soundsNote}</span>
              </div>
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
