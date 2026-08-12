# Next step

**WP-011 — InteractiveRow and MoveButton** is implemented and remains **in progress**. Its
automated AG-3 evidence passed: `core-keyboard.spec.ts` passed 39 tests across Chromium, Firefox,
and WebKit, with only the three configured UX-003 board-test skips.

Do not mark WP-011 complete or start its dependents (**WP-015**, **WP-022**, and **WP-029**) yet.
AG-3 remains unresolved until the following real-device/manual evidence is recorded:

- NVDA on Windows announces and traverses the implemented move tree correctly.
- VoiceOver on macOS or iOS announces and traverses the implemented move tree correctly.
- A real phone confirms row activation and touch targets.

Those environments were unavailable for this execution, and no proxy validation was substituted.
The full six-worker container suite also has unrelated WebKit resource-timeout failures; the WP-011
keyboard suite passed unchanged in an isolated one-worker WebKit retry. `pnpm lint` and
`pnpm docs:check` retain pre-existing unrelated failures recorded in `state.json`.

After manual evidence is available: resolve AG-3, mark WP-011 complete, run `pnpm ux:plan-check`,
verify `pnpm ux:task WP-011` rejects it as complete, then derive the next handoff from the live
manifest and state. Preserve unrelated dirty-worktree changes throughout.
