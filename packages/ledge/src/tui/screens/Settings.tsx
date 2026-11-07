import { useState } from 'react';
import { Box, Text } from 'ink';
import { resetLong, span, useContextNear, useUsage, type UsageGroup } from '@ledge/fleet';
import { CONTEXT_NEAR_MAX, CONTEXT_NEAR_MIN, USAGE_ALERT_MAX, USAGE_ALERT_MIN, type UsageWindow } from '@ledge/protocol';
import { bars, cursorLabel, useUsageGroups } from '../ui/UsageLine.js';
import { useScreenKeys, useTui } from '../context.js';
import { LANGS } from '../i18n/lang.js';
import { C, THEMES } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { TitledBox } from '../ui/TitledBox.js';

/** The TUI's settings, one per row: ↑ ↓ a row, ← → or space changes it, at once (and saved): the language, the theme (auto
 *  follows the terminal's background), and « Contexte max » (context handover spec §3.2), the local daemon's threshold by
 *  steps of 5 %. */
export function Settings() {
  const tui = useTui();
  const { t, g, lang, setLang, theme, setTheme, background } = tui;
  const near = useContextNear(tui.client);
  const known = tui.client.fleet?.contextNear() !== undefined;
  // « Alerte de limite » (docs/mockups/ledge-harness-usage.html): one threshold, sent to every machine; greyed while no machine
  // gives its limits. Below, every account's windows in full, each model's too (M10).
  const usage = useUsage(tui.client);
  const limits = useUsageGroups();
  const rows = [{ id: 'lang', label: t.settings.language }, { id: 'theme', label: t.settings.theme }, { id: 'context', label: t.settings.context }, { id: 'usage', label: t.usage.setting }] as const;
  const [at, setAt] = useState(0);
  useScreenKeys((input, key) => {
    if (key.upArrow || input === 'k') { setAt(i => (i - 1 + rows.length) % rows.length); return true; }
    if (key.downArrow || input === 'j') { setAt(i => (i + 1) % rows.length); return true; }
    const by = key.rightArrow || input === 'l' || input === ' ' || key.return ? 1 : key.leftArrow || input === 'h' ? -1 : 0;
    if (!by) return false;
    if (rows[at]!.id === 'lang') setLang(LANGS[(LANGS.indexOf(lang) + by + LANGS.length) % LANGS.length]!);
    else if (rows[at]!.id === 'theme') setTheme(THEMES[(THEMES.indexOf(theme) + by + THEMES.length) % THEMES.length]!);
    else if (rows[at]!.id === 'usage') {
      if (!usage.size) return true;
      const pct = Math.min(USAGE_ALERT_MAX * 100, Math.max(USAGE_ALERT_MIN * 100, Math.round(limits.threshold * 100) + by * 5));
      try { tui.client.fleet?.setUsageAlert(pct / 100); tui.toast({ text: t.usage.settingSaved(pct), tone: 'ok' }); }
      catch (e) { tui.toast({ text: (e as Error).message, tone: 'info' }); }
    } else if (known) {
      const pct = Math.min(CONTEXT_NEAR_MAX * 100, Math.max(CONTEXT_NEAR_MIN * 100, Math.round(near * 100) + by * 5));
      try { tui.client.fleet?.setContextNear(pct / 100); tui.toast({ text: t.settings.contextSaved(pct), tone: 'ok' }); }
      catch (e) { tui.toast({ text: (e as Error).message, tone: 'info' }); }
    }
    return true;
  });
  return (
    <Frame crumb={t.settings.title} keys={[['↑ ↓', t.keys.navigate], ['← →', t.keys.change], ['esc', t.keys.back]]}>
      <TitledBox title={t.settings.title} flexGrow={1}>
        {rows.map((r, i) => (
          <Box key={r.id} backgroundColor={i === at ? C.sel : undefined}>
            <Text color={i === at ? C.coral : C.faint}>{i === at ? '▌' : ' '}</Text>
            <Box width={18}><Text color={C.dim}>{r.label}</Text></Box>
            {r.id === 'lang'
              ? <Text>{LANGS.map(l => <Text key={l} color={l === lang ? C.fg : C.dim} bold={l === lang}>{l === lang ? `${g.radioOn} ` : `${g.radioOff} `}{t.lang[l]}{'     '}</Text>)}</Text>
              : r.id === 'theme'
              ? <Text>{THEMES.map(x => <Text key={x} color={x === theme ? C.fg : C.dim} bold={x === theme}>{x === theme ? `${g.radioOn} ` : `${g.radioOff} `}{x === 'auto' && background ? t.settings.themeAuto(background) : t.settings.themes[x]}{'     '}</Text>)}</Text>
              : r.id === 'usage'
              ? <Text><Text color={usage.size ? C.fg : C.faint} bold={!!usage.size}>◂ {Math.round(limits.threshold * 100)} % ▸</Text><Text color={C.faint}>   {usage.size ? t.usage.settingHint : t.usage.settingUnknown}</Text></Text>
              : <Text><Text color={C.fg} bold>◂ {Math.round(near * 100)} % ▸</Text><Text color={C.faint}>   {known ? t.settings.contextHint : t.settings.contextUnknown}</Text></Text>}
          </Box>
        ))}
      </TitledBox>
      {limits.groups.length ? <TitledBox title={t.usage.limits} flexShrink={0}>{limits.groups.map(x => <UsageDetail key={x.key} x={x} o={limits} />)}</TitledBox> : null}
    </Frame>
  );
}

