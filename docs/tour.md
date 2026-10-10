# Ledge, a tour

Ledge is a handle on the left edge of your Windows screen. Every agent you start from WSL2 with `ledge claude` gets a mascot in it. When an agent needs you, its mascot lights up, a bubble unfolds, and you answer from there. The terminal tab is one click away when you want the whole conversation.

All captures below are the real overlay, in French (its default language, English is one toggle away), running against simulated sessions. Dark theme "Signal" unless noted; the light theme is "Galet".

## The handle

Four sessions, four mascots. Each one wears the colour of its state: red for a permission to give, amber for a question, blue for an agent at work, green for one waiting for your next instruction. A mascot that waits for you breathes.

<p>
  <img src="screens/handle-dark.png" alt="The handle on the left edge, four mascots in dark theme" height="151">
  <img src="screens/handle-light.png" alt="The same handle in light theme" height="151">
</p>

Hovering a mascot tells you who it is and what it waits for.

<img src="screens/handle-tooltip-dark.png" alt="Tooltip: Otto, waits for your approval, pnpm test --filter overlay, click to open" width="504">

**The handle lives.** A working bot hops every 3.6 to 4.4 s, 2 px high in the handle, so you can tell a bot that works from one that waits without opening anything. Under reduced motion the antenna light pulses instead.

## The bubble

When an agent asks something, the bubble unfolds beside the handle for a few seconds with the request and the two answers. "+1 autre" means another ask is queued behind it. Nothing steals your focus: you keep typing wherever you were, and the bubble folds back on its own.

<p>
  <img src="screens/bubble-dark.png" alt="Bubble: Otto waits for your approval, pnpm test --filter overlay, Refuser and Autoriser" width="364">
  <img src="screens/bubble-light.png" alt="The same bubble in light theme" width="364">
</p>

**Finished.** When a bot ends its turn, it grows in the handle and a bubble says "Otto finished · 2m 40s of work · harness-assistant" for 6 s, with OK and Open. A request always comes before a notice. Settings › "When a bot finishes" chooses bubble, sound, both or the handle only.

## The list

Resting the cursor on the screen edge, or pressing `Ctrl+Alt+L` from anywhere, opens the list. One row per session: project, mascot name, tool and age, and a badge for the state. Asks come first, oldest on top with the red bar. The header has do-not-disturb, settings and collapse; the footer shows the shortcut.

<p>
  <img src="screens/list-dark.png" alt="The list of four sessions in dark theme" width="408">
  <img src="screens/list-light.png" alt="The same list in light theme" width="408">
</p>

It scales to a busy day: twelve sessions scroll inside the panel, with the count of asks in the subtitle.

<img src="screens/team-dark.png" alt="Twelve sessions in the list, three asking for you" width="408">

## Answering from Ledge

Opening a row shows the session. A permission request shows the command and where it runs, with Refuser and Autoriser (`N` and `Y` on the keyboard). The daemon types the answer into the agent's terminal and confirms only once the prompt is gone. The terminal preview folds under the card; the field at the bottom sends an instruction to the agent when it is your turn.

<p>
  <img src="screens/session-permission-dark.png" alt="Session: Otto wants to run a command, pnpm test --filter overlay, Refuser and Autoriser" width="448">
  <img src="screens/session-permission-light.png" alt="The same permission screen in light theme" width="448">
</p>

A question from the agent shows its options as cards. Pick one and send; free text is not supported yet for a question, Ledge says so and points you to the terminal.

<img src="screens/session-question-dark.png" alt="Session: which theme to use by default, three options, Envoyer la réponse" width="448">

## Following an agent at work

A working session shows the terminal preview: the last thirty lines of the conversation, kept on the latest line as the agent writes. From here you can interrupt the turn, stop the session, or jump to its terminal tab.

<img src="screens/session-preview-dark.png" alt="Session: Pim at work, the terminal preview shows the agent running the tests" width="448">

A session started with plain `claude`, without the launcher, is still visible through its hooks, in read-only mode.

<img src="screens/session-readonly-dark.png" alt="Session: visible, read only, Otto was started without the Ledge launcher" width="448">

## Keyboard first

`Ctrl+Alt+L` opens the list on the oldest ask with the rows numbered. `J` and `K` move, a digit jumps, `Y` and `N` decide, `Enter` opens, `Escape` goes back then folds. The first three keyboard opens show a coachmark; `?` opens the full list of shortcuts at any time.

<p>
  <img src="screens/keyboard-dark.png" alt="The list opened from the keyboard: numbered rows, inline Autoriser and Refuser, the coachmark" width="408">
  <img src="screens/help-dark.png" alt="Help: every keyboard shortcut" width="408">
</p>

## Settings

Language, the screen the handle sits on, the size of the handle and of the windows (auto or 100 to 200 percent), do-not-disturb, reduced motion, and the theme (`Ctrl+Alt+T`).

<img src="screens/settings-dark.png" alt="Settings: language, screen, handle size, window size, do not disturb, reduced motion, theme" width="408">

**Sounds.** Eight short synthesised cues, one family: asks rise or knock, results fall, your own decisions tick. Settings › Sounds has the switch, the volume with a Test button, one checkbox per category, and "Only when the terminal is behind", which keeps Ledge quiet while Windows Terminal is the front window. Do not disturb silences everything.

## Refreshing these captures

They come from `apps/overlay/e2e/screenshots.spec.ts`, which drives the real app against the fake daemon used by the end-to-end tests:

```sh
LEDGE_SCREENSHOTS=1 pnpm --filter overlay exec playwright test e2e/screenshots.spec.ts
```

Set `LEDGE_CHROMIUM=/path/to/chrome` when the Playwright build pinned by the project is not installed. The web fonts are fetched for real, so it needs network access.
