# AG-3 / WP-011 sequencing decision

**Date:** 2026-08-12

**Decision:** Allow WP-011 implementation to begin after DV-2 is resolved. Treat AG-3 as the
validation and completion gate for WP-011, rather than as a prerequisite that blocks its start.

**Reason:** AG-3 requires automated move-tree semantics and NVDA/VoiceOver review of the actual
move tree. The current production `MoveTree` is click-only, so AG-3 cannot be honestly completed
before WP-011 implements the semantics it evaluates. Keeping AG-3 as a start blocker creates a
circular dependency.

**Required sequence:**

1. Implement WP-011 using the resolved DV-2 model: `→` enters a variation, `←` returns to the
   parent, and `↑`/`↓` move among siblings.
2. Run the automated AG-3 evidence: one page-level tab stop, `aria-current`, `aria-expanded`, and
   keyboard reachability/traversal checks.
3. Perform and record the required NVDA and VoiceOver move-tree validation, plus the real-phone
   touch pass.
4. Resolve AG-3 and only then mark WP-011 complete.

**Scope:** Documentation and execution metadata only. No production code is changed by this
decision.

## Execution status — 2026-08-12

WP-011's automated AG-3 evidence is complete. The version-matched Playwright 1.61.0 container ran
`core-keyboard.spec.ts` sequentially across Chromium, Firefox, and WebKit: 39 tests passed and the
three configured UX-003 board-test cases skipped. The suite verifies the single roving Tab stop,
DV-2 arrow traversal, Enter-only navigation, `aria-current`, `aria-expanded`, compact/coarse-pointer
targets, density, DOM validity, and scoped accessibility.

AG-3 remains unresolved and WP-011 remains in progress. NVDA on Windows, VoiceOver on macOS/iOS,
and a real-phone row-activation pass are still required. They were unavailable in this Linux
execution, and no synthetic or headless proxy is being recorded as manual evidence.
