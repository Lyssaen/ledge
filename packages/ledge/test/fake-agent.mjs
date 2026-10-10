#!/usr/bin/env node
// A scripted stand-in for the Claude Code 2.x TUI. Steps are driven by argv:
//   permission <cmd>   draw a Bash permission dialog; a digit picks that option at once, ESC denies
//   question           draw a question dialog; a digit picks that option at once, ESC cancels,
//                      other text is collected until Enter
//   work <ms>          print a working line, sleep
//   exit <code>        exit with code
// Like the real TUI, an answered dialog is erased (clear screen) before the outcome is printed.
import { stdin, stdout, exit } from 'node:process';
stdin.setRawMode?.(true); stdin.setEncoding('utf8');
const read = () => new Promise(r => stdin.once('data', r));
const say = s => stdout.write(s + '\n');
const clear = () => stdout.write('\x1b[2J\x1b[H');
const RULE = '─'.repeat(60), DASHED = '╌'.repeat(60);
const steps = process.argv.slice(2);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s === 'permission') {
    const cmd = steps[++i];
    say(`● Bash(${cmd})`); say('');
    say(RULE); say(' Bash command'); say(' Run it'); say(DASHED); say(` ${cmd}`); say(DASHED);
    say(' Do you want to proceed?');
    say(' ❯ 1. Yes');
    say('   2. Yes, and don\'t ask again for this command');
    say('   3. No');
    say(''); say(' Esc to cancel · Tab to amend');
    while (true) {
      const k = await read();
      if (k === '\u001b') { clear(); say('✗ denied'); break; }
      if (/^[1-3]$/.test(k)) { clear(); say(k === '3' ? '✗ denied' : '✓ accepted ' + k); break; }
    }
    say('● Running…');
  } else if (s === 'question') {
    say(RULE); say(' ☐ Strategy'); say('');
    say('Which migration strategy?'); say('');
    say('❯ 1. Backfill'); say('     Fill the new column in place.');
    say('  2. Shadow table'); say('     Copy into a new table and swap.');
    say('  3. Type something.');
    say(''); say('Enter to select · ↑/↓ to navigate · Esc to cancel');
    let buf = '';
    while (true) {
      const k = await read();
      if (k === '\u001b') { clear(); say('● Cancelled'); break; }
      if (buf === '' && /^[1-3]$/.test(k)) { clear(); say('● You chose: ' + k); break; }
      buf += k;
      if (buf.includes('\r') || buf.includes('\n')) { clear(); say('● You typed: ' + buf.trim()); break; }
    }
  } else if (s === 'work') { say('● Working on it…'); await new Promise(r => setTimeout(r, Number(steps[++i]))); }
  else if (s === 'exit') { exit(Number(steps[++i])); }
}
exit(0);
