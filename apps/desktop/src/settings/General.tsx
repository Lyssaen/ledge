import { useEffect, useState, type JSX } from 'react';
import { Bot } from '@ledge/ui/bots/Bot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { messagesFor, useI18n, type Lang } from '../i18n/lang';
import { LANGS } from '../i18n/messages';
import { spanOf } from '../list/time';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { getAutostart, setAutostart } from '../tauri/bridge';
import { updater, useUpdate, type UpdatePhase } from '../update/store';
import { Card, Row, Segmented, SwitchRow } from './controls';
import type { SettingsContext } from './SettingsPage';
import { TOOLS, useDefaultTool } from './tool';

/** Settings › General (settings.tsx, `general`): the language, start with Windows, the chat's default agent, then the updates. */
export function General({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const g = t.settings.general;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const [tool, setTool] = useDefaultTool();

  // The language: its strings load first; until they do the choice waits, and if they do not, the language stays and the row says so.
  const [switching, setSwitching] = useState(false);
  const [langFailed, setLangFailed] = useState(false);
  const chooseLang = (l: Lang) => {
    if (l === ctx.lang || switching) return;
    setSwitching(true); setLangFailed(false);
    void ctx.setLang(l).then(r => {
      setSwitching(false);
      if (r === 'ok') ctx.saved(messagesFor(l).settings.general.langs[l], l);
      else setLangFailed(true);
    });
  };

  // Start with Windows (DisplayPanel's pattern on origin/feat/desktop): undefined while Windows is asked, null when it is not
  // offered here (browser, dev build). Nothing optimistic: the switch shows what Windows reports, and is held while it answers.
  const [autostart, setAuto] = useState<boolean | null | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  const [autostartFailed, setAutostartFailed] = useState(false);
  useEffect(() => { let live = true; void getAutostart().then(v => { if (live) setAuto(v); }); return () => { live = false; }; }, []);
  const chooseAutostart = (on: boolean) => {
    setWriting(true); setAutostartFailed(false);
    void setAutostart(on).then(v => {
      setWriting(false);
      if (v !== null) setAuto(v);
      if (v === on) ctx.saved(on ? g.autostart : g.autostartOff);
      else setAutostartFailed(true);
    });
  };

  return (
    <>
      <Card>
        <Row label={g.lang} hint={g.langHint} error={langFailed ? g.langFailed : null}>
          <Segmented label={g.lang} value={ctx.lang} disabled={switching} onChange={chooseLang} options={LANGS.map(l => ({ value: l, label: g.langs[l] }))} />
        </Row>
        <SwitchRow label={g.autostart} hint={autostart === null ? g.autostartMissing : g.autostartHint} error={autostartFailed ? g.autostartFailed : null}
          checked={autostart === true} disabled={autostart == null || writing} onChange={chooseAutostart} />
        <Row label={g.tool} hint={g.toolHint} stack>
          <Segmented label={g.tool} value={tool} onChange={v => { setTool(v); ctx.saved(g.toolSaved(t.launch.tools[v][0])); }}
            options={TOOLS.map(id => ({
              value: id,
              label: <><span aria-hidden="true" style={{ display: 'inline-flex' }}><Bot tool={id} state={tool === id ? 'working' : 'idle'} pose={1} size={20} theme={theme} seed={'set-' + id} paused={ctx.paused} reducedMotion={reduced} /></span>{t.launch.tools[id][0]}</>
            }))} />
        </Row>
      </Card>
      <UpdatesCard saved={ctx.saved} />
    </>
  );
}

const phaseHint = (p: UpdatePhase, c: ReturnType<typeof useI18n>['t']['settings']['updates']): string =>
  p.kind === 'available' ? c.phase.available(p.version)
  : p.kind === 'installing' ? c.phase.installing(p.version)
  : p.kind === 'failed' ? (p.during === 'check' ? c.phase.failedCheck : c.phase.failedInstall)
  : c.phase[p.kind];

/** The app's updates (`useUpdate`): the version line says where the updater is; the automatic check is a switch; « Check » asks
 *  now; « Install » shows only while a version waits (or its install failed), and nothing installs without that click.
 *  Settings › About shows the same card. */
export function UpdatesCard({ saved }: { saved(what: string): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.updates;
  const { phase, auto, checkedAt, app } = useUpdate();
  // « Checked 3 min ago » stays true while the page is open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => { setNow(Date.now()); }, [checkedAt]);
  const checking = phase.kind === 'checking';
  const installing = phase.kind === 'installing';
  const installable = phase.kind === 'available' || (phase.kind === 'failed' && phase.during === 'install');
  const span = checkedAt === null ? null : spanOf(now - checkedAt);
  const checkedLabel = checking ? c.checking : span === null ? c.never : span === 'now' ? c.checkedNow : c.checkedAgo(`${span.n} ${t.list.when.units[span.unit]}`);

  return (
    <Card title={c.title}>
      <Row label={c.version(app)} hint={phaseHint(phase, c)}>
        {phase.kind === 'current' && <span className="set-tag ok"><Icon d={ICONS.check.d} size={12} />{c.upToDate}</span>}
        {installing && <span className="set-tag">{c.installingTag(phase.percent)}</span>}
        {installable && <Button size="sm" variant="primary" onClick={() => void updater.install()}>{phase.kind === 'failed' ? c.retry : c.install}</Button>}
      </Row>
      <SwitchRow label={c.auto} hint={c.autoHint} checked={auto} onChange={on => { updater.setAuto(on); saved(on ? c.autoOn : c.autoOff); }} />
      <Row label={checkedLabel} hint={c.source}>
        <Button size="sm" variant="outline" disabled={checking || installing} onClick={() => void updater.check()}>
          <span className={checking ? 'ledge-spin' : undefined} style={{ display: 'inline-flex' }}><Icon d={ICONS.refresh.d} size={14} /></span>{c.check}
        </Button>
      </Row>
    </Card>
  );
}
