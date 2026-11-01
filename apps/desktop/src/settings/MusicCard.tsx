import { useEffect, useState, type JSX } from 'react';
import { DEFAULT_MUSIC_PREFS, type IslandPrefs, type MusicPrefs, type NowPlaying } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { isTauri, mediaNow, onNowPlaying } from '../tauri/bridge';
import { Card, Row, Segmented, SwitchRow } from './controls';

const PAUSED = ['always', '5min', 'hide'] as const;
const HOVER = ['controls', 'controls-title'] as const;

/** Settings › Notch › Music. The status line is live only while the switch is on. */
export function MusicCard(p: { music: MusicPrefs; off: boolean; errorOf(key: string): string | null; set(key: string, patch: Partial<IslandPrefs>, what: string): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.island.music;
  const music = p.music ?? DEFAULT_MUSIC_PREFS;
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [heard, setHeard] = useState(false);
  useEffect(() => onNowPlaying(next => { setHeard(true); setNow(next); }), []);
  useEffect(() => { void mediaNow().then(next => { if (next) { setHeard(true); setNow(next); } }); }, []);
  const windows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  const foreign = !isTauri() && !windows && !heard;
  const detected = now
    ? c.detected(now.title, now.artist, now.source)
    : c.nothing;
  const setMusic = (patch: Partial<MusicPrefs>, key: string, what: string) => p.set(key, { music: { ...music, ...patch } }, what);
  return (
    <Card title={c.title} hint={c.hint}>
      <SwitchRow label={c.show} hint={c.showHint} error={p.errorOf('musicEnabled')} checked={music.enabled} disabled={p.off}
        onChange={on => setMusic({ enabled: on }, 'musicEnabled', on ? c.shownOn : c.shownOff)} />
      <Row label={c.paused} hint={c.pausedHint} error={p.errorOf('musicPaused')}>
        {describedBy => <Segmented label={c.paused} value={music.paused} disabled={p.off || !music.enabled} describedBy={describedBy}
          options={PAUSED.map(v => ({ value: v, label: c.pausedOptions[v] }))}
          onChange={v => setMusic({ paused: v }, 'musicPaused', c.pausedSaved(c.pausedOptions[v]))} />}
      </Row>
      <Row label={c.hover} hint={c.hoverHint} error={p.errorOf('musicHover')}>
        {describedBy => <Segmented label={c.hover} value={music.hover} disabled={p.off || !music.enabled} describedBy={describedBy}
          options={HOVER.map(v => ({ value: v, label: c.hoverOptions[v] }))}
          onChange={v => setMusic({ hover: v }, 'musicHover', c.hoverSaved(c.hoverOptions[v]))} />}
      </Row>
      {music.enabled && <div role="status" className="set-well"><span>{foreign ? c.windowsOnly : detected}</span></div>}
    </Card>
  );
}
