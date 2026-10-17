import { useEffect, useRef, useState, type JSX } from 'react';
import { DEFAULT_ACCENT, parseAccent } from '@ledge/ui/accent';
import { Bot } from '@ledge/ui/bots/Bot';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { UI_SCALES, type UiScale } from '@ledge/ui/scale';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { setAccent, setTheme, useAccent, useTheme, type Theme } from '../shell/theme';
import { Card, Row, Segmented, SwitchRow } from './controls';
import { appliedUiScale, loadUiScale, saveUiScale, zoomsNatively } from './scale';
import { useEscapeLayer } from './escape';
import type { SettingsContext } from './SettingsPage';

const THEME_CARDS: readonly Theme[] = ['light', 'dark'];
type ScaleChoice = 'auto' | '1' | '1.25' | '1.5' | '2';
const toChoice = (s: UiScale): ScaleChoice => String(s) as ScaleChoice;
const toScale = (c: ScaleChoice): UiScale => (c === 'auto' ? 'auto' : (Number(c) as UiScale));

/** Settings › Appearance (settings.tsx, `appearance`): the theme's two cards, Ledge's color, the interface scale, reduced motion.
 *  Each accepted change says « Setting saved » once. */
export function Appearance({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const a = t.settings.appearance;
  const theme = useTheme();
  const motion = useMotionPreferences();
  const { saved } = ctx;

  // The scale: kept and applied by saveUiScale, which answers the factor the WebView took; « Auto » shows the one it resolved to.
  const [scale, setScale] = useState<UiScale>(loadUiScale);
  const [autoFactor, setAutoFactor] = useState<number | null>(() => (loadUiScale() === 'auto' ? appliedUiScale() : null));
  // Only the last choice's answer counts: an earlier one that resolves late neither says « saved » nor sets Auto's factor.
  const lastChoice = useRef(0);
  // In the app a null factor is the WebView's refusal: said beside the scale, not « saved ». The browser has no zoom (null is all there is).
  const [scaleFailed, setScaleFailed] = useState(false);
  const chooseScale = (c: ScaleChoice) => {
    const s = toScale(c);
    const turn = ++lastChoice.current;
    setScale(s);
    void saveUiScale(s).then(factor => {
      if (turn !== lastChoice.current) return;
      if (factor === null && zoomsNatively()) { setScaleFailed(true); return; }
      setScaleFailed(false);
      if (s === 'auto' && factor !== null) setAutoFactor(factor);
      saved(a.scaleSaved(s === 'auto' ? a.auto : a.percent(s)));
    });
  };

  return (
    <Card>
      <Row label={a.theme} hint={a.themeHint} stack>
        <div className="theme-picks" role="radiogroup" aria-label={a.theme}>
          {THEME_CARDS.map(th => {
            const [name, material] = a.themes[th];
            return (
              <label key={th} className={theme === th ? 'theme-pick on' : 'theme-pick'} data-preview={th}>
                <input type="radio" name="theme" checked={theme === th} onChange={() => { setTheme(th); saved(a.themeSaved[th]); }} />
                <span className="theme-swatch" aria-hidden="true"><Bot tool="claude" state="working" pose={1} size={34} theme={th} seed={'theme-' + th} paused={ctx.paused} reducedMotion={motion.reduced} /></span>
                <span><strong>{name}</strong><small>{material}</small></span>
              </label>
            );
          })}
        </div>
      </Row>
      <AccentRow ctx={ctx} />
      <Row label={a.scale} hint={a.scaleHint} error={scaleFailed ? a.scaleFailed : null} stack>
        <Segmented label={a.scale} value={toChoice(scale)} onChange={chooseScale}
          options={UI_SCALES.map(s => ({ value: toChoice(s), label: s === 'auto' ? (autoFactor === null ? a.auto : a.autoAt(a.percent(autoFactor))) : a.percent(s), wide: s === 'auto' }))} />
      </Row>
      <SwitchRow label={a.reduced} hint={a.reducedHint} checked={motion.app} onChange={on => { motion.setReduced(on); saved(on ? a.reduced : a.reducedOff); }} />
    </Card>
  );
}

/** Ledge's color (AccentRow on origin/feat/desktop): the picker, and the hex field checked when it is left (or on Enter); an
 *  invalid value is said and nothing is kept. Coral goes back to the factory color (`setAccent(null)`). The mockup's six
 *  proposed colors are not built. */
function AccentRow({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const a = t.settings.appearance;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const accent = useAccent();
  const [draft, setDraft] = useState(accent ?? DEFAULT_ACCENT);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(accent ?? DEFAULT_ACCENT); }, [accent]);

  const commit = (v: string) => {
    const ok = parseAccent(v);
    if (!ok) { setInvalid(true); return; }
    setInvalid(false); setDraft(ok);
    if (ok === (accent ?? DEFAULT_ACCENT)) return;
    setAccent(ok === DEFAULT_ACCENT ? null : ok);
    ctx.saved(a.accentSaved(ok));
  };
  // Escape while the field differs from the stored color (being typed, or invalid): the stored color comes back, nothing is kept.
  useEscapeLayer(() => {
    const stored = accent ?? DEFAULT_ACCENT;
    if (draft === stored && !invalid) return false;
    setDraft(stored); setInvalid(false);
    return true;
  });
  const coral = () => {
    setDraft(DEFAULT_ACCENT); setInvalid(false);
    if (accent === null) return;
    setAccent(null);
    ctx.saved(a.coralSaved);
  };

  // The picker commits on its native `change` (once the color is picked), not on each `input` while it moves: one change, one notice.
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => latest.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  return (
    <Row label={a.accent} hint={a.accentHint} error={invalid ? a.accentInvalid : null} stack>
      <div className="accent-row">
        <input ref={picker} type="color" aria-label={a.picker} value={parseAccent(draft) ?? accent ?? DEFAULT_ACCENT} onChange={e => { setDraft(e.target.value); setInvalid(false); }} />
        <input className="mono set-input hex" aria-label={a.hex} value={draft} maxLength={7} spellCheck={false} aria-invalid={invalid || undefined}
          onChange={e => { setDraft(e.target.value); setInvalid(false); }} onBlur={() => commit(draft)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(draft); } }} />
        <Button size="sm" variant="ghost" disabled={accent === null && draft === DEFAULT_ACCENT} onClick={coral}>{a.coral}</Button>
      </div>
      <div className="accent-sample" aria-hidden="true">
        <Button size="sm" variant="primary" tabIndex={-1}>{a.sample}</Button><span className="side-count">3</span>
        <ResidentMascot size={28} theme={theme} paused={ctx.paused || reduced} /><span className="set-hint">{a.sampleHint}</span>
      </div>
    </Row>
  );
}
