# Strategic Fit: honesty and preference remediation

Status: implemented · Scope: `packages/chess-tools/src/strategic-fit`, `apps/ui/src`

Seven defects found during the 2026-09-09 UX review of the Strategic Fit workflow
(runs `a076fc94` White, `16c7d869` / `ce09c37b` Black under `.ux-review/chess-ux/`).
Every displayed count was verified to reproduce exactly from the report, and every
transposition claim holds. The defects are in what the report _concludes_ from thin
evidence, and in controls that promise more than they deliver.

Delete this document once the work ships and the behaviour is described in
`docs/PWA_PRODUCT.md`.

## D1 — Workload imputes zero burden for unmeasured lines

`unadjustedWorkload` (`metrics.ts:965`) sums `routeWeight × burden`. `burdenByRoute`
(`metrics.ts:563`) only records routes named by a finding, and an `uncertain` finding
carries `learning_burden: 0`. A branch too short to classify therefore votes "no
burden" rather than "unknown".

White: 70.2% of expected route weight sits at zero burden, score ≈ 0.179 < 1/3 →
`workload: "low"` → headline _"Your repertoire mostly returns to familiar plans"_,
while the same report says `strategic_family_count: 0` and `strategic_entropy:
unavailable`. Black has _lower_ concept burden (4.653 vs 4.719) but only 21%
zero-burden weight → 0.513 → `"moderate"`. Shorter repertoire reads as more coherent.

`concept_reuse` already refuses this and says so in its own reason string
("missing evidence is not counted as zero"). Workload contradicts it.

**Fix.** Renormalise over evidence-bearing weight only, and gate on coverage:

- Track `measuredWeight` — route weight whose burden came from a finding with
  comparable evidence (`classification !== "uncertain" && !== "data-quality-issue"`).
- `workloadScore = weightedBurden / measuredWeight` when `measuredWeight > 0`.
- Emit `workload: "unavailable"` when `measuredWeight / totalWeight` is below
  `STRATEGIC_WORKLOAD_MIN_COVERAGE = 1/3`.
- Carry the same reason-string convention as `concept_reuse` so the two agree.

`"unavailable"` is already a legal value (`analyze.ts:487`) and the UI already has copy
for it (`StrategicAssessment.tsx:20`), so no new states are introduced.

## D2 — Headline is decoupled from the number beneath it

`workloadHeadline` (`StrategicAssessment.tsx:16-21`) picks the h2 from
`summary.workload` alone; the sentence under it reports `concept_reuse`. White 85%
reuse reads "mostly returns to familiar plans"; Black 92% reads "mixes several kinds
of positions".

**Fix.** D1 removes the contradiction at source. Additionally, when
`concept_reuse.state === "partial"`, the coverage line must lead rather than trail, so
the qualifier is read before the claim.

## D3 — Idle copy hardcoded to one profile's framing

`RegionState.tsx:16` (`REGION_COPY.overview`, consumed at
`StrategicFitWorkspace.tsx:505`): _"Run the review to see whether your repertoire
returns to familiar plans."_ Static for all four profiles, including Versatile, whose
goal is the opposite.

**Fix.** Make it profile-neutral: _"Run the review to see how your lines compare to
one another."_

## D4 — `opening_scope` emits dangling ECO fragments

`openingScope` (`analyze.ts:1042-1045`) returns `taxonomy.path.at(-1)?.label`.
`classifyOpeningName` (`taxonomy.ts:121-136`) splits an ECO name on `:` and `,`, so
_"English Opening: King's English Variation, Four Knights Variation, Fianchetto Line,
with Nb6"_ yields the leaf **"with Nb6"**. That renders on the only "Review this
choice" card in the Black report as `with Nb6 · 5 related repertoire routes`.

The same rule orphans generic leaves — "Main Line", "Short Variation",
"Endgame Variation", "Modern Variation" — which name no opening on their own.

**Fix.** Qualify the scope:

