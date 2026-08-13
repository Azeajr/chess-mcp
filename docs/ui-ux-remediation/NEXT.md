# Next step

**WP-007 — Dialog focus and escape behavior** is **complete**. Its automated dialog contract and
Strategic Fit accessibility evidence passed across Chromium, Firefox, and WebKit (33 focused
tests), and its reviewed move-tree regression suite passed 39 active tests across all three
browsers with three configured UX-003 board-test skips.

AG-1 also passed. VoiceOver on iPhone 13 mini (iOS 26.6, Safari) and NVDA 2026.1.1 on Windows 11
Enterprise 23H2 (Chrome 151.0.7922.137) each confirmed that Settings, Promotion, and Colour picker
announce their name and dialog role, keep the background unreachable by virtual cursor, and return
focus audibly on close.

**Next executable package: WP-003 — Unsaved-work guard.** WP-015 is also ready, but WP-003 is
first in the live manifest order. Run `pnpm ux:task WP-003` to begin it. `pnpm lint` and
`pnpm docs:check` retain the unrelated pre-existing failures documented in `state.json`.
Preserve unrelated dirty-worktree changes throughout.
