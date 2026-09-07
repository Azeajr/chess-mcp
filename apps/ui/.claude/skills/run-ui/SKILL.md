---
name: run-ui
description: Start and interactively inspect the chess PWA, capture mobile screenshots, and review panels such as Strategic Fit, Gaps, Connect, or Shorten through visible controls.
---

From the repository root, read `docs/UX_REVIEW.md` and use its canonical `pnpm ux:review` controller.
It runs the repo-local Playwright CLI in the existing Docker image with headless WebKit and the
`iPhone 13 Mini` descriptor. Do not install host browser libraries or use the retired canned drivers.

Run preflight/start, inspect the snapshot and actual viewport PNG, exercise visible controls, and
check runtime/network faults. Await observable completion. Use the harness only for setup and
observation. After authorized source edits, reset/replay the same seed and inspect corresponding
after-state images. Record evidence, promote durable assertions through the existing E2E fixtures,
run the authoritative container gate, and stop the owned session. The guide owns details and recovery.
