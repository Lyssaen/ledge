#!/usr/bin/env node
// A scripted stand-in for the Claude Code TUI. Steps are driven by argv:
//   permission <cmd>   print a permission box, wait for "1\n" (accept) or ESC (deny)
//   question           print a question box, wait for a line
//   work <ms>          print a working line, sleep
//   exit <code>        exit with code
// Like the real TUI, an answered dialog is erased (clear screen) before the outcome is printed.
import { stdin, stdout, exit } from 'node:process';
stdin.setRawMode?.(true); stdin.setEncoding('utf8');
const read = () => new Promise(r => stdin.once('data', r));
const say = s => stdout.write(s + '\n');
const clear = () => stdout.write('\x1b[2J\x1b[H');
const steps = process.argv.slice(2);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s === 'permission') {
    const cmd = steps[++i];
    say(`● Bash(${cmd})`); say('  ⎿  Run it');
    say('╭──────────────────────────────────────────╮');
    say('│ Do you want to proceed?                  │');
    say('│ ❯ 1. Yes                                 │');
    say('│   2. Yes, and don\'t ask again            │');
    say('│   3. No, and tell Claude what to do (esc)│');
    say('╰──────────────────────────────────────────╯');
    let buf = '';
    while (true) { const k = await read(); if (k === '\u001b') { clear(); say('✗ denied'); break; } buf += k; if (buf.includes('\r') || buf.includes('\n')) { clear(); say(buf.trim() === '1' ? '✓ accepted' : '? ' + buf.trim()); break; } }
    say('● Running…');
  } else if (s === 'question') {
    say('╭──────────────────────────────────────────╮');
    say('│ Which migration strategy?                │');
    say('│ ❯ 1. Backfill                            │');
    say('│   2. Shadow table                        │');
    say('╰──────────────────────────────────────────╯');
    let buf = ''; while (!buf.includes('\r') && !buf.includes('\n')) buf += await read();
    clear(); say('● You chose: ' + buf.trim());
  } else if (s === 'work') { say('● Working on it…'); await new Promise(r => setTimeout(r, Number(steps[++i]))); }
  else if (s === 'exit') { exit(Number(steps[++i])); }
}
exit(0);
