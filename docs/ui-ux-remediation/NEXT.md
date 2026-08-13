# Next step

**WP-003 — Document-close protection** is **complete**. New, Open PGN, and Reopen now use one
Dialog-backed guard, content changes retain an exported-change count across autosave, save-before-
continue resumes exactly once, and file capability failures are named in a visible notice. The
focused Chromium run passed 14 tests with one configured UX-005 skip; the corresponding 45-case
three-browser container run and the 441-case full container run completed without a reported
failure. Lint, formatting, typecheck, docs, skills, content, chat/store tests, and the production
UI build passed.

Manual validation also passed: the user confirmed Chromium writes to the existing real file handle
before completing a replacement, and Firefox/WebKit show the named download-fallback message when
File System Access is unavailable. No issues were reported.

**Next executable package: WP-015 — Side-panel task order and mobile default.** Run
`pnpm ux:task WP-015` to begin it. WP-004 is now the critical-path successor, but remains blocked
on PD-2. Preserve unrelated dirty-worktree changes throughout.