/** One account's limits in full (M10): its name and how old they are, then the 5 hours, the week and each model. */
function UsageDetail({ x, o }: { x: UsageGroup; o: { threshold: number; now: number; label(id: string): string } }) {
  const { t, g, lang } = useTui();
  const u = t.usage;
  const dim = x.status === 'stale' || x.status === 'unreachable';
  const name = `${u.harness[x.harness] ?? x.harness} · ${x.machines.map(o.label).join(' + ')}`;
  const age = x.status === 'loading' ? u.reading : x.status === 'expired' ? u.expiredShort : x.status === 'unreachable' ? u.unreachable
    : x.readAt ? u.read(span(o.now - Date.parse(x.readAt), lang)) : u.never;
  const col = (pct: number) => (dim ? C.faint : pct >= 100 ? C.red : pct >= o.threshold * 100 ? C.yellow : C.dim);
  // Cursor's windows are named « Total · mois », « Cursor », « Autres »: the label column takes the longest.
  const cursor = x.harness === 'cursor';
  const labelW = cursor ? Math.max(9, ...Object.values(u.cursorDetail).map(l => l.length)) : 9;
  const line = (k: string, w: UsageWindow) => (
    <Text key={`${x.key}:${k}`} wrap="truncate">
      <Text color={C.dim}>{`  ${k.padEnd(labelW)}`}</Text><Text color={col(w.pct)}>{bars(w.pct, 10, g.barFull, g.barEmpty)}</Text>
      <Text color={col(w.pct) === C.dim ? C.fg : col(w.pct)}>{` ${String(w.pct).padStart(3)} %`}</Text>
      {w.resetsAt ? <Text color={C.faint}>{`  ${w.pct >= 100 ? u.resumes(resetLong(w.resetsAt, o.now, lang)) : `${g.reset} ${resetLong(w.resetsAt, o.now, lang)}`}`}</Text> : null}
    </Text>
  );
  return (
    <Box flexDirection="column">
      <Text wrap="truncate"><Text color={C.fg}>{name}</Text><Text color={dim || x.status === 'expired' ? C.yellow : C.faint}>{`   ${age}`}</Text></Text>
      {(cursor ? [...x.windows].sort((a, b) => Number(a.kind === 'pool') - Number(b.kind === 'pool') || Number(a.pool === 'other') - Number(b.pool === 'other')) : x.windows).map(w => line(
        cursor ? cursorLabel(u.cursorDetail, w)
          : w.kind === 'five_hour' ? u.five : w.kind === 'seven_day' ? u.week : w.model ?? '', w))}
    </Box>
  );
}
