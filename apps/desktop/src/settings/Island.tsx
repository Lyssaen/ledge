import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import type { IslandPrefs } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { autoScale, UI_SCALES, type UiScale } from '@ledge/ui/scale';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useDnd } from '../notify/prefs';
import { useTheme } from '../shell/theme';
import { Card, Row, Segmented, SwitchRow } from './controls';
import { useIslandScreens, type IslandScreen } from './screens';
import { useIslandSave } from './useIslandSave';
import type { SettingsContext } from './SettingsPage';

type Screen = IslandPrefs['screen'];
type Position = IslandPrefs['position'];
type Shows = IslandPrefs['shows'];
type ScaleChoice = 'auto' | '1' | '1.25' | '1.5' | '2';
const toChoice = (s: UiScale): ScaleChoice => String(s) as ScaleChoice;
const toScale = (c: ScaleChoice): UiScale => (c === 'auto' ? 'auto' : (Number(c) as UiScale));
const POSITIONS: readonly Position[] = ['left', 'center', 'right'];
/** The preview's screens, as wide as the mockup draws them. */
const GLASS: Record<Screen, number> = { primary: 236, second: 176 };
const sizeOf = (s: IslandScreen) => `${s.width} × ${s.height}`;

/** A stored shortcut (`Ctrl Alt Shift Win L`, the names the island reads) as this language shows it (`Ctrl Alt Maj ⊞ L`). */
export const shownKeys = (shortcut: string, names: Record<string, string>): string => shortcut.split(' ').map(k => names[k] ?? k).join(' ');

/** A key press as a stored shortcut: the modifiers in the mockup's order (Ctrl, ⊞, Alt, Shift), then the key, a letter or a digit
 *  by its place on the keyboard (Ctrl Alt E stays E on a layout where it types €). Null for a modifier alone. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.code === 'Space' || e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.metaKey && 'Win', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join(' ');
}

/** Settings › Island (settings.tsx, `island`): what was the island's own settings, now the local daemon's (`island` / `island.set`),
 *  shared with the island that applies them. Hidden, every other control is disabled. « Setting saved » once the daemon's broadcast
 *  holds the change (useIslandSave). */
