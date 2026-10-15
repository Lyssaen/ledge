# Final review fixes, lot 4

RED (before the fixes, 6 failures): useThreadRequest "expected undefined to deeply equal ['p1']"; Thread tail "expected +0 to be 1000"; Thread partial fallback saved '{"local:bix":{"open":[],"scroll":0}}'; SplitView "expected spy to be called 1 times, but got 0"; header Folder row missing.
GREEN: pnpm --filter desktop test 162/162 (first run under typecheck load timed out 2 tests, clean rerun passes); pnpm -r typecheck OK.
Playwright not run: port 5299 was in use (pid 1150395). e2e/conversation-header.spec.ts rewritten unconditionally (Stop, Cancel, Stop, "Yes, stop", asserts session.kill id luna) but unexecuted.

1 useThreadRequest keeps last items of the same session.id; Thread never saves a position when not loaded.
2 Thread: unloaded view counts as at end (tail effect runs), no save.
3 overflow-wrap: anywhere on the listed selectors.
4 SplitView selectedId prop; stacked layout scrolls the pane into view on selection change (not on mount).
5 Header: "Dossier"/"Folder" row from s.cwd (omitted if empty); project kept in the duration line.
