import { useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenKeys, useTui } from '../context.js';
import { LANGS } from '../i18n/lang.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { TitledBox } from '../ui/TitledBox.js';

/** The TUI's settings, one per row: ↑ ↓ a row, ← → or space changes it, at once (and saved). The language for now. */
export function Settings() {
  const { t, g, lang, setLang } = useTui();
  const rows = [{ id: 'lang', label: t.settings.language }] as const;
  const [at, setAt] = useState(0);
  useScreenKeys((input, key) => {
    if (key.upArrow || input === 'k') { setAt(i => (i - 1 + rows.length) % rows.length); return true; }
    if (key.downArrow || input === 'j') { setAt(i => (i + 1) % rows.length); return true; }
    const by = key.rightArrow || input === 'l' || input === ' ' || key.return ? 1 : key.leftArrow || input === 'h' ? -1 : 0;
    if (!by) return false;
    if (rows[at]!.id === 'lang') setLang(LANGS[(LANGS.indexOf(lang) + by + LANGS.length) % LANGS.length]!);
    return true;
  });
  return (
    <Frame crumb={t.settings.title} keys={[['↑ ↓', t.keys.navigate], ['← →', t.keys.change], ['esc', t.keys.back]]}>
      <TitledBox title={t.settings.title} flexGrow={1}>
        {rows.map((r, i) => (
          <Box key={r.id} backgroundColor={i === at ? C.sel : undefined}>
            <Text color={i === at ? C.coral : C.faint}>{i === at ? '▌' : ' '}</Text>
            <Box width={16}><Text color={C.dim}>{r.label}</Text></Box>
            <Text>{LANGS.map(l => <Text key={l} color={l === lang ? C.fg : C.dim} bold={l === lang}>{l === lang ? `${g.radioOn} ` : `${g.radioOff} `}{t.lang[l]}{'     '}</Text>)}</Text>
          </Box>
        ))}
      </TitledBox>
    </Frame>
  );
}