- Drop trailing variation labels that are bare qualifiers (first character not
  uppercase, e.g. `with Nb6`, `without …`).
- Return `family` alone when nothing survives, otherwise `` `${family}: ${leaf}` ``.
- Result: `English Opening: Fianchetto Line`, `Caro-Kann Defense: Main Line`.

## D5 — Jargon is the only unavailability reason users ever see

`strategic-fit-replacement.ts:249-254` tests `cohort?.state !== "actionable"` **before**
the plain-language `uncertain-finding` and `forced-finding` branches. No cohort was
actionable in any of the three runs (White 6× `insufficient-evidence`; Black 13×
`insufficient-evidence` + 3× `mixed-profile`), so all 26 findings showed
_"This finding has no current actionable comparison cohort."_ — as body copy under
"Find a more familiar line" (`ResolutionActions.tsx:133`) and as the `Open Replacement
Lab` description (`:147-152`). The specific reasons below are unreachable.

**Fix.** Move the classification checks above the cohort check, and reword the
remaining cohort case in plain language: _"There is no comparable group of lines to
draw a replacement from yet."_

## D6 — Action tag pre-judges the decision

`actionLabel` (`finding-story.ts:101-109`) returns "Understand and keep" for
`kind === "context"`, directly above `ResolutionActions.tsx:127` reading
_"Current state: **Unresolved**"_.

**Fix.** Return "Suggested: keep as is" — advice, not asserted state.
`"No action needed"` for transpositional equivalence is already correct and stays.

## D7 — Preset profiles never exercise the weighting that exists

`feature_family_weights` **is** wired: `strategicFitProfileDistanceOptions`
(`analyze.ts:149-154`) → `calculateStrategicDistances` (`analyze.ts:1276`) →
`resolvedWeights` (`distance.ts:418`), plus `visualization.ts:251,379` and
`replacement-score.ts:663,1599`.

