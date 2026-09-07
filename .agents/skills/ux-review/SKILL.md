---
name: ux-review
description: Exercise and visually review the chess PWA through real user journeys, including mobile WebKit screenshots and iterative UX fixes. Use for interactive UI review rather than routine regression execution.
---

Read `docs/UX_REVIEW.md` from the repository root. It owns commands and troubleshooting.

Use `pnpm ux:review -- preflight` and `start --workflow <slug>`. The browser lives in the existing
Playwright Docker image; do not install host WebKit libraries or run the browser CLI on the host.
Inspect the initial snapshot and open the actual viewport PNG with an image tool.

Exercise visible controls through `pnpm ux:review -- cli ...`; harness methods are for deterministic
setup and observation only. Await observable completion, inspect structure and images at meaningful
states, and record evidence in the run's `review.md`. Run `check` after asynchronous work.

For authorized fixes, diagnose reproducible friction, edit narrowly, inspect HMR/reload, then `reset`
and replay the same journey and seed. Inspect after-state images. Promote durable behavior to the
existing Playwright fixtures; use `@mobile-webkit` only for device-dependent contracts. Run focused
checks and the authoritative container E2E gate. Stop the owned session and verify cleanup.

Report Linux WebKit emulation accurately. Finish when the requested journey and relevant checks
pass; do not broaden a review into unrelated product changes.
