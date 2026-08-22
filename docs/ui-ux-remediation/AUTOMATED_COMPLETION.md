# Automated completion policy

This policy is authoritative for the UI/UX remediation roadmap, every work package, every
acceptance criterion, and every named gate. Completion requires no developer, reviewer, product
owner, user, or assistive-technology operator to inspect output or make a pass/fail judgment.

## Completion invariant

The only valid completion path is:

```text
implementation -> automated validation -> deterministic pass/fail -> recorded machine result
```

A command exits zero only when every required assertion passes. Missing evidence, unsupported
infrastructure, cross-platform disagreement, an unknown result, and an inconclusive result all fail
closed. Reports and artifacts exist for diagnosis; reading or approving them is never part of the
gate. An LLM may summarize a failure but may not determine completion.

Every acceptance criterion must name an executable assertion. If a criterion uses subjective terms
such as _clear_, _natural_, _recognisable_, _comprehensible_, _not jarring_, or _easy to find_, its
package must do one of the following before implementation:

1. replace the term with an objective observable and threshold;
2. adopt a product decision and test conformance to that decision; or
3. state that the subjective claim is unsupported and remove it from completion scope.

The third outcome is an explicit limitation, not permission to add a manual check.

## AG-3 audit

AG-3 is trying to prove four user-impacting properties of the move tree:

| Intent                                                                               | Deterministic proof                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A keyboard user can enter and operate the tree without traversing every move by Tab. | Playwright on Chromium, Firefox, and WebKit asserts one roving tab stop, the complete arrow-key state machine, activation, focus retention, and unchanged board state before activation.                                                         |
| Browser accessibility trees expose the intended chess structure.                     | Per-engine ARIA snapshots assert `tree`/`treeitem`, variation-depth `aria-level`, `aria-current`, branch ownership, and `aria-expanded` before and after collapse. Chromium CDP AX evidence provides an additional ownership/ignored-node check. |
| Real screen readers convey the tree role, item level, and expanded/collapsed state.  | Guidepup drives real NVDA on Windows and VoiceOver on macOS. The collector slices the utterance log per command; a deterministic matcher requires the scenario's move name plus the platform-specific role/level/state vocabulary.               |
| Traversal does not produce a speech flood.                                           | For each AT-driven traversal command, the verdict asserts a bounded utterance count and rejects any utterance containing non-target fixture moves. The bound and forbidden move set are fixture constants, not reviewer judgment.                |

The planned NVDA/VoiceOver pipeline can therefore produce the final AG-3 verdict. It already
normalizes real utterances into `AtObservation` records and the verdict engine is deterministic and
does not call an LLM. P2 must add the tree scenario and claim matchers. It must also make all
non-pass statuses—including `automation-inconclusive`—exit nonzero and require both NVDA and
VoiceOver observations. The Markdown report is diagnostic only.

AG-3 does **not** claim that the experience is pleasant, idiomatic to every screen-reader user, or
preferred over another chess-navigation model. Those are subjective research questions and cannot
be established defensibly by unattended automation. They are not completion criteria. The actual
project intent—operability, exposed semantics, conveyed state, and bounded verbosity—is retained in
the four assertions above.

## Project-wide replacement rules

| Former manual requirement                                               | Automated replacement                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual review, screenshots, “not jarring,” or side-by-side inspection   | Geometry, overflow, contrast, pixel-diff, screenshot-diff, and transition-discontinuity thresholds. Baselines are changed only with an explicit fixture update whose assertions still pass; no visual approval is required.                                                                                           |
| Physical-device touch, drag, long-press, zoom, or browser-chrome checks | Playwright touch/pointer contexts, reduced viewport/zoom equivalents, visual-viewport instrumentation, pointer-event traces, and three-engine assertions. If exact hardware behavior is essential, a hosted device-lab job must be added; until it exists the project must not claim that hardware-specific behavior. |
| Screen-reader listening                                                 | Real AT automation with per-command logs and deterministic lexical/count/state assertions. Missing AT infrastructure fails the gate.                                                                                                                                                                                  |
| Installed-PWA update check                                              | A deployed test build controlled by automation, service-worker lifecycle instrumentation, build-id assertions before/after reload, and browser/device-lab automation. A local mock alone may test UI states but cannot prove a real deployment update.                                                                |
| Network-provider latency or cancellation feel                           | A controllable delayed provider or protocol stub plus a numeric cancellation/settlement deadline. Live-provider smoke may supplement but never replace the deterministic test.                                                                                                                                        |
| Copy meaning or chess-domain recognisability                            | Canonical protected propositions, required domain tokens, forbidden overclaims, deterministic name derivation/fallback rules, and fixture text assertions. Preference or perceived clarity is not claimed.                                                                                                            |
| User studies, card sorts, findability, or stated preference             | These are product research, not completion validation. The roadmap's documented default becomes the product decision; automation verifies the resulting information architecture, action count, ordering, labels, and journeys.                                                                                       |

## Known limits

- Automation can prove rendered structure, behavior, real AT utterances, timing, and invariant
  preservation. It cannot prove delight, subjective comprehension, preference, or broad usability.
- The current repository can automate NVDA on Windows and VoiceOver on macOS. It does not yet have
  an unattended real-iOS VoiceOver/device-lab runner. Requirements must use the macOS
  VoiceOver/WebKit result plus browser/touch automation, or add such a runner before claiming an
  iOS-specific result.
- Pixel snapshots detect change, not aesthetic quality. Aesthetic preference is outside completion;
  objective token, contrast, spacing, density, and geometry contracts remain inside it.

These limits may motivate later research, but research can never block or approve a package under
this policy.

## Gate recording

Accessibility gates remain named because they group related assertions. Their status is determined
only by the configured command and its machine-readable report. A gate is `resolved` exactly when
the report says `confirmed-pass` for every required scenario and platform and the command exits
zero. No person resolves a gate. Design/product `DV-*` and `PD-*` entries are decisions, not gates;
their documented defaults are authoritative and packages test conformance to them.

Historic manual notes in completed-package evidence are provenance only. They are not required,
cannot satisfy a current assertion, and must not be copied into new completion records.
