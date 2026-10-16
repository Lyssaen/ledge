import { useEffect, useState } from 'react';
import { DEFAULT_ACCENT, parseAccent } from '@ledge/ui/accent';
import { UI_SCALES, type UiScale } from '@ledge/ui/scale';
import type { Tool } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { LANGS, type Lang } from '../i18n/messages';
import { loadTool, saveTool, TOOLS } from '../launch/form';
import { TOOL_NAMES } from '../shell/Person';
import { setAccent, setTheme, THEMES, useAccent, useTheme, type Theme } from '../shell/theme';
import { useMotionPreferences } from '../motionPreferences';
import { getAutostart, setAutostart } from '../tauri/bridge';
import { loadUiScale, saveUiScale } from './scale';
import { SelectRow, Toggle } from './controls';

const scaleLabel = (s: UiScale, auto: string) => (s === 'auto' ? auto : `${Math.round(s * 100)} %`);

/** Settings › Display (spec §9.4; decisions 8, 9, 10): every choice applies at once and is kept. */
export function DisplayPanel({ lang, onLang }: { lang: Lang; onLang(lang: Lang): void }) {
  const { t } = useI18n();
  const c = t.settings.display;
  const theme = useTheme();
  const motion = useMotionPreferences();
  const [tool, setTool] = useState<Tool>(loadTool);
  const [scale, setScale] = useState<UiScale>(loadUiScale);
  // undefined while asking Windows; null when launch at login is not offered (browser, dev build).
  const [autostart, setAuto] = useState<boolean | null | undefined>(undefined);
  // A change Windows did not make (`setAutostart` answers null): said, the previous state kept, a retry possible.
  const [autostartFailed, setAutostartFailed] = useState(false);
  useEffect(() => { let live = true; void getAutostart().then(v => { if (live) setAuto(v); }); return () => { live = false; }; }, []);

  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.autostart} hint={autostart === null ? c.autostartMissing : c.autostartHint} checked={autostart === true} disabled={autostart == null}
        error={autostartFailed ? c.autostartFailed : undefined}
        onChange={on => {
          const before = autostart; setAuto(on);
          void setAutostart(on).then(v => { setAutostartFailed(v === null); setAuto(v ?? before); });
        }} />
      <SelectRow label={c.tool} hint={c.toolHint} value={tool} options={TOOLS.map(v => [v, TOOL_NAMES[v]] as const)}
        onChange={v => { setTool(v); saveTool(v); }} />
      <SelectRow label={c.lang} hint={c.langHint} value={lang} options={LANGS.map(l => [l, c.langs[l]] as const)} onChange={onLang} />
      <SelectRow label={c.scale} hint={c.scaleHint} value={String(scale)} options={UI_SCALES.map(s => [String(s), scaleLabel(s, c.auto)] as const)}
        onChange={v => { const s = (v === 'auto' ? 'auto' : Number(v)) as UiScale; setScale(s); void saveUiScale(s); }} />
      <SelectRow label={c.theme} hint={c.themeHint} value={theme} options={THEMES.map(v => [v, c.themes[v]] as const)} onChange={(v: Theme) => setTheme(v)} />
      <AccentRow />
      <Toggle label={c.reduced} hint={c.reducedHint} checked={motion.app} onChange={on => motion.setReduced(on)} />
    </>
  );
}

/** The accent: the colour picker and the hex field both apply a valid #rrggbb at once; Coral removes `desktop.accent`. */
function AccentRow() {
  const { t } = useI18n();
  const c = t.settings.display;
  const accent = useAccent();
  const [draft, setDraft] = useState(accent ?? DEFAULT_ACCENT);
  const [invalid, setInvalid] = useState(false);
  const apply = (v: string) => {
    setDraft(v);
    const ok = parseAccent(v);
    if (ok) { setInvalid(false); setAccent(ok); }
  };
  return (
    <div className="setting-row">
      <span><strong>{c.accent}</strong><small>{c.accentHint}</small>{invalid && <small className="setting-error" role="alert">{c.accentInvalid}</small>}</span>
      <div className="accent-fields">
        <input type="color" aria-label={c.accent} value={parseAccent(draft) ?? accent ?? DEFAULT_ACCENT} onChange={e => apply(e.target.value)} />
        <input type="text" aria-label={c.hex} value={draft} maxLength={7} spellCheck={false} aria-invalid={invalid || undefined}
          onChange={e => apply(e.target.value)} onBlur={() => setInvalid(parseAccent(draft) === null)} />
        <button type="button" className="settings-button" onClick={() => { setAccent(null); setDraft(DEFAULT_ACCENT); setInvalid(false); }}>{c.coral}</button>
      </div>
    </div>
  );
}
