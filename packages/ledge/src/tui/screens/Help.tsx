import { Box, Text } from 'ink';
import { useTui } from '../context.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Every key, screen by screen. */
export function Help() {
  const { t } = useTui();
  const k = t.keys;
  const groups: Array<[string, Array<[string, string]>]> = [
    [t.help.global, [['1…5', t.help.screens], ['/', k.ask], ['+', k.launch], [',', k.settings], ['?', k.help], ['esc', k.back], ['q', k.quit]]],
    [t.help.overview, [['j k ↑ ↓', k.navigate], ['tab', k.next], ['↵', k.open], ['y n A', k.answer], ['1…9', k.answer], ['r', t.overview.denyWithNote], ['a', k.attach], ['i', k.interrupt]]],
    [t.help.session, [['y n A 1…9', k.answer], ['r ↵', k.write], ['j k PgUp PgDn', k.scroll], [t.keys.space, k.unfold], ['d', k.diffs], ['t', k.terminal], ['a', k.attach], ['m', k.model], ['i', k.interrupt]]],
    [t.help.ask, [['↵', k.send], ['tab', k.nextCard], ['ctrl+n', k.newChat], ['ctrl+c', k.stopAnswer]]],
    [t.help.launch, [['tab ↑ ↓', k.nextField], ['← →', k.choose], [t.keys.space, k.tick], ['ctrl+r', t.keys.redraw], ['ctrl+s', k.start], ['esc', k.cancel]]],
    [t.help.settings, [['↑ ↓', k.navigate], ['← →', k.change]]]
  ];
  return (
    <Frame crumb={t.help.title} keys={[['esc', k.back]]}>
      <TitledBox title={t.help.title} flexGrow={1}>
        <Box flexWrap="wrap" columnGap={4}>
          {groups.map(([title, keys]) => (
            <Box key={title} flexDirection="column" width={40} marginBottom={1}>
              <Text color={C.coral} bold>{title}</Text>
              {keys.map(([key, label]) => <Text key={key + label} wrap="truncate"><Text color={C.fg}>{key.padEnd(16)}</Text><Text color={C.dim}>{label}</Text></Text>)}
            </Box>
          ))}
        </Box>
      </TitledBox>
    </Frame>
  );
}