export function Island({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.island;
  const a = t.settings.appearance;
  const { island, machines, fleet, saved, notify } = ctx;
  const { shown: p, refused, send } = useIslandSave(fleet, island, saved);
  const screens = useIslandScreens();
  const [recording, setRecording] = useState(false);
  const localUp = machines.find(m => m.id === 'local')?.ready === true;
  const off = !p.visible;
  const errorOf = (key: string) => (refused?.key === key ? c.refused[refused.reason] : null);
  const set = (key: string, patch: Partial<IslandPrefs>, what: string) => send(key, { ...p, ...patch }, what);
  const show = (key: keyof Shows, on: boolean, what: string) => set(key, { shows: { ...p.shows, [key]: on } }, what);

  // The screen the island sits on gives Auto its size (as the island reads it: the handle from 1080 px, its windows from 2160).
  const here = (p.screen === 'second' && screens.second) || screens.primary;
  const scaleOptions = (auto: number) => UI_SCALES.map(s => ({ value: toChoice(s), label: s === 'auto' ? a.autoAt(a.percent(auto)) : a.percent(s), wide: s === 'auto' }));
  const scaleLabel = (s: UiScale) => (s === 'auto' ? a.auto : a.percent(s));

  // Recording: the next combination with Ctrl, Alt or ⊞ becomes the shortcut; Escape cancels; a key without them says why. The keys
  // are taken before the app's own (Escape would leave Settings, Ctrl K open the search).
  const latest = { p, set, notify, c };
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      const combo = comboOf(e);
      if (combo === null) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) { latest.notify(latest.c.needsModifier); return; }
      setRecording(false);
      if (combo !== latest.p.shortcut) latest.set('shortcut', { shortcut: combo }, latest.c.shortcutSaved(shownKeys(combo, latest.c.keyNames)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => { if (off) setRecording(false); }, [off]);
  const keys = shownKeys(p.shortcut, c.keyNames);

  return (
    <>
      <div className="set-banner" role="note"><Icon d={ICONS.gear.d} size={16} /><div><strong>{c.bannerTitle}</strong><span>{c.bannerBody}</span></div></div>
      <Card>
        {!localUp ? <div role="status" className="set-well"><span>{t.offline}</span></div>
          : island === undefined && <div role="status" className="set-well"><span>{c.outdated}</span></div>}
        <SwitchRow label={c.show} hint={c.showHint} error={errorOf('visible')} checked={p.visible} onChange={on => set('visible', { visible: on }, on ? c.shown : c.hidden)} />
        <div className="set-row stack"><IslandPreview prefs={p} screens={[['primary', screens.primary], ['second', screens.second]]} paused={ctx.paused} /></div>
        <Row label={c.screen} hint={c.screenHint(sizeOf(here))} error={errorOf('screen')}>
          {describedBy => <Segmented label={c.screen} value={p.screen} disabled={off} describedBy={describedBy} onChange={v => set('screen', { screen: v }, c.screenSaved[v])}
            options={[{ value: 'primary', label: c.screens.primary }, { value: 'second', label: c.screens.second }]} />}
        </Row>
        <Row label={c.position} hint={c.positionHint} error={errorOf('position')}>
          {describedBy => <Segmented label={c.position} value={p.position} disabled={off} describedBy={describedBy} onChange={v => set('position', { position: v }, c.positionSaved(c.positions[v]))}
            options={POSITIONS.map(v => ({ value: v, label: c.positions[v] }))} />}
        </Row>
        <SwitchRow label={c.discreet} hint={c.discreetHint} error={errorOf('discreet')} checked={p.discreet} disabled={off} onChange={on => set('discreet', { discreet: on }, on ? c.discreetOn : c.discreetOff)} />
        <Row label={c.islandScale} hint={c.islandScaleHint} error={errorOf('islandScale')} stack>
          {describedBy => <Segmented label={c.islandScale} value={toChoice(p.islandScale)} disabled={off} describedBy={describedBy} options={scaleOptions(autoScale(here.logicalHeight, 'handle'))}
            onChange={v => { const s = toScale(v); set('islandScale', { islandScale: s }, c.islandScaleSaved(scaleLabel(s))); }} />}
        </Row>
        <Row label={c.panelScale} hint={c.panelScaleHint} error={errorOf('panelScale')} stack>
          {describedBy => <Segmented label={c.panelScale} value={toChoice(p.panelScale)} disabled={off} describedBy={describedBy} options={scaleOptions(autoScale(here.logicalHeight, 'panel'))}
            onChange={v => { const s = toScale(v); set('panelScale', { panelScale: s }, c.panelScaleSaved(scaleLabel(s))); }} />}
        </Row>
      </Card>
      <Card title={c.does} hint={c.doesNote}>
        <SwitchRow label={c.quick} hint={c.quickHint} error={errorOf('quick')} checked={p.shows.quick} disabled={off} onChange={on => show('quick', on, on ? c.quickOn : c.quickOff)} />
        <SwitchRow label={c.finished} hint={c.finishedHint} error={errorOf('finished')} checked={p.shows.finished} disabled={off} onChange={on => show('finished', on, on ? c.finishedOn : c.finishedOff)} />
        <SwitchRow label={c.say} hint={c.sayHint} error={errorOf('say')} checked={p.shows.say} disabled={off} onChange={on => show('say', on, on ? c.sayOn : c.sayOff)} />
        <SwitchRow label={c.helpers} hint={c.helpersHint} error={errorOf('helpers')} checked={p.shows.helpers} disabled={off} onChange={on => show('helpers', on, on ? c.helpersOn : c.helpersOff)} />
        <Row label={c.shortcut} hint={recording ? c.recordingHint : c.shortcutHint} error={errorOf('shortcut')}>
          {describedBy => (
            <button type="button" className={recording ? 'key-recorder recording' : 'key-recorder'} disabled={off} aria-label={c.recorder(keys)} aria-describedby={describedBy}
              onClick={() => setRecording(r => !r)}>
              {recording ? c.press : <Kbd>{keys}</Kbd>}<span>{recording ? c.cancel : c.edit}</span>
            </button>
          )}
        </Row>
      </Card>
    </>
  );
}

/** The mockup's preview (settings.tsx, IslandPreview): the two screens, the island on the chosen one, where it is set, at its size;
 *  « Simulate a maximised window » covers them, and the discreet island turns into a line. The bubble is an agent's sentence: shown
 *  while their words are, and never under Do not disturb. A screen that is not there is not drawn. */
function IslandPreview({ prefs, screens, paused }: { prefs: IslandPrefs; screens: readonly [Screen, IslandScreen | null][]; paused: boolean }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.island;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const [dnd] = useDnd();
  const [covered, setCovered] = useState(false);
  const k = prefs.islandScale === 'auto' ? 1 : prefs.islandScale;
  const caption = !prefs.visible ? c.caption.hidden : dnd ? c.caption.dnd : covered && prefs.discreet ? c.caption.strip : covered ? c.caption.whole : c.caption.rest;
  return (
    <figure className="island-preview" aria-label={c.preview}>
      <div className="preview-desk">
        {screens.map(([id, s]) => {
          if (!s) return null;
          const here = prefs.visible && prefs.screen === id;
          const strip = here && covered && prefs.discreet;
          return (
            <div key={id} className={here ? 'preview-screen here' : 'preview-screen'} style={{ width: GLASS[id] }}>
              <div className="preview-glass">
                {covered && <div className="preview-window" aria-hidden="true"><i /><i /><i /></div>}
                {here && (
                  <div className={`preview-notch pos-${prefs.position}${strip ? ' strip' : ''}`} style={{ '--k': k } as CSSProperties}>
                    {!strip && <><span className="preview-mascot"><ResidentMascot size={12 * k} theme={theme} paused={paused || reduced} /></span><i className="d-approval" /><i className="d-question" /><i className="d-working" /></>}
                  </div>
                )}
                {here && !strip && !dnd && prefs.shows.say && <div className={`preview-bubble pos-${prefs.position}`}>{c.bubble}</div>}
              </div>
              <span className="preview-caption"><strong>{c.screens[id]}</strong> {sizeOf(s)}</span>
            </div>
          );
        })}
      </div>
      <figcaption>
        <span>{caption}</span>
        <Button size="sm" variant="ghost" aria-pressed={covered} disabled={!prefs.visible} onClick={() => setCovered(v => !v)}>{covered ? c.uncover : c.cover}</Button>
      </figcaption>
    </figure>
  );
}