Verified live on the Black repertoire: skewing weights to
`pawn-topology/center-dynamics 3, rest 0.1` moved finding `8f6016aa`
distance `0.21619 → 0.055518`, `learning_burden `0.250982 → 0.230898`, and both
priority scores. Only 1 of 19 findings moved because only 3 have non-empty
`evidence.dimensions`; the rest have no comparable evidence for weights to act on.

The defect is that `strategicFitPresetProfile` (`apps/ui/src/store/strategic-fit-profile.ts:174-183`)
returns `clonePreferences(DEFAULT_PROFILE.preferences)` for **every** mode, so the
wiring always carries `all 1.0`. Runs `16c7d869` (Balanced) and `ce09c37b` (Familiar
plans) share seed sha `34c3fca0…` and produced identical output.

**Fix.** Give the three presets distinct, chess-meaningful preferences, defined once in
`chess-tools` and consumed by the UI so MCP and PWA agree:

| Preference                          | Familiar plans | Balanced | Versatile |
| ----------------------------------- | -------------- | -------- | --------- |
| `pawn-topology`                     | 1.5            | 1        | 0.75      |
| `center-dynamics`                   | 1.5            | 1        | 0.75      |
| `king-and-piece-setup`              | 1.25           | 1        | 0.75      |
| `space-and-files`                   | 1              | 1        | 1         |
| `dynamic-character`                 | 0.5            | 1        | 1.5       |
| `learning-concepts`                 | 1.25           | 1        | 0.5       |
| `additional_memorization_tolerance` | 0.2            | 0.5      | 0.8       |

Rationale: "Familiar plans" should treat a changed pawn skeleton or king setup as a
large distance (that is what makes a line feel foreign) and tolerate little extra
memorisation. "Versatile" should weight dynamic character up and repeated-concept
pressure down, and accept more to learn. `space-and-files` is neutral in all three
because it is the least profile-discriminating family.

**Honesty requirement.** Even correct weights change nothing on a repertoire with no
comparable evidence, which is the White fixture exactly. The profile panel must say
what the preference currently steers, so a user who switches modes and sees no movement
understands why. Copy: _"Preferences steer how far apart lines are judged. Branches
without enough moves to compare are unaffected."_

## Non-defects — verified correct, do not change

- Every displayed count reproduces exactly (`11/19`, `85%`, `36/62`, `92%`, tile
  counts `0/1/6` and `1/5/13`, `Review 7` / `19` / `18`).
- All transposition claims hold; `get_transpositions` returns identical FENs for all
  5 White and 26 Black groups.
- `Save` vs `Save resolution` share a verb but the surrounding copy
  (`strategic-fit-finding-resolutions.ts:433`) disambiguates correctly.
- Neither fixture produces a `genuine-inconsistency` finding, so the Replace/Portfolio
  path never engages. That is the data, not a bug.

## Found while implementing

Two consequences the plan did not anticipate, both fixed here:

- **`StrategicOverview` blanked the workload value and misattributed the reason.**
  `summary.workload === "unavailable"` previously only happened when the preflight was
  _blocked_, so the overview set `report_value: ""` and reason `BLOCKED_REASON`
  ("The evidence check blocked position analysis"). With D1 that state now also arises
  from thin coverage on a merely degraded preflight, making the reason false. The
  canonical value is now kept — `state` already reports unavailability — and a
  coverage-specific reason is used when the preflight is not blocked.
- **The D7 disclosure sentence broke the setup dialog.** Placed inside
  `<fieldset class="strategic-fit-profile-options">` it became a grid item, displacing
  the footer so "Skip for now" resolved as visible and stable but never received the
  click (`strategic-fit-lifecycle.spec.ts:173` timed out). Moved into
  `.strategic-fit-profile-setup-footer` beside the existing "what this does" copy.

## Verification

- `chess-tools`: new `taxonomy.test.ts` case drives the real ECO string
  _"…Fianchetto Line, with Nb6"_ through `classifyOpeningName` → `openingScopeLabel`;
  new `metrics.test.ts` case covers the coverage gate, including the regression that
  unmeasured branches must not dilute the verdict toward "low". 415 pass.
- `apps/ui`: `strategic-fit-story.test.ts`, `strategic-fit-profile.test.ts` and
  `strategic-fit-intent-interview.test.ts` updated — the last now asserts that
  switching preset discloses the preferences it moves. 412 pass.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` clean.

### Known unrelated failures

All 22 `strategic-fit-*.spec.ts` files were exercised on chromium. Five contain one
failing test each, and **each was reproduced identically on a clean stash of `main`**:

| Spec                                  | Test                                                     | Hangs on                                          |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `strategic-fit-lifecycle.spec.ts:163` | remain idle until the explicit Analyze action (`@smoke`) | `page.evaluate` (line 176)                        |
| `strategic-fit-map.spec.ts:57`        | strategic map plots explainable points                   | click "Analyze strategic fit"                     |
| `strategic-fit-heatmap.spec.ts:57`    | concept heatmap shows textual cells                      | click "Analyze strategic fit"                     |
| `strategic-fit-annotation.spec.ts:26` | browser V2 annotation remains clone-only                 | `page.evaluate`                                   |
| `strategic-fit-overview.spec.ts:99`   | complete overview reconciles canonical values            | `[data-analysis-state='completed']` never appears |

All five are 30s timeouts where the analysis never completes or the CDP session closes
(`Protocol error (Runtime.callFunctionOn): Internal server error, session closed`) — one
failure class, not five. They are not caused by, and do not affect, this work.

`strategic-fit-overview.spec.ts:99` is **intermittent**: it passed twice earlier in the
same session, including immediately after the `report_value` fix, then later failed on
both this branch and a clean stash of `main` with 9.3 GiB free. Treat the class as
environment-sensitive browser-session flakiness rather than as assertions about product
behaviour, and investigate it separately.
