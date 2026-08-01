# UI/UX Remediation Plan — `apps/ui`

**Source audit:** `docs/ui-ux-audit.md` (2026-08-01, findings `UX-001`–`UX-048`)
**Date:** 2026-08-01
**Status:** planning only — no production code changed by this document.

---

## 1. Executive implementation summary

### Scope

39 work packages (`WP-000`–`WP-038`) closing all 48 audit findings across `apps/ui`. `packages/chess-tools` is touched only to read the existing `tool-contract` for user-facing labels; `apps/mcp-server` is not touched at all.

### Overall strategy

Four rules govern the sequence.

1. **Ship the two one-declaration Critical fixes first.** `UX-001` (zero-height panels at 200% zoom) and `UX-002` (horizontal scroll at 721–823px) are each a small CSS change on a verified measurement. They must not wait behind the top-bar redesign that shares their file.
2. **Build primitives before migrating consumers.** `Dialog`, `InteractiveRow`/`MoveButton`, the live region, the operation registry, the shortcut-scope registry, and the content registry each close 2–6 findings. Every one of them already has a working reference implementation somewhere in the repository — usually inside `StrategicFitWorkspace`. The work is generalisation, not invention.
3. **Separate the four persistence concepts before touching any of them.** Navigation history (`path`), mutation undo (tree edits), autosave recovery (IndexedDB snapshots), and file persistence (PGN handle) are conflated today in one keybinding and one storage slot. They are split in `WP-003`–`WP-005` before anything else writes to IndexedDB.
4. **Gate the two genuinely unknown interaction models.** The board keyboard layer (`WP-014`) and the Strategic Fit Review/Redesign split (`WP-035`) get prototype-and-validate checkpoints, not implementation mandates.

### Critical path

```text
WP-000 → WP-001 → WP-002 → WP-003 → WP-004 → WP-005
                                  ↘ WP-006 → WP-007 → WP-009 → WP-011 → WP-014
```

Explained in §9. Six Critical findings (`UX-001`–`UX-007`) close on this chain; nothing else in the plan is a prerequisite for any of them.

### Major architectural changes

| Change                                                                   | Replaces                                                              | Closes                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------- |
| `Dialog` primitive extracted from `StrategicFitWorkspace`                | three hand-rolled overlays                                            | UX-007, UX-019, UX-045       |
| Shortcut-scope registry (`store/shortcuts.ts`)                           | one `window.keydown` handler with a single Strategic-Fit escape hatch | UX-007, UX-044               |
| Undoable command model (`store/history.ts`) wrapping every tree mutation | `actions.undo()` leaf-splice                                          | UX-005                       |
| Autosave snapshot ring (IndexedDB `workingRepertoire.snapshots`)         | single-slot `workingRepertoire`                                       | UX-006                       |
| Operation registry (`store/operations.ts`)                               | 8 independent `*scanning` booleans + `commandStates` + `toolRuns`     | UX-011, UX-040               |
| App live region + `announce()`                                           | nothing                                                               | UX-012                       |
| `InteractiveRow` / `MoveButton`                                          | 9 `<div onClick>` sites + 1 `<span onClick>` site                     | UX-004, UX-014               |
| Content registry (`content/`)                                            | inline string literals                                                | Workstream I, UX-015, UX-016 |
| Design tokens + presentation primitives                                  | 6 root variables + 1,226 ad-hoc class rules                           | UX-030, UX-048               |
| Responsive tier tokens                                                   | 18 media queries at 3 uncoordinated widths                            | UX-024                       |

### Highest-risk packages

| WP                            | Why                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `WP-014` Board keyboard layer | New interaction surface over Chessground's own pointer handling; pointer regression risk is the app's core gesture |
| `WP-005` Undo/redo            | Touches all six tree-mutation entry points; a wrong inverse silently corrupts a repertoire                         |
| `WP-004` Autosave snapshots   | IndexedDB write-path change on the only copy of user data                                                          |
| `WP-011` Row primitives       | Nine call sites, visual density regression risk across the whole repertoire panel                                  |
| `WP-036` Design tokens        | Touches `styles.css` globally; must be strictly additive-then-migrate                                              |

### What is deliberately not being rewritten

SolidJS stays. Vite stays. Chessground stays. No backend. No Tailwind, no CSS-in-JS, no CSS modules. `styles.css` is extended with tokens and migrated section by section — never replaced. Strategic Fit's analysis engine, evidence model, staging semantics, and mutation safeguards are untouched; only its presentation and vocabulary change. The MCP server and the tool contract are read, not modified. No internationalisation framework.

### Expected result

After `WP-038`: no Critical or High audit finding open; keyboard-only completion of the core journey (open → navigate → add a variation → save); no horizontal overflow and no zero-height panel anywhere in the 16-viewport × 3-zoom matrix; document location always visible; no raw identifier in user-facing text; Strategic Fit terminates usefully on insufficient evidence; core and Strategic Fit share one token set and one primitive set.

---

## 2. Audit validation and repository deltas

Files inspected for this plan beyond the audit's own pass: `.github/workflows/ci.yml`, `.github/workflows/deploy-ui.yml`, `apps/ui/vite.config.ts`, `apps/ui/playwright.config.ts`, `apps/ui/test/e2e/helpers/accessibility.ts`, `apps/ui/src/store/idb.ts`, `apps/ui/src/store/document-identity.ts`, `apps/ui/src/store/gaps.ts`, `apps/ui/src/store/repertoire.ts`, `apps/ui/src/llm/tools.ts`, `apps/ui/src/application/browser-commands/client.ts`, `apps/ui/src/application/browser-commands/registry.ts`, `apps/ui/src/engine/stockfish.ts`, `apps/ui/src/store/strategic-fit-changes.ts` (transaction section).

### Audit claims confirmed by re-inspection

All 48 findings hold. No finding was invalidated. The measurements in audit §8 (viewport table) and §9 (a11y failures) were produced by the same runtime harness this plan reuses.

### Corrections and additions that change implementation scope

| #   | Correction                                                                                                                                                                                                                                                                                                                                                                                                       | Effect on the plan                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **There is no linter.** No ESLint, Prettier, or Biome config exists anywhere in the repo. `package.json` has `typecheck`, `build`, `docs:check`, `check:skills`, `check:legacy-imports`, and test scripts only.                                                                                                                                                                                                  | "Linting" is removed from every Definition of Done and replaced with `pnpm -r typecheck` + `pnpm docs:check` + `pnpm check:skills`. `WP-000` does **not** introduce a linter — that is unrelated churn.                                                                                                       |
| D2  | **CI never runs any UI test.** `ci.yml` runs `check:skills`, `docs:check`, `pnpm -r typecheck`, two Node smoke scripts, and the MCP stdio smoke. It runs neither `pnpm --filter @chess-mcp/ui test:chat` (43 `tsx --test` suites) nor Playwright (22 e2e specs).                                                                                                                                                 | `WP-000` must add a UI CI job. Without it every acceptance criterion in this plan is unenforced. This is the single highest-leverage item in the whole roadmap and is why it is `WP-000`.                                                                                                                     |
| D3  | **Playwright is Chromium-only.** `playwright.config.ts` declares one project, `devices["Desktop Chrome"]`, `fullyParallel: false`, 30s timeout, `webServer` = `pnpm dev --host 127.0.0.1 --port 4173`.                                                                                                                                                                                                           | The browser matrix (§11) requires adding Firefox and WebKit projects. Because `webServer` runs the **dev** server, `window.__chess` is available to tests — the plan depends on that and must not switch to a preview build.                                                                                  |
| D4  | **An accessibility test helper already exists.** `test/e2e/helpers/accessibility.ts` exports `basicAccessibilityViolations`, `expectBasicAccessibility`, `touchTargetViolations(root, minimum = 44)`, and `contrastViolations`. Currently consumed only by `strategic-fit-accessibility.spec.ts` and `strategic-fit-findings.spec.ts`.                                                                           | The plan **generalises this helper** rather than adding `axe-core`. `WP-000` extends it with keyboard-reachability and raw-identifier assertions and points it at core-app roots. No new dependency.                                                                                                          |
| D5  | **`idbMutateAtomically` already exists** in `store/idb.ts` alongside `idbGet`/`idbSet`/`idbDel`. Single DB `chess-repertoire` version 1, single object store `kv`, key-value.                                                                                                                                                                                                                                    | `WP-004` writes snapshot records through `idbMutateAtomically` so the pointer and the snapshot land in one transaction. **No IndexedDB version bump and no `onupgradeneeded` migration is required** — new keys in an existing key-value store. This materially lowers the risk of the persistence package.   |
| D6  | **`pauseWorkingRepertoireAutosave()` and `flushWorkingRepertoire()` already exist** (`persist.ts:81, 134`) and are used by `strategic-fit-changes.ts:754` and `strategic-fit-sidecar.ts:231`.                                                                                                                                                                                                                    | `WP-004`/`WP-005` reuse this pause/flush protocol for snapshot boundaries instead of inventing one. Any new durable write must respect `autosavePauseDepth`.                                                                                                                                                  |
| D7  | **The engine already honours per-job `AbortSignal`**, including cancelling queued jobs (`engine/stockfish.ts:251–261`), and `executeBrowserCommand` threads `options.signal` through to implementations and re-checks on return (`client.ts:13, 19`).                                                                                                                                                            | **Per-tool chat cancellation is technically feasible.** The only blocker is `chat.ts:executeCalls`, which shares one turn-level `AbortSignal` across all calls in a `for` loop. `WP-027` gives each call a child controller. This is now an implementation-defined item, not a speculative one.               |
| D8  | **All six tree-mutation entry points traced.** `Board.tsx:35` and `PromotionModal.tsx:29` → `actions.play`; `suggestions.ts:92` → `actions.applyEdit`; `suggestions.ts:181` → `actions.appendLine`; `strategic-fit-changes.ts:779` → `actions.applyStrategicFitSnapshot`; `strategic-fit-changes.ts:794` → `actions.restoreStrategicFitSnapshot`. Document replacement: `loadPgn`, `newGame`, `restoreDocument`. | `WP-005` can promise undo honestly. `restoreStrategicFitSnapshot` is explicitly **excluded** — it is already a rollback and deliberately restores the prior `version()` without allocating a revision. Document replacement **clears** the stack rather than being undoable.                                  |
| D9  | **`browserDocumentMutationRegistry` (`registry.ts:23`) is a naming pass-through**, not a history owner — it forwards `publish`/`rollback` to injected callbacks.                                                                                                                                                                                                                                                 | The undo stack belongs in a new `store/history.ts` wrapping `store/game.ts` actions, **not** in the registry. Extending the registry would put history behind a chess-tools-adjacent boundary it was never designed for.                                                                                      |
| D10 | **`version()` is one counter serving three consumers**: staged-edit revision binding (`suggestions.ts:81`), Strategic Fit snapshot binding (`strategic-fit-changes.ts`), and autosave (`persist.ts:122`).                                                                                                                                                                                                        | Undo must **allocate a new revision**, not restore the old number. Consequence to state in the UI: undoing invalidates pending staged cards bound to the pre-undo revision — they correctly become `stale`. `WP-005` acceptance criteria encode this.                                                         |
| D11 | **Two undo systems will coexist.** The Replacement Lab already owns an undo with a rescan and a proof (`strategic-fit-resolution-proof.ts` statuses `undoing`, `undo-blocked`, `undone`).                                                                                                                                                                                                                        | Interaction between global `Ctrl+Z` and an applied Strategic Fit change set is a **product decision** (`PD-3`, §14). `WP-005` ships with the conservative default: global undo is _blocked_ on an SF-authored revision with a message pointing at the Lab.                                                    |
| D12 | **COOP/COEP headers are dev-server middleware only** (`vite.config.ts:11–19`); production relies on host headers. `optimizeDeps.exclude: ["stockfish"]`, `worker.format: "es"`.                                                                                                                                                                                                                                  | No package may add a cross-origin asset (fonts, CDN icons) — it would break COEP `require-corp` and take the engine down. Recorded as a hard constraint on `WP-036`.                                                                                                                                          |
| D13 | **Deploy is automatic on `main`** (`deploy-ui.yml`, Cloudflare Pages, path-filtered to `apps/ui/**` and `packages/**`).                                                                                                                                                                                                                                                                                          | Every merge to `main` deploys. There is no staging environment and no feature-flag infrastructure. §15 rollback plans therefore assume "revert the commit and let the deploy re-run", and risky packages must be split so a revert is small.                                                                  |
| D14 | Audit §13 places the `user-select` inversion (`UX-025`) in Phase A with the note "re-test board drag on touch".                                                                                                                                                                                                                                                                                                  | Confirmed as correct but under-scoped: `-webkit-touch-callout` and `-webkit-user-drag` are set on `body`, `img`, and `.cg-wrap .piece` separately (`styles.css:20–47`). The inversion must preserve all three piece-drag suppressions or dragging breaks on iOS. Folded into `WP-006` with explicit criteria. |

### Features added since the audit

None. `git status` shows only untracked artefacts (`2026-07-31_22-56-01.png`, `apps/ui/.claude/skills/run-ui/open-workspace.mjs`, and the audit itself). No source file changed after the audit was written.

### Existing test coverage relevant to this plan

| Area                                                          | Coverage                             | File                                                                   |
| ------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Chat transport, tool rounds, compaction, cancellation         | Strong                               | `test/chat.test.ts` (36 KB), `test/cancellation.test.ts`               |
| Document identity rotation                                    | Strong                               | `test/document-identity.test.ts`, `test/e2e/document-identity.spec.ts` |
| Strategic Fit stores                                          | Very strong — 41 `tsx --test` suites | `test/strategic-fit-*.test.ts`                                         |
| Strategic Fit UI, a11y, visualisation hardening, print/export | Strong — 21 Playwright specs         | `test/e2e/strategic-fit-*.spec.ts`                                     |
| Core app e2e                                                  | `phase7.spec.ts` only                | `test/e2e/phase7.spec.ts`                                              |

### Relevant behaviour with **no** test coverage

Top bar (all nine controls), file open/save/reopen flows, colour-picker modal, promotion modal, Settings drawer, move tree rendering and navigation, repertoire panel sections and rows, analysis panel states, eval bar, dividers and layout persistence, mobile tabs, responsive breakpoints at any width, keyboard shortcuts, `actions.undo`, `actions.newGame`, autosave restore. **Every Critical finding in the audit sits in untested code.** This is why `WP-000` precedes all implementation.

### Technical constraints that materially affect the plan

- No linter; type checking is the only static gate (D1).
- No CI enforcement of UI tests until `WP-000` (D2).
- Deploy-on-merge with no staging and no flag system (D13).
- COEP `require-corp` forbids any external asset (D12).
- `window.__chess` exists only in dev builds (`index.tsx:82`), and Playwright's `webServer` is the dev server — tests may rely on it, production code may not.
- Panels must stay mounted across mobile tab switches (`styles.css:318–330` toggles `display` only). No package may convert this to conditional rendering.
- `.workspace` is `overflow: hidden` in both the flex and phone regimes; any package changing panel sizing must state what scrolls.

---

## 3. Planning assumptions and non-goals

### Assumptions

1. One developer or agent works a package at a time within a phase; parallelism is exploited across phases per §9.
2. `main` is the integration branch and deploys on merge (D13). Packages are sized so a single revert restores the prior UX.
3. The audit's runtime harness (headless Chromium driven through `window.__chess`) is the measurement baseline; `WP-000` promotes it into `test/e2e`.
4. Copy in this plan and in the audit §6 is a starting draft, not final approved product copy. Where copy carries a decision (persistence language, Strategic Fit framing) it is flagged.
5. No design system exists to adopt; tokens are extracted from the Strategic Fit stylesheet, which is the repository's own most-developed visual language.

### Non-goals

- **No framework migration.** SolidJS 1.9 and Vite 6 stay.
- **No backend.** The app remains fully static-hostable.
- **No wholesale stylesheet replacement.** `styles.css` is extended and migrated in place.
- **No Tailwind, CSS-in-JS, or CSS modules.** The audit found missing abstractions, not a missing tool.
- **No removal of expert chess or engine information.** Centipawns, depth, multi-PV, SAN, FEN, structure names, and only-move margins all stay. Only _product-internal_ vocabulary is replaced.
- **No redesign for visual novelty.** Every visual change in this plan cites a finding.
- **No unvalidated Strategic Fit split.** `WP-035` is a validation checkpoint, not an implementation package.
- **No weakening of staged-mutation safeguards.** Revision binding, `pending`/`accepted`/`rejected`/`stale` states, explicit Accept/Reject, and the "nothing is saved until you accept" copy survive every package that touches them.
- **No internationalisation framework.** The content registry is a typed module with formatter helpers, sized for one locale (§6 `WP-024`).
- **No new runtime dependencies** unless a package states one and justifies it against D12.
- **No conversion of mounted mobile panels to conditional rendering.**

---

## 4. Target interaction and UI architecture

Nine subsystems and eight presentation primitives. Each states what it does **not** own, so packages do not accrete responsibility.

### 4.1 `Dialog` primitive — `src/components/primitives/Dialog.tsx`

**Responsibility.** Modal presentation contract: backdrop, `role="dialog"`, `aria-modal="true"`, labelled heading wiring, focus capture on open, focus cycling within, `Escape` to dismiss, focus restoration to the invoking element on close, `inert` + `aria-hidden` on the background root, and registration of a shortcut scope (see 4.3) for its lifetime.
**Does not own.** Content layout, form state, validation, the decision of what "dismiss" means for a given caller (destructive vs neutral), or the nested-overlay policy — a caller opening a second dialog passes `nested: true` and the outer instance suspends its own trap.
**Initial consumers.** `SettingsDrawer`, `PromotionModal`, `ColorPickerModal`.
**Future consumers.** `StrategicFitWorkspace` and `ReplacementLab` (migrated in `WP-033`, not before — their current implementation is correct and is the extraction source), the `New`/`Open` confirmation dialogs from `WP-003`, the Recover UI from `WP-004`.
**Conceptual interface.**

```ts
interface DialogProps {
  open: boolean;
  onClose: (reason: "escape" | "backdrop" | "dismiss") => void;
  title: string; // renders the labelled heading, or supply titleId
  titleId?: string;
  describedById?: string;
  initialFocus?: () => HTMLElement | undefined;
  dismissOnBackdrop?: boolean; // default true; false where dismissal is destructive
  nested?: boolean;
  size?: "drawer" | "panel" | "compact";
  children: JSX.Element;
}
```

**Accessibility responsibilities.** Everything listed above, plus: no focusable element outside the dialog while open; the background root gets both `inert` **and** `aria-hidden` (never one alone — this is `UX-045`); the heading is the accessible name.
**Test strategy.** One Playwright contract spec parameterised over every consumer: open → focus lands inside → Tab and Shift+Tab cycle → `Escape` closes → focus returns to opener → `ArrowLeft`/`ArrowRight` do not change `window.__chess.currentPath()` → background root has `inert`.
**Migration.** Extract the behaviour from `StrategicFitWorkspace.tsx:347–408` (`trapFocus`, `returnFocus`, the `FOCUSABLE` selector list) verbatim into the primitive, then convert the three simple overlays. Strategic Fit itself migrates last so a regression there is not entangled with the extraction.
**Resolves.** UX-007, UX-019, UX-045.

### 4.2 Shortcut-scope registry — `src/store/shortcuts.ts`

**Responsibility.** Single source of truth for global key handling: a stack of active scopes, a declarative binding table (key + modifiers + scope + handler + human label + whether it fires inside text-editing controls), and one `window.keydown` listener.
**Does not own.** Component-local key handling (the Strategic Fit stage tablist's `Home`/`End`, a select's native keys, the move tree's internal arrow navigation from `WP-011`). Those stay local and simply are not registered here.
**Initial consumers.** `App.tsx` (replacing the inline handler), `Dialog` (pushes a `modal` scope), `StrategicFitWorkspace` (replacing its `strategicFitWorkspaceOpen()` early return).
**Future consumers.** `WP-005` (undo/redo), `WP-008` (the help sheet, which renders the registry), `WP-014` (board cursor keys).
**Conceptual interface.**

```ts
type ShortcutScope = "global" | "modal" | "workspace";
interface Shortcut {
  id: string;                       // "document.save"
  keys: string;                     // "Mod+S"
  label: string;                    // from the content registry
  scope: ShortcutScope;
  allowInTextFields?: boolean;      // only document.save is true today
  run: () => void;
  enabled?: () => boolean;
}
pushScope(scope: ShortcutScope): () => void;   // returns a disposer
register(shortcut: Shortcut): () => void;
activeShortcuts(): Shortcut[];                 // drives the help sheet
```

**Accessibility responsibilities.** Guarantees that no global shortcut fires while a modal scope is on the stack (except an explicitly modal-scoped one), and preserves the existing text-field guard (`App.tsx:55`) as a registry-level rule rather than a hand-written condition.
**Test strategy.** Store unit tests for scope stacking and the text-field rule; a Playwright assertion that `ArrowRight` is inert behind each overlay.
**Resolves.** Enables UX-007; directly resolves UX-044.

### 4.3 Undoable command model — `src/store/history.ts`

**Responsibility.** A bounded (50-entry) stack of applied document mutations, each carrying a `do`/`undo` pair expressed as tree snapshots plus a navigation path, an origin tag, and a human label for the announcement and toast. Owns `undo()`, `redo()`, `canUndo()`, `canRedo()`, `lastLabel()`.
**Does not own.** Navigation (`path` stays in `game.ts` and is never an undo entry), autosave (`persist.ts`), file persistence (`files.ts`), or Strategic Fit's own proof-backed undo (D11).
**Boundary decisions.**

- Entries are recorded by wrapping the four mutating actions (`play`, `applyEdit`, `appendLine`, `applyStrategicFitSnapshot`) and the new explicit delete. `restoreStrategicFitSnapshot` is excluded (D8).
- Undo allocates a **new** revision (D10). It does not restore the prior number.
- Document replacement (`loadPgn`, `newGame`, `restoreDocument`) **clears** the stack.
- The stack is **in-memory only** — it does not survive refresh. Rationale in §12; refresh recovery is the snapshot ring's job, and persisting inverse trees would multiply the storage footprint of the only copy of user data for a benefit the audit did not evidence.
- Storage strategy: each entry holds the `before` and `after` PGN strings. For the repertoire sizes this app targets this is kilobytes; a size cap (2 MB total) evicts oldest entries.
  **Initial consumers.** `App.tsx` shortcuts, the new delete control, the undo toast.
  **Test strategy.** A store test per mutation kind asserting `apply → undo → redo` returns the exact PGN at each step, that `version()` strictly increases across all three, and that a document replacement empties the stack.
  **Resolves.** UX-005.

### 4.4 Autosave snapshot ring — `src/store/persist.ts` (extended)

**Responsibility.** Retain the last N (default 5) durable working-document states plus the live slot, and expose them for recovery.
**Does not own.** Undo (in-memory, 4.3), file writes (`files.ts`).
**Storage shape.** Existing key `workingRepertoire` keeps its current record verbatim so a rollback to today's build reads it unchanged. New keys are additive in the same `kv` store (D5): `workingRepertoire.snapshotIndex` (an ordered list of `{ id, savedAt, fileName, moveCount, lineCount, reason }`) and `workingRepertoire.snapshot.<id>` (the full `SavedWorkingRepertoire` record). Written through `idbMutateAtomically` so index and payload land together.
**Capture points.** Before document replacement (`New`, `Open`, `Reopen`, restore), and on a 10-minute idle timer while `dirty()`. Never on every keystroke.
**Test strategy.** Store tests for ring eviction, atomic write, corrupt-payload tolerance (a snapshot that fails `GameTree.fromPgn` is skipped and reported, never thrown), and quota-exceeded degradation (drop the oldest snapshot and continue; never let a snapshot failure break the live autosave).
**Resolves.** UX-006 (recovery half).

### 4.5 Operation registry — `src/store/operations.ts`

**Responsibility.** One list of everything currently running, from any source: `{ id, kind, label, status, done?, total?, detail?, startedAt, cancel?, surface }` where `surface` says which panel owns the result (`analysis` | `repertoire` | `chat` | `strategic-fit`).
**Does not own.** The work itself, the abort controllers (owners keep them and hand a `cancel` callback), or result rendering.
**Initial consumers.** `store/commands.ts` (7 direct commands), `store/gaps.ts` (`scanning`), `store/repertoire.ts` (`bridgeScanning`, `pruneScanning`, `compScanning`, `inspecting`), `store/chat.ts` (`toolRuns`), `store/analysis.ts` (`analysing`).
**Future consumers.** Mobile tab badges (`WP-013`), the activity strip (`WP-013`), the live region (`WP-009`), the PWA update deferral (`WP-019`).
**Migration.** Additive: each store registers and updates alongside its existing signal, then the local signal is deleted in the same PR once its consumers read the registry. The eight `*scanning` booleans disappear one store at a time.
**Test strategy.** Store tests that a completed/cancelled/failed operation leaves the registry; a Playwright test that a running Gaps scan is visible from the Chat tab (the exact `UX-011` failure, verified in the audit).
**Resolves.** Enables UX-011, UX-040; supports UX-012.

### 4.6 App live region — `src/components/AppLiveRegion.tsx` + `src/store/announce.ts`

**Responsibility.** One `aria-live="polite"` region and one `role="alert"` region at the app root, plus an `announce(message, { assertive? })` helper that de-duplicates identical consecutive messages and rate-limits to one message per 500 ms.
**Does not own.** Visual toasts (4.7), inline status text.
**Policy (merge-blocking, see §13).** Announce: document restored, file saved, file open failed, operation started, operation completed with a result count, operation cancelled, operation failed, mutation applied, mutation undone, engine went offline. Do **not** announce: streaming chat tokens, progress ticks, hover, focus, or navigation.
**Resolves.** UX-012.

### 4.7 `Toast` primitive — `src/components/primitives/Toast.tsx`

**Responsibility.** Transient, dismissible, optionally actioned notice anchored bottom-centre (bottom-safe-area aware), auto-dismissing after 8 s unless it carries an action, and mirrored to the live region.
**Initial consumers.** Undo-after-delete (`WP-005`), PWA update (`WP-019`), document restored (`WP-018`).
**Does not own.** Persistent state display — anything the user must still be able to read a minute later belongs in a panel, not a toast. This rule prevents the audit's "hide state for cleanliness" failure mode.
**Resolves.** Supports UX-005, UX-041, UX-032.

### 4.8 `InteractiveRow` and `MoveButton`

**`InteractiveRow`** — `src/components/primitives/InteractiveRow.tsx`. A real `<button type="button">` laid out as a row, with slots (`leading`, `primary`, `trailing`), a `selected` state mapping to `aria-current`, a target-size floor, and an optional secondary action rendered as a sibling button (never a nested one).
**Does not own.** Row content semantics or the severity vocabulary.
**Initial consumers.** All nine `.rep-row` sites in `RepertoirePanel.tsx` (lines 137, 176, 189, 207, 215, 253, 276, 300, 330, 396) and `ToolResult`'s `.result-nav`.
**`MoveButton`** — a move span rendered as a button inside a `role="tree"` structure, with `aria-current="true"` on the active node and `aria-expanded` on branch toggles. Arrow-key traversal lives in `MoveTree`, not in the button.
**Test strategy.** A Playwright assertion that every `.rep-row`-equivalent and every move is Tab-reachable and Enter-activatable, plus `touchTargetViolations` (D4) run against the repertoire panel and move tree roots.
**Resolves.** UX-004, UX-014 (structural half).

### 4.9 Content registry — `src/content/`

**Responsibility.** All user-visible strings, organised by surface, with typed formatter helpers.
**Organisation.**

```text
src/content/
  index.ts          re-exports; the only import site for components
  document.ts       file/persistence copy, confirmations
  analysis.ts       engine panel, eval, legend
  repertoire.ts     tool group titles, empty states, evidence explanations
  chat.ts           presets, run states, card titles, stop/retry
  errors.ts         error code → { title, cause, action }
  strategicFit.ts   stage names, statuses, explanations
  tools.ts          contract tool name → task label
  format.ts         evalText, cpDelta, moveCount, lineCount, relativeTime, sanPath
```

**Variable content.** Strings are functions where they interpolate: `document.confirmNew({ fileName, unexportedChanges })` returns a `{ title, body, confirmLabel, cancelLabel }` object. No template concatenation at call sites.
**Expert and plain terms coexist** via a pair type: `{ plain: string; expert?: string }`. The renderer shows `plain` as the label and `expert` in a description slot or a `title`, never the reverse. This is how "only move by 0.47" keeps "margin 47cp" available.
**Future tool registration.** `content/tools.ts` exports `taskLabel(toolName)`; a `docs:check`-style script asserts every `contractsForHost("browser")` entry has a label, so a new tool cannot ship with a raw identifier. This is the mechanism that prevents raw terminology returning.
**Localisation.** Out of scope. Strings are plain TypeScript, not a message catalogue. The function-per-string shape means a future catalogue is mechanical.
**Resolves.** Workstream I; enables UX-015, UX-016, UX-034, UX-036–UX-039, UX-043.

### 4.10 Presentation primitives (visual consistency, not correctness)

`PanelHeader`, `RegionState` (generalised from `StrategicFitWorkspace.tsx:94–122`), `ErrorState`, `Status`, `Progress`, `Button` variants, `Field`/`Select`. Each has one job, is adopted incrementally, and is explicitly **not** required for any Critical fix. `WP-037` states each one's consumers.

### 4.11 Responsive tier tokens

Three named tiers replacing three uncoordinated breakpoints: `compact` (≤720px, board-pinned column), `medium` (721–1100px, two-column grid), `wide` (≥1101px, three-column flex). Strategic Fit's 820px breakpoint is re-expressed as a workspace-local `container`-style query on the workspace width so it stops being a fourth global breakpoint. Each tier documents a **content contract**: minimum panel height, minimum panel width, what scrolls, and what may be hidden.
**Resolves.** UX-024; underpins UX-001, UX-002, UX-033.

### 4.12 Design tokens

Additive `:root` block: `--fs-*` (6 steps, 0.75rem floor for body), `--sp-*` (4px base), `--surface-0..3`, `--border-subtle/strong`, `--text-primary/secondary/tertiary`, `--status-ok/warn/danger/info`, `--target-min/--target-touch`, `--motion-fast/slow`, `--focus-ring`, `--z-base/sticky/overlay/dialog/toast`. Values are extracted from the Strategic Fit stylesheet, which already encodes the intended ladder.
**Resolves.** UX-030, UX-048.

---

## 5. Dependency graph

```text
WP-000 Baseline harness + UI CI job
├── WP-001 Responsive floor (min heights, dvh board cap)          [Critical]
├── WP-002 Top-bar overflow emergency fix                          [Critical]
├── WP-006 Global a11y + interaction policy CSS
│   ├── WP-007 Dialog primitive + shortcut-scope registry          [Critical]
│   │   ├── WP-003 New/Open protection (uses Dialog)               [Critical]
│   │   │   └── WP-004 Autosave snapshot ring + Recover UI         [Critical]
│   │   │       └── WP-005 Undo/redo + explicit delete             [Critical]
│   │   │           └── WP-014 Board keyboard layer  [gated by DV-1][Critical]
│   │   ├── WP-008 Keyboard command registry + help sheet
│   │   └── WP-033 Strategic Fit stage model (migrates to Dialog)
│   ├── WP-012 Divider keyboard + reset + hit area
│   └── WP-036 Design tokens
│       └── WP-037 Presentation primitives
│           └── WP-038 Arrow legend + fit terminology
├── WP-009 App live region + announce()
│   ├── WP-010 Operation registry
│   │   ├── WP-013 Mobile tab semantics + activity strip
│   │   └── WP-019 PWA update notice + Toast
│   └── WP-018 Document-state indicators   (also needs WP-004)
├── WP-011 InteractiveRow + MoveButton  (also needs WP-006 targets)
│   ├── WP-015 Side column reorder
│   ├── WP-022 Repertoire tool regrouping
│   └── WP-029 Repertoire states + single-action artifacts
├── WP-016 Engine controls into Analysis + honest empty states
│   └── WP-017 Top-bar IA restructure   (also needs WP-002, WP-018)
├── WP-020 Responsive tier tokens   (also needs WP-001, WP-002)
├── WP-021 Chat rail until configured
├── WP-023 Strategic Fit entry point
└── WP-024 Content registry foundation
    ├── WP-025 Tool label mapping + navigation labels
    │   └── WP-026 Chat card tiers + technical-details policy
    │       └── WP-027 Chat context, run history, per-tool cancel
    │           └── WP-028 Result-to-board back-references
    ├── WP-029 (copy half)
    ├── WP-030 Cohort display names + identifier suppression
    │   └── WP-031 Limited-evidence + terminal state
    │       └── WP-032 Telemetry collapse
    ├── WP-034 Strategic Fit copy
    └── WP-035 Review/Redesign split validation  [gated by PD-5]
```

### Why each non-obvious dependency is real

- **`WP-007` before `WP-003`.** The `New`/`Open` confirmations replace `window.confirm` with a real dialog carrying three actions (`Keep working` / `Save to file first` / `Discard`). `window.confirm` cannot express three choices. Building the third overlay by hand would add a fourth thing for `WP-007` to migrate.
- **`WP-003` before `WP-004`.** Snapshots are captured _at_ document-replacement boundaries. Those boundaries are exactly what `WP-003` centralises. Capturing first would mean instrumenting three call sites that are about to be merged into one.
- **`WP-004` before `WP-005`.** Undo increases the rate of intentional destructive edits. Recovery must exist first so a wrong undo is not the last line of defence.
- **`WP-005` before `WP-014`.** Keyboard move entry raises the rate of accidental edits; shipping it before undo would hand keyboard users the app's sharpest edge.
- **`WP-006` before `WP-036`.** The a11y policy CSS defines `--target-min`, `--focus-ring`, and the motion query. Tokens then formalise them. Reversing the order means writing the a11y rules twice.
- **`WP-009` before `WP-010`.** The operation registry's first output is announcements; building the registry with nowhere to announce leaves it unverifiable.
- **`WP-024` before `WP-025`/`WP-030`.** Both are label-mapping work. Without the registry they would create two competing string locations.
- **`WP-002` before `WP-017`.** The audit is explicit that the emergency overflow fix must not wait for the top-bar redesign. `WP-002` is a `flex-wrap` and a `min-width: 0`; `WP-017` is an information-architecture change that needs `WP-018`'s state model.
- **`WP-018` needs `WP-004`.** "Stored in this browser · autosaved 12:04" requires the snapshot ring's `savedAt`.
- **`WP-033` after `WP-007`.** Strategic Fit is the _extraction source_ for `Dialog`. It migrates onto the primitive last, so an extraction bug is caught by the three simple overlays before it can regress the app's best-tested surface.

---

## 6. Work packages

Field key: **Type** ∈ Safety · Accessibility · Responsive layout · Architecture · Content · Visual system · Workflow · Testing. **Decision** ∈ Implementation-defined (ID) · Design validation required (DV) · Product decision required (PD).

---

### WP-000 — Baseline regression harness and UI CI job

|                              |                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| **Objective**                | Make every acceptance criterion in this plan enforceable before any of it is implemented. |
| **Audit findings addressed** | None directly; guards all 48.                                                             |
| **Severity reduced**         | — (enabler)                                                                               |
| **Type**                     | Testing                                                                                   |
| **Decision**                 | Implementation-defined                                                                    |
| **Size**                     | M                                                                                         |
| **Risk**                     | Low                                                                                       |
| **Dependencies**             | none                                                                                      |
| **Blocks**                   | every other package                                                                       |
| **Parallel with**            | nothing (it is first)                                                                     |

**Current behaviour.** `ci.yml` runs `check:skills`, `docs:check`, `pnpm -r typecheck`, `scripts/smoke-gametree.mjs`, `scripts/structure-accuracy.mjs`, and the MCP stdio smoke. It never runs `pnpm --filter @chess-mcp/ui test:chat` (43 `tsx --test` suites) or `pnpm exec playwright test` (22 specs) (D2). `playwright.config.ts` declares one Chromium project (D3). `test/e2e/helpers/accessibility.ts` exports `basicAccessibilityViolations`, `expectBasicAccessibility`, `touchTargetViolations`, `contrastViolations`, consumed by two Strategic Fit specs only (D4). No test asserts anything about the top bar, board, move tree, repertoire panel, dividers, mobile tabs, shortcuts, or any viewport.

**Target behaviour.** No user-visible change. CI fails on any UI test or accessibility-contract regression. Ten baseline checks exist, each currently recording the audit's measured failure as a **documented expected-failure** (`test.fixme` with the finding ID in the title) that the corresponding package flips to passing.

**Implementation approach.**

- New `apps/ui/test/e2e/helpers/app.ts`: `openApp(page, { width, height, pgn, fileName, color })` wrapping the `window.__chess` load path used by `.claude/skills/run-ui/driver.mjs`, plus `LONG_FILENAME` and `RICH_PGN` fixtures (the driver's four-line London/QID PGN, extended to ≥12 routes past ply 12 for Strategic Fit evidence tests).
- New `apps/ui/test/e2e/helpers/viewports.ts`: the 16-entry matrix from §11 as an exported constant, shared by every layout spec.
- Extend `helpers/accessibility.ts` with `keyboardReachable(root, selector)` (Tab-walks and returns unreachable elements), `rawIdentifierViolations(root)` (matches `/cohort:[0-9a-f]{16}/`, `/^[0-9a-f]{8}$/`, and any `contractsForHost("browser")` tool name appearing outside a `<details>`), and `overflowViolations(page)`.
- New specs: `core-layout.spec.ts`, `core-keyboard.spec.ts`, `core-dialogs.spec.ts`, `core-document.spec.ts`, `core-status.spec.ts`.
- `playwright.config.ts`: add `firefox` and `webkit` projects; keep `fullyParallel: false` (engine workers are shared); raise timeout to 60 s for engine-backed specs only via per-test `test.slow()`.
- `ci.yml`: new `ui` job — `pnpm install`, build `chess-tools`, `pnpm --filter @chess-mcp/ui typecheck`, `test:chat`, `playwright install --with-deps chromium firefox webkit`, `pnpm exec playwright test --config apps/ui/playwright.config.ts`. Upload the Playwright report on failure.
- Add `pnpm --filter @chess-mcp/ui test:e2e` to `AGENTS.md`'s command list if absent.

**Existing behaviour to preserve.** All 22 Strategic Fit specs and all 43 store suites must pass unchanged on the new CI job — they are the regression protection for every Strategic Fit strength the plan must not weaken. The dev-server `webServer` config must stay (`window.__chess` is dev-only).

**Acceptance criteria.**

- `ci.yml` contains a job that runs `test:chat` and Playwright on Chromium, Firefox, and WebKit, and it is required for merge.
- The existing 22 Strategic Fit specs pass on Chromium in CI.
- `helpers/viewports.ts` exports exactly the 16 viewports listed in §11.
- Ten baseline checks exist, each named with the finding ID it guards, each currently `test.fixme` where the audit measured a failure and passing where it measured correct behaviour:
  1. `UX-001` no core panel (`.side-panel`, `.chat-wrap`, `.mobile-tabs`) has zero rendered height at 640×400, 360×640, 720×500.
  2. `UX-002` `documentElement.scrollWidth === clientWidth` at every 5 px step from 320 to 2560 with `LONG_FILENAME` loaded.
  3. `UX-014` `touchTargetViolations(app, 24)` is empty at 1280×800 and `touchTargetViolations(app, 44)` is empty with `hasTouch: true`.
  4. `UX-003`/`UX-004` `keyboardReachable` reports zero unreachable elements for board squares, `.move`, and `.rep-row`.
  5. `UX-007` for each of the three overlays: focus enters, Tab cycles inside, `Escape` closes, focus returns, `ArrowRight` leaves `currentPath()` unchanged.
  6. `UX-005` for each mutation kind, `apply → undo → redo` returns the exact PGN at each step.
  7. `UX-012` each operation in the §3 inventory produces exactly one live-region message.
  8. `UX-015`/`UX-016` `rawIdentifierViolations` is empty for the chat log and the Strategic Fit workspace.
  9. `UX-011` a running Gaps scan remains visible after switching to the Chat tab at 390×844.
  10. Strategic Fit strengths: staged-proposal copy, `pending`/`stale` transitions, preflight counts, finding-queue filters, chart/table fallback, and print/export complete-list mode each have at least one asserting spec (extend existing specs where they already cover it; add where they do not).
- No `test.fixme` remains without a finding ID in its title.

**Automated tests.** This package _is_ the tests. Fixtures: `RICH_PGN` must produce ≥1 comparable Strategic Fit route so `WP-031`'s terminal-state test has a positive control.

**Manual validation.** Confirm the WebKit and Firefox runs are not flaky over three consecutive CI runs before making the job required.

**Failure and rollback.** Risk is CI flakiness blocking unrelated work. Detection: three-run soak. Mitigation: mark engine-backed specs `test.slow()` and, if WebKit proves unstable for engine tests, restrict WebKit to layout and dialog specs and record that narrowing here. Rollback: make the job non-required; do not delete it.

**Definition of done.** `pnpm -r typecheck`, `pnpm docs:check`, `pnpm check:skills` green; new CI job green on three consecutive runs across all three browsers; `AGENTS.md` command list updated; the ten checks reviewed by whoever will implement `WP-001`–`WP-014` so the criteria are agreed before they become gates.

---

### WP-001 — Responsive floor: minimum panel heights and height-aware board sizing

|                              |                                                                             |
| ---------------------------- | --------------------------------------------------------------------------- |
| **Objective**                | Make all application content reachable at 200% zoom and on short viewports. |
| **Audit findings addressed** | UX-001                                                                      |
| **Severity reduced**         | Critical → none                                                             |
| **Type**                     | Responsive layout                                                           |
| **Decision**                 | Implementation-defined                                                      |
| **Size**                     | S                                                                           |
| **Risk**                     | Low                                                                         |
| **Dependencies**             | WP-000                                                                      |
| **Blocks**                   | WP-020                                                                      |
| **Parallel with**            | WP-002 (different selectors; same file — coordinate, see §9)                |

**Current behaviour.** `styles.css:279–330` (`@media (max-width: 720px)`): `.workspace` is `display:flex; flex-direction:column; overflow:hidden`; `.board-panel` is `flex:0 0 auto`; `.board-wrap` is `width: min(var(--board-size, min(70vh, calc(100% - 26px))), calc(100% - 26px))` with `aspect-ratio: 1`; `.side-panel` and `.chat-wrap` are `flex:1 1 0; min-height:0`. With a 70vh-tall board and a wrapped top bar, the remaining space can be zero. Verified at 640×400 (≡ 200% zoom on 1280×800): `.side-panel` height **0 px**, the tab bar clipped by `overflow:hidden`, no scroll container able to reach the content.

**Target behaviour.** At every viewport in the matrix, the active panel is at least 12 rem tall and the mobile tab bar is fully visible. When the viewport is too short to satisfy that with a 70vh board, the board shrinks first; if the board reaches its 160 px floor and space is still insufficient, `.workspace` scrolls vertically. Desktop, tablet, keyboard, touch, and AT behaviour are otherwise unchanged.

**Implementation approach.**

- `apps/ui/src/styles.css` only. No TSX changes.
- Compact tier: `.board-wrap` width becomes `min(var(--board-size, min(70vh, 45dvh + 18vh, calc(100% - 26px))), calc(100% - 26px))` — the `dvh` term makes the board yield on short viewports while leaving tall phones unchanged.
- `.side-panel`, `.chat-wrap` in the compact tier: `flex: 1 1 12rem; min-height: 12rem`.
- `.workspace` in the compact tier: `overflow-y: auto; overscroll-behavior: contain` **only** below a height threshold — expressed as a second query `@media (max-width: 720px) and (max-height: 620px)`. Above that threshold the current `overflow:hidden` pinned-board behaviour is preserved exactly.
- `.mobile-tabs` gains `flex: 0 0 auto` explicitly so it is never the element that shrinks.
- Verify `boardSize` clamping in `store/layout.ts` (`BOARD_SM_MIN = 160`) still bounds the dragged value; no store change expected.

**Existing behaviour to preserve.** The pinned-board phone layout at normal phone heights (360×740, 390×844) must be pixel-identical to today. Panels stay mounted across tab switches. The dragged `--board-size` continues to win over the default and continues to be capped to the container width. `overscroll-behavior` must remain suppressed on `body`.

**Acceptance criteria.**

- At 640×400, 360×640, 720×500, and 800×450: `.side-panel` (or `.chat-wrap` when the Chat tab is active) has rendered height ≥ 192 px, and `.mobile-tabs` is fully within the viewport.
- At 360×740 and 390×844 the rendered heights of `.topbar`, `.board-wrap`, `.side-panel`, and `.mobile-tabs` are unchanged from the pre-change baseline (±2 px).
- At 640×400 the page reaches the bottom of the Analysis panel by scrolling `.workspace`, with no horizontal scroll.
- `document.documentElement.scrollWidth === clientWidth` at all four short viewports.
- Switching mobile tabs at 640×400 does not remount Chessground (assert the board element's identity is stable).

**Automated tests.** `core-layout.spec.ts`: baseline check 1 flips from `fixme` to passing; add the 360×740/390×844 no-regression assertions with recorded baseline numbers as a fixture constant.

**Manual validation.** Real iOS Safari at 200% text zoom and in landscape on a small phone; confirm the board does not jump while the URL bar shows and hides (`100dvh` interaction).

**Failure and rollback.** Regression mode: the pinned-board layout starts scrolling at normal phone heights, which would feel broken. Detection: the ±2 px baseline assertions. Rollback: revert one CSS hunk; no data implications.

**Definition of done.** Typecheck green; baseline check 1 passing on all three browsers; phone baseline assertions green; iOS manual note recorded in the PR.

---

### WP-002 — Top-bar overflow: wrapping and filename containment

|                              |                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| **Objective**                | Eliminate horizontal page scroll at every viewport width, without redesigning the top bar. |
| **Audit findings addressed** | UX-002                                                                                     |
| **Severity reduced**         | Critical → none                                                                            |
| **Type**                     | Responsive layout                                                                          |
| **Decision**                 | Implementation-defined                                                                     |
| **Size**                     | S                                                                                          |
| **Risk**                     | Low                                                                                        |
| **Dependencies**             | WP-000                                                                                     |
| **Blocks**                   | WP-017, WP-020                                                                             |
| **Parallel with**            | WP-001                                                                                     |

**Current behaviour.** `.topbar` (`styles.css:77–88`) is `display:flex; align-items:center; gap:0.75rem` with no `flex-wrap` except inside `@media (max-width: 720px)` (`styles.css:331–333`). `TopBar.tsx:24–26` renders the filename in a `<span class="moveno">` with no width constraint. Verified: at 721 px the topbar's own bounding box is 856 px wide, forcing `documentElement.scrollWidth` to 856 and dragging `.workspace` with it; the band runs 721 px → ~823 px and **widens with filename length** (at 1280 px a 78-character filename grows the bar to two rows; at 853 px it re-creates the overflow). Screenshot evidence: at 768×1024 the `Open workspace`, `Audit`, `Find`, and every `Scan` button are off-screen.

**Target behaviour.** The top bar wraps at every width. The filename truncates with an ellipsis and exposes the full name via `title` and the accessible name. No viewport in the matrix produces horizontal page scroll, with any filename length. The top bar's control set, order, and labels are unchanged — that is `WP-017`.

**Implementation approach.**

- `styles.css`: move `flex-wrap: wrap` from the 720 px query onto the base `.topbar` rule and add `row-gap: 0.4rem`; delete the now-redundant declaration in the phone query.
- New rule for the filename: `.topbar .moveno { min-width: 0; max-width: min(32ch, 40%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`.
- `TopBar.tsx`: add `title={fileName()!}` to the filename span so the full value stays reachable. No other TSX change.
- `.topbar .title` keeps `margin-right: auto` but gains `flex: 0 1 auto; min-width: 0` so it is not the element that forces the row width.

**Existing behaviour to preserve.** All nine controls remain present and in the same order. The `pointer: coarse` 44 px minimums on `.topbar button/select/input` (`styles.css:342–351`) still apply. Safe-area padding on `.topbar` is unchanged. `Cmd/Ctrl+S` behaviour is untouched.

**Acceptance criteria.**

- `documentElement.scrollWidth === clientWidth` at every 5 px step from 320 px to 2560 px, with a 120-character filename loaded, on Chromium, Firefox, and WebKit.
- At 768×1024 every top-bar control and every repertoire-section action button has a bounding box fully inside the viewport.
- The filename element's rendered width never exceeds 40% of the viewport width; its `title` equals the full filename.
- The top bar renders on one row at 1280×800 with a 20-character filename (no gratuitous wrapping at normal widths).
- `touchTargetViolations(topbar, 44)` under `hasTouch: true` remains empty.

**Automated tests.** `core-layout.spec.ts`: baseline check 2 flips to passing. Add a one-row assertion at 1280×800 to catch over-wrapping.

**Manual validation.** None beyond CI; this is a pure layout change with full automated coverage.

**Failure and rollback.** Regression mode: the bar wraps to two rows at widths where it previously fit, costing vertical space. Detection: the 1280×800 one-row assertion. Rollback: single CSS revert.

---

### WP-003 — Document-close protection: unconditional confirmation for New and Open

|                              |                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **Objective**                | Remove the silent total-loss path and make every document-replacing action state its consequence. |
| **Audit findings addressed** | UX-006 (prevention half), UX-029 (partial), UX-032 (partial)                                      |
| **Severity reduced**         | Critical → none                                                                                   |
| **Type**                     | Safety                                                                                            |
| **Decision**                 | Implementation-defined (copy per audit §6; wording is `PD-1`, see §14)                            |
| **Size**                     | S                                                                                                 |
| **Risk**                     | Low                                                                                               |
| **Dependencies**             | WP-000, WP-007 (Dialog)                                                                           |
| **Blocks**                   | WP-004                                                                                            |
| **Parallel with**            | WP-006, WP-009                                                                                    |

**Current behaviour.** `TopBar.tsx:34–44`: `New` calls `window.confirm("Discard unsaved changes and start a new repertoire?")` **only when `dirty()`**, then `clearHandle()` and `actions.newGame()`. `files.ts:94`: `openFile()` confirms on the same condition. After any successful save, `actions.markSaved()` sets `dirty` false — verified that `New` then empties the tree with no dialog, and the 400 ms autosave (`persist.ts:46`) overwrites the only IndexedDB copy. On browsers without File System Access, `saveFile()` (`files.ts:134–141`) downloads a blob and calls `markSaved()` without storing a handle, so `storedFileName()` stays null and `Reopen` never appears.

**Target behaviour.** `New`, `Open PGN`, and `Reopen` always ask before replacing the working document. The dialog names the document, states how many changes have not been exported, and offers three actions when the work is unexported (`Keep working` / `Save to file first` / `Discard and continue`) or two when it is (`Cancel` / `Continue`). On the download-fallback save path the user is told the file cannot be re-linked.

**Implementation approach.**

- New `src/components/DocumentCloseDialog.tsx` built on `Dialog` (WP-007), driven by a new signal pair in `store/files.ts`: `pendingDocumentClose: { intent: "new" | "open" | "reopen"; resume: () => void } | null`.
- Centralise the guard: a single `requestDocumentClose(intent, resume)` in `store/files.ts` replaces both `window.confirm` sites. `TopBar.tsx` calls it for `New`; `openFile()` and `reopenLast()` call it internally.
- The "unexported changes" count comes from a new derived value in `store/game.ts`: `changesSinceExport()` — increment on each `bump()` after `markSaved()`, reset in `markSaved()`. This is a counter, not a diff; it is cheap and honest.
- `Save to file first` invokes `saveFile()` and, on success, continues to `resume()`; on failure or cancel it returns to the dialog.
- Fallback-save messaging: `saveFile()` returns a discriminated result (`{ via: "handle" | "picker" | "download" }`); the download case sets a one-shot notice consumed by `WP-018`'s status area (interim: a `Toast` from WP-007's sibling work if available, otherwise an inline line under the top bar).
- `reopenLast()` (`files.ts:154–161`) gains an explicit denial branch setting a user-visible message instead of the current silent `return`.

**Existing behaviour to preserve.** The colour-picker flow after a successful open (`ColorPickerModal`, `pendingLoad`, `detectColorFromPgn`, the in-modal parse error) is unchanged — `WP-003` only gates entry into `openFile()`. `clearHandle()` must still run on `New`. Autosave must not be paused or reordered by this package.

**Acceptance criteria.**

- With `dirty() === false` and a document loaded, clicking `New` opens a dialog; the tree is unchanged until an action is chosen.
- With `dirty() === true`, the dialog offers `Keep working`, `Save to file first`, and `Discard and start new`, and names the file and the number of unexported changes.
- `Save to file first` writes the file and then completes the original intent; if the save is cancelled, the document is unchanged and the dialog remains open.
- `Open PGN` and `Reopen` present the same guard.
- Choosing `Keep working` or pressing `Escape` leaves `window.__chess.toPgn()` byte-identical.
- After a download-fallback save, a message states that the browser cannot re-link the file and names the downloaded filename.
- When `reopenLast()` permission is denied, a message is shown naming the file and offering `Open PGN`.
- The dialog satisfies the full `Dialog` contract (WP-007 acceptance criteria) — focus, Tab cycling, `Escape`, restoration, inert background, no board navigation.

**Automated tests.** `core-document.spec.ts`: clean-document `New` guarded; three-action dialog contents; save-then-continue; escape leaves PGN identical; denial branch message (mock `queryPermission`/`requestPermission` through a dev-only seam or a Playwright route stub). Store test for `changesSinceExport()` increment/reset.

**Manual validation.** Firefox and WebKit (no File System Access): confirm the download path message. Chromium with a real handle: confirm `Save to file first` writes to the same file.

**Failure and rollback.** Regression mode: a dialog appears where users expect none, or the resume callback fires twice. Detection: the byte-identical assertions and a store test that `resume` runs at most once. Rollback: revert; no persisted state is created by this package.

---

### WP-004 — Autosave snapshot ring and recovery UI

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Make the working document recoverable after a mistaken replacement or a corrupt live slot.                           |
| **Audit findings addressed** | UX-006 (recovery half)                                                                                               |
| **Severity reduced**         | Critical → none                                                                                                      |
| **Type**                     | Safety                                                                                                               |
| **Decision**                 | Product decision required for retention and presentation (`PD-2`, §14); storage mechanics are implementation-defined |
| **Size**                     | M                                                                                                                    |
| **Risk**                     | Medium — writes to the store holding the only copy of user data                                                      |
| **Dependencies**             | WP-000, WP-003                                                                                                       |
| **Blocks**                   | WP-005, WP-018                                                                                                       |
| **Parallel with**            | WP-006, WP-009, WP-011                                                                                               |

**Current behaviour.** `persist.ts` holds one IndexedDB key, `workingRepertoire` (`WORKING_REPERTOIRE_STORAGE_KEY`), written by a 400 ms-debounced effect (`startAutosave`), serialised through `autosaveTail` with a pause/flush protocol (`pauseWorkingRepertoireAutosave`, `flushWorkingRepertoire`) already used by `strategic-fit-changes.ts:754` and `strategic-fit-sidecar.ts:231`. `restoreWorking()` reads it once on mount and probes the saved path. There is exactly one slot; a replacement overwrites it within 400 ms and no prior state exists.

**Target behaviour.** The last five durable working states are retained. A `Recover` entry (in Settings, and linked from the document-close dialog) lists them with a timestamp, filename, move count, and line count, previews the selected one, and restores it as a new document. Restoring never overwrites a snapshot that has not yet been superseded. A corrupt snapshot is listed as unreadable rather than crashing the list.

**Implementation approach.**

- `store/idb.ts` unchanged (D5: additive keys in the existing `kv` store; **no version bump, no `onupgradeneeded` migration**).
- `store/persist.ts` gains: `captureSnapshot(reason: "before-replace" | "idle" | "manual")`, `listSnapshots()`, `readSnapshot(id)`, `deleteSnapshot(id)`. Writes go through `idbMutateAtomically([{ key: snapshotKey }, { key: indexKey }])` so index and payload are one transaction.
- Capture points: inside `requestDocumentClose`'s resume path (WP-003) before `newGame`/`loadPgn`/`restoreDocument`, and on a 10-minute idle timer while `dirty()`.
- Retention: ring of 5, oldest evicted, plus a hard 2 MB total budget. On `QuotaExceededError`, evict oldest and retry once; on a second failure, record `snapshotsUnavailable` and continue — **the live autosave must never fail because a snapshot failed**.
- New `src/components/RecoverDialog.tsx` on `Dialog`, opened from `SettingsDrawer` and from the document-close dialog's secondary link.
- Restore path: `restoreDocument(pgn, fileName, /* new id */ undefined)` so recovery produces a **new document identity** rather than resuming the old one — the old identity may still be bound to Strategic Fit metadata. Capture a `manual` snapshot of the current state first.
- Diagnostics for rollout: a `console.debug` line per snapshot write with reason, id, and byte size, behind the existing `import.meta.env.DEV` guard.

**Existing behaviour to preserve.** The `workingRepertoire` record keeps its exact current shape and key so a rollback to today's build reads it unchanged. The pause/flush protocol and `autosavePauseDepth` semantics are untouched; snapshot writes respect the pause. `restoreWorking()`'s path-probing (`probePath`) and its `finally { setReady(true) }` guarantee are unchanged. Strategic Fit's document-transaction pause/rollback contract (`strategic-fit-changes.ts:740–800`) must still work — verify with the existing `strategic-fit-changes.test.ts` and `strategic-fit-resumable.test.ts`.

**Acceptance criteria.**

- After `New` on a document with content, a snapshot exists containing that document's PGN, and `Recover` lists it with a timestamp, filename, move count, and line count.
- Restoring a snapshot loads its exact PGN and assigns a new `documentId`.
- The ring never holds more than five snapshots; the sixth capture evicts the oldest.
- A snapshot payload that fails `GameTree.fromPgn` is listed as "Couldn't read this snapshot" and does not throw or prevent the other entries rendering.
- Simulated `QuotaExceededError` on a snapshot write leaves `workingRepertoire` written correctly and sets a visible "snapshot history unavailable" state.
- Snapshot writes do not occur while `autosavePauseDepth > 0`.
- Loading a `workingRepertoire` record written by the pre-change build restores identically.
- Loading a post-change store in the pre-change build restores identically (extra keys ignored).

**Automated tests.** Store suite `test/persist-snapshots.test.ts`: ring eviction, atomic write (assert both keys present or neither), corrupt payload, quota degradation, pause respect, forward/backward record compatibility. Playwright `core-document.spec.ts`: `New` → `Recover` → restore round trip asserting PGN equality.

**Manual validation.** Fill storage near quota in a real browser and confirm graceful degradation. Confirm behaviour in a private/incognito window where IndexedDB may be ephemeral.

**Failure and rollback.** Highest-risk regression is a snapshot write corrupting or blocking the live slot. Detection: the pause-respect and forward/backward-compat tests, plus the DEV diagnostics. Rollback: revert the commit — the extra keys become inert data the old build ignores; **no user data is lost by reverting**. Do not delete snapshot keys on rollback.

---

### WP-005 — Undoable command model, redo, and explicit line deletion

|                              |                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Objective**                | Replace the destructive, redo-less `Ctrl+Z` with a real command history, and give deletion its own control. |
| **Audit findings addressed** | UX-005                                                                                                      |
| **Severity reduced**         | Critical → none                                                                                             |
| **Type**                     | Safety                                                                                                      |
| **Decision**                 | Implementation-defined, except the global-undo-vs-Strategic-Fit interaction (`PD-3`, §14)                   |
| **Size**                     | M                                                                                                           |
| **Risk**                     | Medium — touches every tree mutation                                                                        |
| **Dependencies**             | WP-000, WP-004, WP-007 (shortcut scopes)                                                                    |
| **Blocks**                   | WP-014                                                                                                      |
| **Parallel with**            | WP-011, WP-013, WP-016                                                                                      |

**Current behaviour.** `App.tsx:56–59` binds `Mod+Z` to `actions.undo()`. `game.ts:177–190`: at a node with children it steps the path back; at a leaf it does `parent.children.splice(index, 1)`, sets `dirty`, and bumps `version`. There is no history and no redo — verified that `Ctrl+Shift+Z` and `Ctrl+Y` are no-ops. Mutation entry points (D8): `Board.tsx:35` and `PromotionModal.tsx:29` → `play`; `suggestions.ts:92` → `applyEdit`; `suggestions.ts:181` → `appendLine`; `strategic-fit-changes.ts:779` → `applyStrategicFitSnapshot`; `strategic-fit-changes.ts:794` → `restoreStrategicFitSnapshot` (a rollback, excluded). `version()` is shared by staged-edit binding, Strategic Fit snapshot binding, and autosave (D10).

**Target behaviour.** `Ctrl+Z` undoes the last _change_ (never navigation); `Ctrl+Shift+Z` redoes. Both announce what they did. Deleting a line is an explicit action on a move, confirmed for multi-node subtrees, followed by an undo toast. Arrow keys remain pure navigation. Undo does not survive a page refresh; recovery after refresh is `Recover` (WP-004).

**Implementation approach.**

- New `src/store/history.ts` per §4.3. Each entry: `{ id, label, origin: "board" | "staged-edit" | "preview" | "strategic-fit" | "delete", beforePgn, afterPgn, beforePath, afterPath, at }`.
- `store/game.ts`: `play`, `applyEdit`, `appendLine`, `applyStrategicFitSnapshot` each capture `toPgn()` + `path()` before mutating and hand the pair to `history.record(...)` after a successful mutation. `restoreStrategicFitSnapshot` explicitly does not. `loadPgn`/`newGame`/`restoreDocument` call `history.clear()`.
- `actions.undo` is **removed** and replaced by `history.undo()`, which applies `beforePgn` through the same `applyStrategicFitSnapshot`-style publish path (parse to a new `GameTree`, set path, `bump()` a **new** revision).
- New `actions.deleteLine(path)`: removes the node and its subtree, records history, returns the removed node count for the confirmation and the toast.
- Delete entry point: a control on the focused move in the move tree (added properly in `WP-011`; until then, a `Delete this line` button in the current-line strip). Confirmation via `Dialog` only when the subtree has ≥2 nodes.
- Shortcuts registered through `store/shortcuts.ts`: `document.undo` (`Mod+Z`, global scope, not in text fields), `document.redo` (`Mod+Shift+Z` and `Mod+Y`).
- `PD-3` default: `history.undo()` refuses an entry with `origin === "strategic-fit"` and announces "This change was applied by Strategic Fit. Undo it in the Strategic Fit workspace so the check can be re-run." The entry stays on the stack and blocks earlier entries until resolved.
- Staleness consequence (D10): after undo, pending staged cards bound to the pre-undo revision become `stale` through the existing mechanism. No new code; the acceptance criteria assert it.

**Existing behaviour to preserve.** The arrow-key text-field guard (`App.tsx:55`) — reimplemented as a registry rule, with a test proving arrow keys inside the Settings model field still move the caret and not the board. `Mod+S` continues to fire inside text fields. Staged-edit revision binding and the `pending`/`accepted`/`rejected`/`stale` state machine are unchanged. The Replacement Lab's own undo and resolution-proof flow is untouched. `restoreStrategicFitSnapshot` must remain outside the stack, and `strategic-fit-changes.test.ts` and `strategic-fit-resumable.test.ts` must pass unchanged.

**Acceptance criteria.**

- For each of `play` (board drag), `play` with promotion, `acceptStagedEdit`, `acceptPreview`, and `deleteLine`: `apply → Ctrl+Z` restores the exact pre-change PGN and path; `Ctrl+Shift+Z` restores the exact post-change PGN and path.
- `version()` strictly increases across apply, undo, and redo (never decreases).
- `Ctrl+Z` with an empty stack does nothing and announces nothing; it never changes `currentPath()`.
- `ArrowLeft`/`ArrowRight` never create a history entry.
- After `loadPgn`, `newGame`, or `restoreDocument`, `canUndo()` is false.
- A staged edit created at revision _r_, followed by an unrelated mutation and an undo, is reported `stale` and cannot be accepted.
- `Ctrl+Z` on a Strategic-Fit-authored revision does not change the tree and announces the Lab-pointing message.
- Deleting a subtree of ≥2 nodes shows a confirmation naming the first move and the number of continuations; deleting a single leaf does not.
- After a delete, a toast offers `Undo`; activating it restores the exact subtree.
- History does not survive a page reload (`canUndo()` is false after reload) and the document is restored from autosave as before.
- The 51st recorded mutation evicts the first; total retained PGN bytes stay under 2 MB.

**Automated tests.** `test/history.test.ts`: round trips per mutation kind, revision monotonicity, clear-on-replace, eviction, byte cap, Strategic-Fit refusal. Playwright `core-keyboard.spec.ts`: baseline check 6 flips to passing; arrow-key-in-text-field regression; delete confirmation and toast.

**Manual validation.** Drag-play a long sequence and undo repeatedly, watching for Chessground desync (the board syncs from `fen()` via `createEffect`, so this should hold, but it is the most likely visual regression).

**Failure and rollback.** Regression modes: a wrong inverse silently altering the tree; Chessground desync after undo; staged cards not going stale. Detection: the round-trip suite runs on every mutation kind; add an invariant assertion in DEV that `history.undo()` produces a PGN equal to the recorded `beforePgn`. Rollback: revert; history is in-memory so nothing persists. Note that reverting restores the destructive `Ctrl+Z` — if `WP-005` is reverted, also revert `WP-014` if merged.

---

### WP-006 — Global accessibility and interaction policy

|                              |                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Promote the accessibility rules that exist only inside Strategic Fit to application scope, and stop suppressing text selection app-wide. |
| **Audit findings addressed** | UX-025, UX-026, UX-027, UX-014 (policy half)                                                                                             |
| **Severity reduced**         | UX-025 High → none; UX-026/027 Medium → none; UX-014 High → Medium (structural half lands in WP-011)                                     |
| **Type**                     | Accessibility                                                                                                                            |
| **Decision**                 | Implementation-defined                                                                                                                   |
| **Size**                     | S                                                                                                                                        |
| **Risk**                     | Low, with one touch-regression watch item                                                                                                |
| **Dependencies**             | WP-000                                                                                                                                   |
| **Blocks**                   | WP-007, WP-011, WP-012, WP-036                                                                                                           |
| **Parallel with**            | WP-001, WP-002, WP-003, WP-009                                                                                                           |

**Current behaviour.** All 34 `:focus-visible` rules are scoped to `.strategic-fit-*` / `.replacement-*` selectors; the core app relies on the UA default (measured `outline: auto 1px`). `@media (prefers-reduced-motion: reduce)` appears at `styles.css:4872` and `:5424`, both Strategic-Fit-scoped; `Board.tsx:39` sets Chessground `animation: { enabled: true, duration: 120 }` unconditionally. `@media (forced-colors: active)` appears at `:4890`, `:5028`, `:5161`, `:5302`, all Strategic-Fit-scoped. `body` sets `-webkit-touch-callout: none; -webkit-user-select: none; user-select: none` (`styles.css:20–31`) with text-select restored only for `input`, `textarea`, `[contenteditable]` (`:34–40`); `img` and `.cg-wrap .piece` additionally set `-webkit-user-drag: none` (`:42–47`). `@media (pointer: coarse)` (`:342–351`) raises exactly six selectors to 44 px.

**Target behaviour.** One visible focus style everywhere. Motion respects the OS preference, including the board. Forced-colors rules apply to core status indicators. Analysis output (FEN, SAN, evaluations, error text, chat messages, report identifiers) is selectable and copyable everywhere; only genuine gesture surfaces suppress selection. A target-size floor applies to every interactive element.

**Implementation approach.**

- `styles.css` only, plus one line in `Board.tsx`.
- Add `:root` declarations `--focus-ring: 2px solid var(--accent)`, `--focus-offset: 2px`, `--target-min: 24px`, `--target-touch: 44px`, `--motion-fast: 120ms`, `--motion-slow: 200ms` (these become part of `WP-036`'s token block later; defining them here avoids writing the rules twice).
- Global `:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }`. Leave the Strategic Fit rules in place for now; `WP-036` deduplicates them.
- Promote a global `@media (prefers-reduced-motion: reduce)` block disabling transitions and animations app-wide, and set `--motion-fast/slow` to `0ms`.
- `Board.tsx`: `animation: { enabled: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, duration: 120 }`, plus a `change` listener calling `cg.set({ animation: { enabled } })`.
- Promote a global `@media (forced-colors: active)` block covering `.sev-*`, `.fit-*`, `.eval-bar`, `.scan-bar-fill`, `.tool-run`, `.mobile-tabs button.active`, and the divider hover state, with `forced-color-adjust: auto` and non-colour differentiators where a colour currently carries meaning.
- Invert selection: remove `user-select: none` from `body`; add it to `.cg-wrap`, `.topbar`, `.mobile-tabs`, `.divider`, `.eval-bar`, and `.mobile-tabs button`. **Keep** `-webkit-touch-callout: none` on `body` and **keep** all three drag suppressions (`img`, `.cg-wrap .piece`, `-webkit-user-drag`) exactly as they are (D14).
- Expand `@media (pointer: coarse)` to a generic rule: every `button, select, summary, [role="tab"], a[href], input:not([type="range"])` inside `.app-main` gets `min-height: var(--target-touch)`. Add a base rule with `var(--target-min)` for fine pointers. Where a control is visually small by design (`.collapse-toggle`, `.inspect-btn`), reach the floor with padding and a transparent hit area, not font size.

**Existing behaviour to preserve.** Board dragging on touch must be unaffected — the `-webkit-user-drag` and callout suppressions are why long-press does not open a context menu over a piece. `overscroll-behavior: none` on `body` stays. Strategic Fit's own reduced-motion, forced-colors, and focus rules keep working (they will be redundant, not contradictory). The 16 px font floor on `.chat-input textarea` and `.field input` (iOS zoom prevention) stays.

**Acceptance criteria.**

- Every focusable element in the app renders a 2 px accent outline on keyboard focus, verified at a sample of ten elements across the top bar, panels, chat, and Strategic Fit.
- With `prefers-reduced-motion: reduce` emulated, playing a move produces no piece animation and no CSS transition is active on `.divider`, `.eval-bar .fill`, or `.strategic-fit-region-spinner`.
- With `forced-colors: active` emulated, gap severity, engine-line fit, mobile tab selection, and scan progress are each distinguishable without colour.
- `window.getSelection()` can select text inside `.result-card`, `.chat-log .msg`, `.analysis .line`, `.rep-row`, `.chat-error`, and the Strategic Fit evidence panel; a `document.execCommand`-free copy of a FEN string succeeds.
- Text selection is **not** possible by dragging on `.cg-wrap`.
- Dragging a piece on a touch emulation still moves it and does not open a callout.
- `touchTargetViolations(app, 24)` is empty at 1280×800; `touchTargetViolations(app, 44)` is empty under `hasTouch: true` — **except** for elements listed in an explicit, reviewed exclusion list which must be empty for this package to pass (i.e. no exclusions granted).
- Panel heights at 1280×800 grow by no more than 15% versus baseline (density guard).

**Automated tests.** `core-a11y.spec.ts` using the extended `helpers/accessibility.ts`; Playwright emulation for `reducedMotion` and `forcedColors`; a selection test using `page.evaluate` over `getSelection()`; the density guard as a measured assertion with baseline constants.

**Manual validation.** Real iOS Safari: piece drag, long-press over a piece, and text selection in the chat log. Windows High Contrast mode: the core status indicators.

**Failure and rollback.** Regression modes: touch drag broken by the selection inversion; panels visibly taller from the target floors. Detection: the drag test and the density guard. Rollback: the selection inversion and the target floors are separate CSS hunks and can be reverted independently — keep them as separate commits within the PR.

---

### WP-007 — `Dialog` primitive, overlay migration, and shortcut-scope registry

|                              |                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Objective**                | One correct modal contract for every overlay, and one place that decides when a global shortcut may fire. |
| **Audit findings addressed** | UX-007, UX-019, UX-045                                                                                    |
| **Severity reduced**         | Critical → none (UX-007); High → none (UX-019); Medium → none (UX-045)                                    |
| **Type**                     | Architecture + Accessibility                                                                              |
| **Decision**                 | Implementation-defined                                                                                    |
| **Size**                     | M                                                                                                         |
| **Risk**                     | Medium — focus behaviour regressions are easy to introduce and hard to see                                |
| **Dependencies**             | WP-000, WP-006                                                                                            |
| **Blocks**                   | WP-003, WP-004, WP-005, WP-008, WP-033                                                                    |
| **Parallel with**            | WP-009, WP-010, WP-011                                                                                    |

**Current behaviour.** `SettingsDrawer.tsx` renders `.drawer-backdrop` / `.drawer` with a close `✕` and a backdrop click; no `role`, no `aria-modal`, no focus management, no `Escape`. Verified: ten consecutive `Tab` presses with the drawer open all landed **outside** the drawer while it stayed open; `Escape` did not close it; `ArrowRight` moved the board from path `[0]` to `[0,0]`. `PromotionModal.tsx` and `ColorPickerModal.tsx` have the same shape; the promotion buttons render bare glyphs with no accessible name, and a backdrop click cancels destructively. `StrategicFitWorkspace.tsx:347–408` implements the correct pattern (capture `document.activeElement`, `FOCUSABLE` selector list, capture-phase `keydown` with Tab cycling and `Escape`, focus the close button on mount, restore on cleanup) and `App.tsx:70–74` applies `inert` + `aria-hidden` to `.app-main`. `StrategicFitWorkspace.tsx:417` sets `aria-hidden` on the workspace when the Replacement Lab opens **without** `inert`. `App.tsx:45–65` is the single global key handler; its only modal awareness is `if (strategicFitWorkspaceOpen()) return`.

**Target behaviour.** Opening any overlay moves focus into it, keeps focus inside, closes on `Escape`, restores focus to the invoking control, makes the background inert and hidden from assistive technology, and suspends global document shortcuts. Promotion pieces have names. Destructive backdrop dismissal is removed where dismissal discards work.

**Implementation approach.**

- New `src/components/primitives/Dialog.tsx` per §4.1, extracting `trapFocus`, `FOCUSABLE`, and the return-focus logic from `StrategicFitWorkspace.tsx` **without changing that component yet**.
- New `src/store/shortcuts.ts` per §4.2. `App.tsx`'s inline handler is replaced by registrations: `document.save` (`Mod+S`, `allowInTextFields: true`), `position.back` / `position.forward` (arrows), and later `document.undo`/`redo` from `WP-005`. `Dialog` pushes a `modal` scope on open and disposes it on close.
- `StrategicFitWorkspace` replaces its `strategicFitWorkspaceOpen()` early return with a `workspace` scope push. Its own trap stays for now; `WP-033` migrates it onto the primitive.
- `SettingsDrawer` → `Dialog size="drawer"`, `dismissOnBackdrop: true`, title "Settings".
- `ColorPickerModal` → `Dialog size="compact"`, `dismissOnBackdrop: false` (backdrop click currently discards a parsed file), explicit `Cancel` retained, `initialFocus` on the detected colour button, error text wired via `aria-describedby` and `role="alert"`.
- `PromotionModal` → `Dialog size="compact"`, `dismissOnBackdrop: true` mapped to "cancel the move" with the dialog title stating it ("Promote pawn — dismiss to cancel the move"), each button `aria-label`ed `Promote to queen` etc.
- Fix `UX-045`: add `inert` alongside the existing `aria-hidden` on `.strategic-fit-workspace` when the Lab is open.
- `styles.css`: `--z-overlay`/`--z-dialog` applied to the backdrop/dialog layers, replacing the ad-hoc `z-index: 100` / `120`.

**Existing behaviour to preserve.** The Strategic Fit workspace's current focus behaviour must be byte-for-byte equivalent after the scope change — `strategic-fit-accessibility.spec.ts` and `strategic-fit-workspace.spec.ts` must pass unchanged. `Mod+S` must still fire from inside the chat textarea. The colour-picker's detection, hint text, and in-modal parse error must all survive. The promotion flow's board revert (the `pendingPromo()` dependency in `Board.tsx:55`) must still work when the modal is dismissed.

**Acceptance criteria.**

- For each of Settings, Promotion, and Colour picker: opening moves focus to the dialog's first interactive control or its heading; `Tab` and `Shift+Tab` cycle within it; `Escape` closes it; closing restores focus to the invoking control; `.app-main` has `inert` and `aria-hidden="true"` while it is open.
- While any dialog is open, `ArrowLeft`/`ArrowRight` leave `window.__chess.currentPath()` unchanged, and `Mod+Z` leaves `toPgn()` unchanged.
- `Mod+S` from inside the chat textarea still saves and does not clear the textarea.
- Each promotion button exposes an accessible name of the form "Promote to <piece>".
- A backdrop click on the colour picker does **not** discard the pending load; `Cancel` does.
- Dismissing the promotion dialog reverts the optimistic board move.
- When the Replacement Lab is open, `.strategic-fit-workspace` has both `inert` and `aria-hidden="true"`.
- `basicAccessibilityViolations` returns an empty array for each dialog root.
- All 22 pre-existing Strategic Fit specs pass unchanged.

**Automated tests.** `core-dialogs.spec.ts` — one parameterised contract suite over the three overlays (baseline check 5 flips to passing). Store test for `shortcuts.ts` scope stacking and the text-field rule. Extend `strategic-fit-accessibility.spec.ts` with the `inert` assertion for `UX-045`.

**Manual validation.** VoiceOver (macOS/iOS) and NVDA (Windows): confirm the dialog is announced as a dialog with its name, and that the background is not reachable by virtual-cursor navigation. This is an accessibility review gate (§13, gate AG-1).

**Failure and rollback.** Regression modes: focus lost to `<body>` on close; the Strategic Fit trap double-handling `Escape` after the scope change; the promotion revert breaking. Detection: the contract suite plus the untouched Strategic Fit specs. Rollback: revert; the three overlays return to their current (broken but familiar) behaviour with no data impact.

---

### WP-008 — Keyboard command registry surface and shortcut help

|                              |                                                       |
| ---------------------------- | ----------------------------------------------------- |
| **Objective**                | Make shortcuts discoverable and their scope explicit. |
| **Audit findings addressed** | UX-044                                                |
| **Severity reduced**         | Medium → none                                         |
| **Type**                     | Accessibility + Content                               |
| **Decision**                 | Implementation-defined                                |
| **Size**                     | S                                                     |
| **Risk**                     | Low                                                   |
| **Dependencies**             | WP-007, WP-024 (labels)                               |
| **Blocks**                   | none                                                  |
| **Parallel with**            | WP-013, WP-015, WP-018                                |

**Current behaviour.** Shortcuts exist only in `App.tsx:45–65`. No help sheet, no tooltip listing keys, no customisation, no mention in Settings.

**Target behaviour.** `?` (and a Settings entry, and a top-bar overflow-menu entry) opens a dialog listing every registered shortcut grouped by scope, showing platform-correct key names (`⌘` vs `Ctrl`), and stating which are active only in a particular context. Customisation is explicitly out of scope and stated as such.

**Implementation approach.** New `src/components/ShortcutHelpDialog.tsx` rendering `activeShortcuts()` from `store/shortcuts.ts`, grouped by `scope`, labels from `content/index.ts`. Platform detection from `navigator.platform`/`userAgentData`. Register `app.help` (`?`, global scope, not in text fields).

**Existing behaviour to preserve.** Registering the help shortcut must not shadow `?` typed into the chat textarea or any input.

**Acceptance criteria.**

- Pressing `?` with focus on the document body opens the shortcut dialog; pressing `?` inside the chat textarea types a question mark and does not open it.
- The dialog lists at minimum: save, undo, redo, previous move, next move, help — each with a human label and the platform-correct key.
- Shortcuts registered by a modal scope are not listed while no modal is open.
- The dialog satisfies the `Dialog` contract.

**Automated tests.** Playwright: `?` behaviour in and out of a text field; list contents assertion; contract suite inclusion.

**Manual validation.** None beyond CI.

**Failure and rollback.** Low risk; revert removes the dialog and the `?` registration.

---

### WP-009 — Application live region and announcement policy

|                              |                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Objective**                | Give assistive-technology users confirmation that operations started, finished, failed, or were undone. |
| **Audit findings addressed** | UX-012                                                                                                  |
| **Severity reduced**         | High → none                                                                                             |
| **Type**                     | Accessibility                                                                                           |
| **Decision**                 | Implementation-defined; the announcement inventory is a review gate (§13, AG-5)                         |
| **Size**                     | S                                                                                                       |
| **Risk**                     | Low, with an over-announcement watch item                                                               |
| **Dependencies**             | WP-000                                                                                                  |
| **Blocks**                   | WP-010, WP-018                                                                                          |
| **Parallel with**            | WP-003, WP-006, WP-007                                                                                  |

**Current behaviour.** Verified by grep: the entire non-Strategic-Fit UI contains five `role="status"`/`role="alert"` usages — two metadata warnings in `App.tsx`, the depth notice in `TopBar.tsx:71`, the staged-preview label in `RepertoirePanel.tsx:162`, and the chat `ErrorResult` card. Nothing announces a save, a restore, a scan starting or finishing, an engine state change, a mutation, or a chat tool completing.

**Target behaviour.** One polite and one assertive region at the app root. Every event in the policy list produces exactly one message. Progress ticks and streaming tokens produce none.

**Implementation approach.** New `src/store/announce.ts` (queue, 500 ms rate limit, consecutive de-duplication) and `src/components/AppLiveRegion.tsx` mounted in `App.tsx` outside `.app-main` so it is never inside an `inert` subtree. Initial wiring: `files.saveFile` success/failure, `persist.restoreWorking` success, `analysis` engine offline, `commands.executeCommand` start/complete/cancel/fail. Chat and scan wiring lands with `WP-010`.

**Existing behaviour to preserve.** The existing `role="alert"` metadata warnings stay — they are visible text, not duplicated announcements; ensure they are not also pushed through `announce()`.

**Acceptance criteria.**

- The polite and assertive regions exist at the app root, outside any element that receives `inert`.
- Saving a file produces exactly one polite message naming the file.
- Restoring from autosave on load produces exactly one polite message.
- Starting and completing a repertoire scan produce exactly one message each; intermediate progress updates produce none.
- Two identical messages within 500 ms produce one announcement.
- Streaming chat text produces no announcements.
- Errors route to the assertive region; everything else to the polite region.

**Automated tests.** Playwright reads the live-region text content after each triggering action and asserts message counts (baseline check 7). Store test for de-duplication and rate limiting.

**Manual validation.** NVDA and VoiceOver: confirm messages are spoken once and are not interrupted by the next one. Gate AG-5.

**Failure and rollback.** Regression mode: announcement storms during scans. Detection: the "no message per progress tick" assertion. Rollback: revert; no persisted state.

---

### WP-010 — Operation registry

|                              |                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Objective**                | One authoritative answer to "what is running right now?", so status can be shown wherever the user is looking. |
| **Audit findings addressed** | Enables UX-011, UX-040; supports UX-012                                                                        |
| **Severity reduced**         | — (enabler; severity reduction lands in WP-013 and WP-027)                                                     |
| **Type**                     | Architecture                                                                                                   |
| **Decision**                 | Implementation-defined                                                                                         |
| **Size**                     | M                                                                                                              |
| **Risk**                     | Low                                                                                                            |
| **Dependencies**             | WP-000, WP-009                                                                                                 |
| **Blocks**                   | WP-013, WP-019, WP-027                                                                                         |
| **Parallel with**            | WP-011, WP-012, WP-016                                                                                         |

**Current behaviour.** Eight independent running-state signals with no common shape: `gaps.ts:38` `scanning`; `repertoire.ts:27` `bridgeScanning`, `:59` `pruneScanning`, `:122` `inspecting`, `:183` `compScanning`; `commands.ts:35` `commandStates` (7 commands, `status`/`progress`/`error`); `chat.ts:19` `toolRuns` (reset on every `send()` at `chat.ts:172`); `analysis.ts:37` `analysing`. `application/execution-status.ts` defines a shared `ExecutionStatus` type consumed by `chat.ts` and `commands.ts` but nothing aggregates.

**Target behaviour.** No user-visible change in this package. A single `operations()` list reflects every running, queued, recently-completed, cancelled, or failed operation with a human label and, where the owner supports it, a `cancel` callback.

**Implementation approach.** New `src/store/operations.ts` per §4.5. Migration is store-by-store and additive within each PR: register on start, patch on progress, settle on completion, then delete the local signal and repoint its consumers in the same change. Recently-settled operations linger 8 s so the activity strip can show completion. `announce()` is called from the registry, not from each store — this is why `WP-009` comes first.

**Existing behaviour to preserve.** Every existing cancel path keeps working: `gaps.cancelScan`, `repertoire.cancelPrune`, `commands.cancelCommand`, `chat.stop`. `commands.ts`'s `AbortController` map and its `if (controllers.get(command) === controller)` guard stay in the owning store. `chat.ts`'s per-turn `toolRuns` reset semantics are preserved until `WP-027` deliberately changes them.

**Acceptance criteria.**

- `operations()` contains an entry for each of: a running Gaps scan, a running direct command, a running chat tool call, and a live analysis pass.
- Cancelling through each existing control removes the operation from the running set within 200 ms and marks it `cancelled`.
- A completed operation remains listed for 8 s with status `completed`, then disappears.
- No `*scanning` boolean remains exported from `gaps.ts` or `repertoire.ts` after migration; `grep -c "Scanning" src/store` returns 0.
- Existing cancellation tests (`test/cancellation.test.ts`) pass unchanged.
- Announcements fire once per operation start and once per settle.

**Automated tests.** `test/operations.test.ts` for registration, settle, linger, eviction. Extend `test/cancellation.test.ts` with registry assertions. Playwright: a running scan appears in `operations()` via `window.__chess` (extend the dev handle with `operations`).

**Manual validation.** None.

**Failure and rollback.** Regression mode: a store forgets to settle, leaving a permanent "running" entry. Detection: an operations test per store plus a DEV warning if an operation exceeds 10 minutes. Rollback: per-store revert is possible because migration is store-by-store.

---

### WP-011 — `InteractiveRow` and `MoveButton`: keyboard-operable rows and move tree

|                              |                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Objective**                | Make every result row and every move reachable and activatable from the keyboard, at a usable target size. |
| **Audit findings addressed** | UX-004, UX-014 (structural half)                                                                           |
| **Severity reduced**         | Critical → none (UX-004); Medium → none (UX-014)                                                           |
| **Type**                     | Accessibility + Architecture                                                                               |
| **Decision**                 | Implementation-defined for rows; the move-tree traversal model is design-validation (`DV-2`, §14)          |
| **Size**                     | M                                                                                                          |
| **Risk**                     | Medium — nine call sites and a density-regression risk                                                     |
| **Dependencies**             | WP-000, WP-006                                                                                             |
| **Blocks**                   | WP-015, WP-022, WP-029                                                                                     |
| **Parallel with**            | WP-007, WP-010, WP-016                                                                                     |

**Current behaviour.** `RepertoirePanel.tsx` renders click-only `<div class="rep-row">` at lines 137, 176, 189, 207, 215, 253, 276, 300, 330, and 396, plus `<button class="fix-btn">` at 14 px tall and `<button class="scan-btn">` at 20 px. `MoveTree.tsx:67–76` renders moves as `<span class="move" onClick>`; verified 11 moves, 0 focusable. `.rep-row` is `padding: 0.25rem 0; font-size: 0.82rem` (`styles.css:834–842`). `.collapse-toggle` is an 18 px `<button>`. `ToolResult.tsx:83` renders `.result-nav` as a real button already.

**Target behaviour.** Every row is a real button, reachable by `Tab`, activatable by `Enter` and `Space`, at least 24 px tall (44 px on coarse pointers), with its selected state exposed as `aria-current`. The move tree is a `role="tree"` with `role="treeitem"` moves: `Tab` enters the tree once, arrow keys traverse it, `Enter` navigates the board to the move, and branch toggles expose `aria-expanded`. Existing row information density is preserved — targets grow through padding and hit-area, not through layout expansion.

**Implementation approach.**

- New `src/components/primitives/InteractiveRow.tsx` and `src/components/primitives/MoveButton.tsx` per §4.8.
- `RepertoirePanel.tsx`: replace all ten `.rep-row` sites. Rows with a secondary action (`Fill this`, the `?` inspect button) render the secondary as a **sibling** button in a flex container, never nested — a nested button is invalid HTML and the current `e.stopPropagation()` pattern (`RepertoirePanel.tsx:341`) disappears with it.
- `MoveTree.tsx`: moves become `MoveButton`; the recursive `renderLine` gains `role="tree"`/`role="group"` wrappers; a roving-tabindex model gives the tree one tab stop; arrow-key handling lives in `MoveTree` (`↑`/`↓` previous/next sibling at the same depth, `→` into a variation group, `←` out to the parent, `Home`/`End` to first/last, `Enter` to navigate). Collapse toggles get `aria-expanded` and `aria-controls`.
- `focusLine(path)` (the chat context marker, `MoveTree.tsx:64`) must still fire on activation.
- `styles.css`: `.rep-row` and `.move` get `min-height: var(--target-min)` and padding-based hit areas; remove `cursor: pointer` on the containers (buttons carry it natively).
- `DV-2` prototype gate: the arrow-key model above is the proposal; validate with two repertoire builders before finalising `→`/`←` semantics (variation entry vs move advance is genuinely ambiguous in chess move lists).

**Existing behaviour to preserve.** Row content and one-line density (`severity · line · eval`) exactly as today — the audit explicitly calls this productive density. Branch collapse state (session-only, keyed by parent index path) and the "never collapse a branch containing the current node" rule (`MoveTree.tsx:95`). The current-line strip and its horizontal scrolling. `previewedKeys()` glow highlighting. `stagePreviewLine` staging from fill rows and Extend rows. The gold preview arrow.

**Acceptance criteria.**

- `keyboardReachable` reports zero unreachable elements among `.rep-row` equivalents and move items.
- `Enter` and `Space` on a repertoire row perform the same action as a click (navigate, or stage a preview).
- The move tree has exactly one tab stop; entering it focuses the current move; `↑ ↓ ← → Home End` traverse without changing the board; `Enter` navigates the board and appends the chat focus marker.
- The current move exposes `aria-current="true"`; branch toggles expose `aria-expanded` matching their state.
- `touchTargetViolations(repertoirePanel, 24)` and `touchTargetViolations(moveTree, 24)` are empty at 1280×800; both are empty at 44 px under `hasTouch: true`.
- The repertoire panel's rendered height at 1280×800 with Gaps expanded and 8 rows grows by no more than 15% versus baseline.
- No `<button>` is nested inside another `<button>` anywhere in the app.
- `basicAccessibilityViolations(sidePanel)` is empty.

**Automated tests.** `core-keyboard.spec.ts` (baseline check 4 flips to passing); a move-tree traversal spec with a branching fixture; density guard assertions; a DOM validity assertion for nested buttons.

**Manual validation.** Screen-reader pass over the move tree — tree semantics are frequently mis-announced and this is accessibility gate AG-3. Touch pass on a real phone for row activation.

**Failure and rollback.** Regression modes: row click handlers that relied on event bubbling from a child; the collapse toggle firing row navigation; panels growing too tall. Detection: the density guard, the nested-button assertion, and per-section click tests. Rollback: `MoveTree` and `RepertoirePanel` migrations should be separate commits so either can be reverted alone.

---

### WP-012 — Keyboard-operable, resettable dividers

|                              |                                                                       |
| ---------------------------- | --------------------------------------------------------------------- |
| **Objective**                | Give panel resizing a non-drag alternative and a recovery affordance. |
| **Audit findings addressed** | UX-013                                                                |
| **Severity reduced**         | High → none                                                           |
| **Type**                     | Accessibility                                                         |
| **Decision**                 | Implementation-defined                                                |
| **Size**                     | S                                                                     |
| **Risk**                     | Low                                                                   |
| **Dependencies**             | WP-000, WP-006                                                        |
| **Blocks**                   | none                                                                  |
| **Parallel with**            | WP-010, WP-011, WP-013                                                |

**Current behaviour.** `Divider.tsx` renders a `<div role="separator" aria-orientation>` with pointer handlers only — no `tabindex`, no `aria-valuenow`/`valuemin`/`valuemax`, no key handling. `styles.css:192–229`: `.divider` is 5 px wide, `.divider-h` 14 px tall, both `touch-action: none`. Verified: a double-click does not reset (widths stayed 240/360). `store/layout.ts` clamps side and chat to `[240, 800]` and reflows on window resize; `BOARD_MIN = 300` protects the board.

**Target behaviour.** Each divider is a focusable separator. `←`/`→` (or `↑`/`↓` for the horizontal one) move it by 16 px, `Shift` by 64 px, `Home`/`End` jump to the clamped minimum/maximum, and `Enter` or a double-click resets to the default. Values are exposed to assistive technology. The visual width stays 5 px while the hit area grows to 12 px.

**Implementation approach.** `Divider.tsx` gains `tabIndex={0}`, `aria-valuenow/min/max`, `aria-label` from the content registry ("Resize the analysis panel"), a `onKeyDown` handler calling the same `onResize` delta path, and an `onDblClick` calling a new `onReset`. `store/layout.ts` gains `resetLayout()` and `resetBoard()` restoring `SIDE_DEFAULT`/`CHAT_DEFAULT`/auto. `styles.css`: `.divider` keeps `width: 5px` visually but gains `position: relative` with a `::before` pseudo-element extending the hit area to 12 px; `.divider-h` reaches 24 px the same way.

**Existing behaviour to preserve.** The 240 px minimum panel width (`MIN_PX`) and the `BOARD_MIN` floor — the audit calls these out as an existing strength preventing unrecoverable collapse. The single-write-per-gesture `persistLayout()` on pointerup. The phone board resizer's clamping to the container width.

**Acceptance criteria.**

- Each visible divider is reachable by `Tab` and reports `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and an accessible name.
- `ArrowLeft`/`ArrowRight` change the adjacent panel width by 16 px per press and persist on keyup; `Shift` modifies by 64 px; `Home`/`End` reach the clamped bounds.
- `Enter` and double-click both restore the default widths.
- The panel width never goes below 240 px or above 800 px by any input path.
- `touchTargetViolations` treats the divider hit area as ≥24 px wide (44 px under `hasTouch`).
- Pointer dragging behaves exactly as before, including pointer capture when the cursor leaves the element.

**Automated tests.** `core-keyboard.spec.ts`: focus, each key, bounds, reset, persistence across reload. A pointer-drag regression test asserting the existing clamp behaviour.

**Manual validation.** Touch drag on a real phone for the horizontal board resizer.

**Failure and rollback.** Regression mode: the enlarged hit area intercepting clicks meant for adjacent panels. Detection: a click-through test on the first row of each adjacent panel. Rollback: single-file revert.

---

### WP-013 — Mobile tab semantics, state indicators, and the activity strip

|                              |                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Objective**                | Make the mobile tabs a correct tab pattern and stop hiding running work behind the inactive tab. |
| **Audit findings addressed** | UX-011                                                                                           |
| **Severity reduced**         | High → none                                                                                      |
| **Type**                     | Accessibility + Workflow                                                                         |
| **Decision**                 | Implementation-defined                                                                           |
| **Size**                     | M                                                                                                |
| **Risk**                     | Low                                                                                              |
| **Dependencies**             | WP-000, WP-009, WP-010                                                                           |
| **Blocks**                   | none                                                                                             |
| **Parallel with**            | WP-011, WP-012, WP-015                                                                           |

**Current behaviour.** `MobileTabs.tsx` renders `role="tablist"` with three `role="tab"` buttons carrying `aria-selected` and a class — verified at runtime with `aria-controls: null` and `id: ""` on all three, no `role="tabpanel"` on any target, no roving tabindex, no arrow-key handling. Panels are shown and hidden purely by `styles.css:318–330` toggling `display` on `.move-tree`, `.analysis`, `.rep-panel`, and `.chat-wrap` from `.workspace[data-mtab]`. Verified: with a Gaps scan running, switching to the Chat tab hides every progress indicator and the labels do not change.

**Target behaviour.** A complete tab pattern: ids, `aria-controls`, `role="tabpanel"` with `aria-labelledby`, roving tabindex, `←`/`→`/`Home`/`End` traversal, and `Tab` moving from the tablist into the active panel. Each tab label carries a state indicator: a dot when the panel owns a running operation, a count when it holds unseen results. A one-line activity strip above the tabs names the running operation and offers cancel, so status is never invisible.

**Implementation approach.**

- `MobileTabs.tsx`: add stable ids (`mtab-analysis` etc.), `aria-controls`, roving tabindex, and keyboard handling matching the pattern already correct in `StrategicFitWorkspace.tsx:325–342` (reuse its `selectStageFromKeyboard` shape).
- `App.tsx`: add `id` and `role="tabpanel"` + `aria-labelledby` to the three tab targets. Because a tab panel is `.side-panel` for two tabs (Analysis and Moves show different children of the same element), introduce two wrapper elements inside `.side-panel` rather than moving the panels — this keeps them mounted, which is a preserved behaviour.
- New `src/components/ActivityStrip.tsx` reading `operations()` (WP-010), rendered above `MobileTabs` in the compact tier and in the top bar's second row in wide tiers.
- Tab indicators derive from `operations()` grouped by `surface`.
- `styles.css`: indicator dot and count styling; the strip is `flex: 0 0 auto` so it never competes with the panel minimum from `WP-001`.

**Existing behaviour to preserve.** Panels stay mounted; the `display`-toggling mechanism is not replaced by conditional rendering. Chessground is never re-initialised on a tab switch. The chat log keeps its scroll position across switches.

**Acceptance criteria.**

- Each tab has a unique `id` and an `aria-controls` referencing an element with `role="tabpanel"` and a matching `aria-labelledby`.
- Exactly one tab has `tabindex="0"`; `←`/`→` wrap; `Home`/`End` jump; the arrow keys do not change the chess position.
- With a Gaps scan running, switching to the Chat tab keeps a visible indicator on the Analysis tab and the activity strip names the running scan with a working cancel control (baseline check 9 flips to passing).
- Switching tabs does not remount Chessground (board element identity stable) and preserves the chat log scroll position.
- `basicAccessibilityViolations(workspace)` is empty at 390×844.
- The activity strip occupies no vertical space when nothing is running.

**Automated tests.** `core-status.spec.ts` for the cross-tab visibility and cancel; a tablist keyboard spec; element-identity assertions for mount preservation.

**Manual validation.** Screen reader on a real phone — tab patterns are commonly mis-announced (gate AG-2).

**Failure and rollback.** Regression modes: the wrapper elements changing the compact layout; the strip eating panel height. Detection: the `WP-001` height assertions re-run here. Rollback: single revert.

---

### WP-014 — Board keyboard layer

|                              |                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| **Objective**                | Make the primary task — reading and playing moves on the board — operable without a pointer. |
| **Audit findings addressed** | UX-003                                                                                       |
| **Severity reduced**         | Critical → none                                                                              |
| **Type**                     | Accessibility                                                                                |
| **Decision**                 | **Design validation required** (`DV-1`, §14) before implementation                           |
| **Size**                     | L                                                                                            |
| **Risk**                     | High — a new interaction surface over Chessground's pointer handling                         |
| **Dependencies**             | WP-000, WP-005, WP-007, WP-009                                                               |
| **Blocks**                   | none                                                                                         |
| **Parallel with**            | WP-015 onwards                                                                               |

**Current behaviour.** `Board.tsx:92–95` renders `<div class="board-wrap"><div ref class="cg-wrap" /></div>`. Verified: `tabindex` null, `role` null, `aria-label` null, zero focusable descendants; the only text content is Chessground's coordinate labels. Moves are made by `movable.events.after` (`Board.tsx:32–37`), which routes promotions to `setPendingPromo` and everything else to `actions.play`. The board is re-synced by a `createEffect` reading `fen()`, `color()`, `turnColor()`, `lastMove()`, `dests()`, and `pendingPromo()`.

**Target behaviour (proposal to validate).** The board is a single tab stop exposing `role="application"` with an accessible name describing the position summary. Entering it places a square cursor on the last-moved square (or e1/e8). Arrow keys move the cursor; `Enter` selects the piece on the cursor square and announces its legal destinations; a second `Enter` on a legal destination plays the move; `Escape` clears the selection; `Shift+?` reads the position. Each square is described as "e4, empty" or "e4, white pawn, legal destination". Promotion routes into the existing modal. Pointer behaviour is entirely unchanged.

**Implementation approach.**

- New `src/components/BoardKeyboardLayer.tsx` rendering an absolutely-positioned 8×8 grid of `role="gridcell"` elements over `.cg-wrap`, with `pointer-events: none` on the layer and `pointer-events: auto` only when it holds focus — this is the mechanism that guarantees pointer non-interference.
- Cursor state and selection state live in a new `src/store/board-cursor.ts`, deriving legal destinations from the existing `dests()` and playing through the existing `actions.play` so promotion, history (`WP-005`), and staleness all behave identically to a drag.
- Square descriptions come from `content/analysis.ts`; announcements go through `announce()` (`WP-009`).
- Orientation-aware mapping: the cursor follows the visual board, so `ArrowUp` means "up the screen", not "toward rank 8", when the board is flipped.
- **`DV-1` gate.** Before implementation: build the layer as a throwaway prototype on a branch, run the §14 `DV-1` task with two keyboard-only or screen-reader users, and record whether the two-step select/place model or a coordinate-entry model (type `e2e4`) performs better. The default if inconclusive is the two-step cursor model above, because it matches the established pattern in Lichess and chess.com board accessibility.

**Existing behaviour to preserve.** Pointer and touch dragging, `showDests` highlighting, the last-move highlight, check highlighting, all four arrow overlays (repertoire green, engine fit-coloured, suggestion blue, preview gold) and their de-duplication logic (`Board.tsx:74–87`), the promotion revert, and the board re-sync effect. Engine-worker scheduling must be untouched.

**Acceptance criteria.**

- The board is exactly one tab stop; entering it announces the position summary and places a visible cursor.
- Arrow keys move the cursor one square in the direction shown on screen, in both orientations.
- Selecting a piece announces its legal destination count; only legal destinations are selectable; an illegal target is refused with an announcement and no state change.
- Playing a move by keyboard produces the same tree mutation, the same history entry, and the same `dirty` state as the equivalent drag.
- A keyboard promotion opens the promotion dialog with focus inside it, and completing it plays the promotion.
- `Escape` clears the selection without changing the position.
- With the layer unfocused, pointer drag, click-to-move, and touch drag are byte-identical to the pre-change behaviour (assert via an interaction test on all three).
- The board cursor does not fire while any dialog is open.
- A keyboard-only user completes: open a PGN → navigate to move 6 → add a variation → save (this is the milestone `M-2` journey).

**Automated tests.** `core-keyboard.spec.ts` full journey; a pointer non-regression suite (drag, click-move, touch drag); a promotion-by-keyboard test; an orientation test with the board flipped.

**Manual validation.** Mandatory screen-reader session (NVDA + VoiceOver) — accessibility gate AG-4. Mandatory prototype validation before implementation (DV-1).

**Failure and rollback.** Highest-risk regression is pointer interference. Detection: the pointer non-regression suite runs in all three browsers. Rollback: the layer is a single additive component; reverting removes it and restores today's (inaccessible) board without any other change.

---

### WP-015 — Side-column reorder

|                              |                                                                 |
| ---------------------------- | --------------------------------------------------------------- |
| **Objective**                | Put the most-used panel where it can be seen without scrolling. |
| **Audit findings addressed** | UX-010                                                          |
| **Severity reduced**         | High → none                                                     |
| **Type**                     | Workflow                                                        |
| **Decision**                 | Implementation-defined                                          |
| **Size**                     | S                                                               |
| **Risk**                     | Low                                                             |
| **Dependencies**             | WP-000, WP-011                                                  |
| **Blocks**                   | none                                                            |
| **Parallel with**            | WP-016, WP-018, WP-021                                          |

**Current behaviour.** `App.tsx:106–110` renders `.side-panel` children in the order `AnalysisPanel`, `RepertoirePanel`, `MoveTree`. Verified at 1440×900: the move tree starts at y ≈ 800 in a 900 px viewport, below ten collapsed repertoire sections and the Strategic Fit entry card. `styles.css:415–424` gives `.side-panel` `overflow-y: auto` and `.move-tree` `flex: 0 0 min(50vh, 28rem)` at ≥1101 px.

**Target behaviour.** The move tree is the first panel in the column and is visible without scrolling at every viewport ≥ 1024×600. Analysis follows. Repertoire tools come last. On mobile, the `Moves` tab is the default tab.

**Implementation approach.** Reorder the three components in `App.tsx`. Adjust `styles.css:421–423` so `.move-tree` keeps a bounded share (`flex: 0 1 min(45vh, 24rem)`) now that it is first and the analysis panel must remain visible under it. Change `store/ui.ts` `mobileTab` default from `"analysis"` to `"moves"`. Verify the `.workspace[data-mtab]` display rules (`styles.css:319–330`) still target the right children after the reorder — they select by class, so no change expected, but assert it.

**Existing behaviour to preserve.** The side panel's single scroll container at ≥1101 px and its `overscroll-behavior: contain`. Mobile panel mounting. The Gaps section's `open` default.

**Acceptance criteria.**

- At 1024×600, 1280×800, and 1440×900, the move tree's top edge is within the viewport without scrolling `.side-panel`, and at least three move rows are visible.
- The analysis panel's engine-lines area is visible without scrolling at 1280×800.
- At 390×844 the default tab on first load is `Moves`.
- Mobile tab switching shows exactly one panel group, unchanged from before.
- No horizontal overflow at any matrix viewport.

**Automated tests.** `core-layout.spec.ts` position assertions at three viewports; a default-tab assertion.

**Manual validation.** None.

**Failure and rollback.** Regression mode: the analysis panel pushed below the fold instead. Detection: the analysis-visible assertion. Rollback: reorder back.

---

### WP-016 — Engine controls into Analysis, and honest analysis states

|                              |                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Put engine settings next to the analysis they affect, and stop the panel from misdiagnosing its own empty state. |
| **Audit findings addressed** | UX-009, UX-008 (partial), UX-022                                                                                 |
| **Severity reduced**         | UX-009 High → none; UX-022 Medium → none                                                                         |
| **Type**                     | Workflow + Content                                                                                               |
| **Decision**                 | Implementation-defined                                                                                           |
| **Size**                     | M                                                                                                                |
| **Risk**                     | Low                                                                                                              |
| **Dependencies**             | WP-000, WP-024 (copy)                                                                                            |
| **Blocks**                   | WP-017                                                                                                           |
| **Parallel with**            | WP-015, WP-018, WP-021                                                                                           |

**Current behaviour.** `analysis.ts:39` defaults `evalEnabled` to `false`. `AnalysisPanel.tsx:44` renders `"No lines yet."` whenever `engineLines()` is empty and the engine is not marked offline — the same string for "evaluation is off", "the first search has not returned", and "the engine returned nothing". `engineOffline` (`analysis.ts:38`) is set only after a failed live search and is sticky until a later search succeeds. `TopBar.tsx:52–68` owns the `Eval On/Off` toggle and the depth slider plus number input; `TopBar.tsx:13–17` shows a dismissible depth-30 notice whose state is local and unpersisted — verified that it re-appears every time depth reaches 30. `AnalysisPanel.tsx:30–36` renders two stacked headers (`.outcome-label` "Position" at 10 px and `.panel-head` "Engine lines · depth 20" at 12.5 px). `EvalBar.tsx` renders a neutral 50 % bar with an empty label when there are no lines, and has only a `title` for a name.

**Target behaviour.** The analysis panel owns evaluation on/off, depth, and cloud-eval, behind a settings disclosure in its header, with the effective depth shown as a read-only chip. Its empty states are distinct and each names the next action. The eval bar has an accessible name and a distinct "off" appearance. The depth notice becomes persistent inline helper text.

**Implementation approach.**

- Move the eval toggle, the depth slider/number, and the cloud-eval checkbox out of `TopBar.tsx` and `SettingsDrawer.tsx` into a new `src/components/AnalysisSettings.tsx` rendered from `AnalysisPanel`'s header as a `<details>`-based disclosure (not a dialog — it is a frequently-adjusted control).
- Replace the two stacked headers with one `PanelHeader`-shaped row (the primitive itself lands in `WP-037`; use its markup shape now): title `Engine`, status slot (`analysing…` / `off` / `offline`), action slot (settings disclosure).
- Introduce a derived `analysisState()` in `analysis.ts`: `"off" | "starting" | "analysing" | "ready" | "offline"`. Empty-state copy per state from `content/analysis.ts`.
- `EvalBar.tsx`: add `role="img"` with an `aria-label` from `content/analysis.ts` (`"Evaluation: +0.34, white slightly better"` / `"Evaluation unavailable — engine off"`), and a distinct greyed treatment when `analysisState() === "off"`.
- Depth notice: delete `showDeepNotice` local state; render persistent helper text under the depth control whenever depth ≥ 25.
- Keep `analysisDepth` in `store/engine-settings.ts` — only its **control** moves, not its ownership, so every existing consumer (`RepertoirePanel`'s five depth-passing call sites, `AnalysisPanel`, `commands`) is untouched.

**Existing behaviour to preserve.** `analysisDepth`'s clamp (1–30) and its use by `audit_repertoire_moves`, `find_only_moves`, and `export_annotated_repertoire` (`RepertoirePanel.tsx:86`). The live-worker debounce (`analysis.ts:77`, 180 ms) and its cancellation via `onCleanup`. The `engineOffline` sticky-then-clear behaviour. Cloud eval's opt-in default and its privacy note copy (`SettingsDrawer.tsx:87–90`) — the note moves with the control, unchanged.

**Acceptance criteria.**

- With evaluation off, the analysis panel shows "Engine evaluation is off" and a button that turns it on; activating it produces engine lines within 10 s at depth 20.
- With evaluation on and the first search pending, the panel shows a distinct "starting" state, not the "off" copy.
- With the engine offline, the panel shows the offline copy and a reload action.
- The eval bar exposes an accessible name that differs between "off" and a live evaluation.
- Setting depth to 30 shows helper text; changing to 20 and back to 30 shows it again with no dismiss control and no notice element in the top bar.
- The top bar no longer contains an eval toggle or depth control; the analysis panel does.
- The effective depth is visible in the analysis panel header without opening the disclosure.
- Every existing depth-consuming command still receives the same value (assert via `window.__chess.commandStates` after a scan).
- The cloud-eval privacy note text is unchanged.

**Automated tests.** Playwright `core-analysis.spec.ts` covering the four states, the eval-bar name, the depth-notice persistence, and the depth propagation to a direct command. Store test for `analysisState()`.

**Manual validation.** Confirm the disclosure does not cause layout shift when opened on a 1280×800 laptop.

**Failure and rollback.** Regression mode: depth no longer reaching engine-backed commands. Detection: the propagation assertion. Rollback: revert; controls return to the top bar.

---

### WP-017 — Top-bar information architecture

|                              |                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| **Objective**                | Reduce the top bar to document identity, document state, and app-level entry points. |
| **Audit findings addressed** | UX-008                                                                               |
| **Severity reduced**         | High → none                                                                          |
| **Type**                     | Workflow                                                                             |
| **Decision**                 | **Design validation required** (`DV-3`, §14)                                         |
| **Size**                     | M                                                                                    |
| **Risk**                     | Medium — it is the most visible surface in the app                                   |
| **Dependencies**             | WP-002, WP-016, WP-018                                                               |
| **Blocks**                   | none                                                                                 |
| **Parallel with**            | WP-022, WP-025, WP-030                                                               |

**Current behaviour.** Nine peer controls in one flex row (`TopBar.tsx:19–76`): title, dirty chip, filename, `Open PGN`, conditional `Reopen <name>`, `Save`, `New`, colour select, eval toggle, depth control, `Settings`, plus a fixed-position depth notice. Measured heights: 258 px at 360 px wide, 240 px at 390, 124 px at 720, 110 px at 768, 63 px at 1024, 50 px at 1280.

**Target behaviour.** Three visually separated groups: **document** (filename + persistence state + a `Repertoire ▾` menu containing Open, Re-link, Save to file, New, Recover), **board** (colour/orientation), **app** (activity strip, Settings, help). At 360 px the bar occupies no more than 96 px. All actions remain reachable in at most one additional interaction.

**Implementation approach.** `TopBar.tsx` restructures into three `<div>` groups with `role="group"` and `aria-label`s. A new `src/components/DocumentMenu.tsx` (a menu button, not a `Dialog` — it is a lightweight popup with `aria-expanded`/`aria-controls` and roving focus). The persistence indicators come from `WP-018`. Depth and eval have already left in `WP-016`. `styles.css` gains group separators using surface elevation rather than borders.
**`DV-3` gate.** Validate the menu-versus-visible-buttons choice before implementation: burying `Save` behind a menu is a real cost for a frequent action. Default if inconclusive: keep `Save to file` as a visible button and move only `Open`, `Re-link`, `New`, and `Recover` into the menu.

**Existing behaviour to preserve.** `Cmd/Ctrl+S` continues to save regardless of the menu. The `Reopen <name>` affordance still appears only when a stored handle exists. The colour select still drives `actions.setColor` and board orientation. Safe-area padding.

**Acceptance criteria.**

- At 360×740 the top bar's rendered height is ≤ 96 px with a 40-character filename.
- At 1280×800 it is a single row with a 20-character filename.
- Every action available before the change is reachable in ≤ 2 interactions, and `Save to file` in ≤ 1.
- The document menu is keyboard-operable: `Enter`/`Space` opens, arrows traverse, `Escape` closes and restores focus, `aria-expanded` reflects state.
- The three groups have distinct accessible group labels.
- No horizontal overflow at any matrix viewport with a 120-character filename.
- `Cmd/Ctrl+S` still saves from a text field.

**Automated tests.** `core-layout.spec.ts` height assertions; a menu keyboard spec; the overflow sweep re-run.

**Manual validation.** DV-3 task with two existing users before implementation; post-implementation check that `Save` is still found within 5 s by a first-time user.

**Failure and rollback.** Regression mode: users cannot find Save or New. Detection: DV-3 and the ≤2-interaction criterion. Rollback: single-file revert.

---

### WP-018 — Document-state indicators: browser storage versus file

|                              |                                                                            |
| ---------------------------- | -------------------------------------------------------------------------- |
| **Objective**                | Let the user always answer "where is my work right now?".                  |
| **Audit findings addressed** | UX-031, UX-029, UX-032                                                     |
| **Severity reduced**         | High → none (UX-031); Medium → none (UX-029, UX-032)                       |
| **Type**                     | Content + Workflow                                                         |
| **Decision**                 | **Product decision required** for the persistence vocabulary (`PD-1`, §14) |
| **Size**                     | S                                                                          |
| **Risk**                     | Low                                                                        |
| **Dependencies**             | WP-004, WP-009, WP-024                                                     |
| **Blocks**                   | WP-017                                                                     |
| **Parallel with**            | WP-015, WP-016, WP-021                                                     |

**Current behaviour.** `TopBar.tsx:21–23` renders `● unsaved` when `dirty()`. `dirty` is set by `play`, `applyEdit`, `undo`, and the Strategic Fit publish path, and cleared by `markSaved()` — which is called on all three save paths including the download fallback (`files.ts:140`). Nothing indicates that IndexedDB autosave exists, when it last ran, or that a downloaded file is not linked. `restoreWorking()` restores silently.

**Target behaviour.** Two independent, always-visible indicators. Browser state: `Stored in this browser · autosaved 12:04`. File state: `File: my-rep.pgn — 3 changes not exported`, or `Not saved to a file yet`, or `Downloaded my-rep.pgn — this browser can't re-link it`. A restore on load produces a dismissible toast naming the last-change time. A denied re-link produces a message with an `Open PGN` action.

**Implementation approach.** New `src/components/DocumentStatus.tsx` rendered in the top bar's document group. Reads `fileName()`, `changesSinceExport()` (WP-003), the snapshot ring's latest `savedAt` (WP-004), and a new `fileLinkState: "linked" | "download-only" | "none"` derived in `store/files.ts` from whether a handle exists and how the last save completed. Copy from `content/document.ts` (`PD-1` decides the exact wording). Restore toast via `Toast` (WP-007's sibling primitive) fired from `App.tsx`'s `restoreWorking()` completion.

**Existing behaviour to preserve.** `dirty()`'s existing semantics and every consumer of it (`TopBar`, `openFile`'s guard, `persist`'s autosave record) — this package **adds** a second concept, it does not redefine `dirty`. The Strategic Fit metadata warning banner. `markSaved()` timing.

**Acceptance criteria.**

- With a file linked and unexported changes, both indicators are visible and the file indicator names the file and the change count.
- After `Save to file`, the change count reads zero within 500 ms.
- After a download-fallback save, the file indicator states the browser cannot re-link, and no `Reopen` button is shown.
- The browser indicator shows a timestamp that advances after an edit and the autosave debounce elapses.
- On load with a restored document, a toast appears naming the last-change time and is dismissible; it does not reappear on the next navigation within the session.
- When `reopenLast()` permission is denied, a message names the file and offers `Open PGN`.
- Both indicators are announced once on change through the polite region, not on every keystroke.

**Automated tests.** `core-document.spec.ts`: indicator text across linked/download/none states, change-count reset, restore toast, denial message. Store test for `fileLinkState`.

**Manual validation.** Firefox and WebKit for the download-only state.

**Failure and rollback.** Regression mode: announcement noise from the change counter. Detection: the announcement-count assertion. Rollback: single revert.

---

### WP-019 — PWA update notification and `Toast` primitive

|                              |                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Stop the service worker replacing the app silently, especially in the installed PWA where no reload affordance exists. |
| **Audit findings addressed** | UX-041                                                                                                                 |
| **Severity reduced**         | Medium → none                                                                                                          |
| **Type**                     | Safety + Workflow                                                                                                      |
| **Decision**                 | Implementation-defined                                                                                                 |
| **Size**                     | S                                                                                                                      |
| **Risk**                     | Low                                                                                                                    |
| **Dependencies**             | WP-009, WP-010                                                                                                         |
| **Blocks**                   | none                                                                                                                   |
| **Parallel with**            | WP-015–WP-018                                                                                                          |

**Current behaviour.** `vite.config.ts:25` sets `registerType: "autoUpdate"`; `devOptions.enabled` is false so the SW exists only in production builds. No registration hook, no notification, no deferral. The workbox config precaches the ~7 MB Stockfish wasm.

**Target behaviour.** When a new version is ready, a toast offers `Reload` and `Later`. If any operation is running (`operations()` non-empty), the toast defers until the last one settles. Nothing reloads without the user asking.

**Implementation approach.** Switch `registerType` to `"prompt"` and consume `virtual:pwa-register`'s `useRegisterSW`-equivalent in a new `src/pwa/updates.ts` (Solid-flavoured: a signal fed by the `onNeedRefresh` callback). Render through `Toast`. Because the SW only exists in production builds, add a dev-only simulation seam on `window.__chess` (`simulatePwaUpdate()`) so the flow is testable by Playwright against the dev server.

**Existing behaviour to preserve.** Offline precaching of the app shell and the Stockfish wasm. Installability (`manifest` unchanged). Static-hosting compatibility — no server-side change.

**Acceptance criteria.**

- Triggering the simulated update shows a toast with `Reload` and `Later`; neither the page nor the SW activates until `Reload` is chosen.
- With a running operation, the toast does not appear until the operation settles.
- `Later` dismisses for the session; the toast re-appears on the next load if the update is still pending.
- A production build still precaches the wasm and remains installable (assert `manifest` and precache manifest presence in `dist`).
- The update message is announced once through the polite region.

**Automated tests.** Playwright against the dev seam for the toast, deferral, and dismissal. A build-output assertion in CI that `dist/manifest.webmanifest` and the wasm precache entry exist.

**Manual validation.** Deploy to a preview, install the PWA on iOS and Android, deploy again, and confirm the toast appears and `Reload` picks up the new build. This is the one item that cannot be validated without a real deploy (D13).

**Failure and rollback.** Regression mode: switching from `autoUpdate` to `prompt` leaves users on a stale build if the toast fails to render. Detection: the toast test plus a manual post-deploy check. Rollback: revert to `autoUpdate` — a one-line change.

---

### WP-020 — Responsive tier tokens and the 1100 px transition

|                              |                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| **Objective**                | Replace three uncoordinated breakpoints with three named tiers and remove the board-size cliff. |
| **Audit findings addressed** | UX-024                                                                                          |
| **Severity reduced**         | Medium → none                                                                                   |
| **Type**                     | Responsive layout + Architecture                                                                |
| **Decision**                 | Implementation-defined                                                                          |
| **Size**                     | M                                                                                               |
| **Risk**                     | Medium — touches every media query                                                              |
| **Dependencies**             | WP-001, WP-002                                                                                  |
| **Blocks**                   | none                                                                                            |
| **Parallel with**            | WP-022, WP-025, WP-030                                                                          |

**Current behaviour.** 18 media queries at 720 px (phone), 820 px (Strategic Fit compact), and 1100 px (grid⇄flex), authored independently and located thousands of lines apart. Verified cliff: crossing 1100 → 1101 px shrinks the board from 560 px to 325 px (−42 %) because the grid gives the board `minmax(260px, 1fr)` while the flex regime gives it whatever remains after the stored 300 px and 360 px panel widths.

**Target behaviour.** Three documented tiers with content contracts. Crossing 1100 → 1101 px changes the board width by no more than 15 %. Strategic Fit's 820 px breakpoint no longer participates in the global tier system.

**Implementation approach.**

- A `styles.css` header block defining the tiers as documented constants (CSS custom media is not available without PostCSS, so this is a documented convention plus a single search-and-replace of the raw widths, not a new build step — avoid adding tooling for this).
- `store/layout.ts`: on the first transition from the grid tier into the flex tier, seed `sideWidth`/`chatWidth` from the widths the grid was actually rendering (measure once via `getBoundingClientRect` on the transition) rather than from the persisted defaults, then persist. This is the mechanism that removes the cliff without changing the persisted-width model.
- Strategic Fit's 820 px queries are rewritten against the workspace element's own width. If `@container` support across the matrix browsers proves insufficient, keep the media query but rename its comment to state it is workspace-local and not a global tier — the goal is conceptual separation, and this fallback is acceptable.
- Every tier documents: minimum panel height (12 rem, from `WP-001`), minimum panel width (240 px, existing `MIN_PX`), what scrolls, and what may be hidden.

**Existing behaviour to preserve.** The 240 px `MIN_PX` and `BOARD_MIN` clamps and the `reflow()` window-resize handler. The single-write-per-gesture persistence. Panel mounting across tiers. All Strategic Fit compact-tier behaviour, verified by its existing specs.

**Acceptance criteria.**

- Board width at 1101 px is within 15 % of its width at 1100 px.
- Resizing continuously from 320 px to 2560 px produces no viewport at which a panel is narrower than 240 px or shorter than 12 rem.
- `styles.css` contains a documented tier block, and no raw `720px`/`1100px` literal appears outside it (the 820 px Strategic Fit query is explicitly annotated as workspace-local).
- All 22 Strategic Fit specs pass unchanged.
- Persisted layout widths written by the pre-change build are honoured.

**Automated tests.** A continuous-resize sweep asserting the cliff bound and the minimums; a `styles.css` lint-style assertion (a small `node --test` script) that raw breakpoint literals appear only in the tier block.

**Manual validation.** Drag a browser window across 1100 px and confirm the transition is not visually jarring.

**Failure and rollback.** Regression mode: the seeding logic fighting the persisted widths, producing drift on every transition. Detection: a test that crossing the boundary twice returns to the original widths. Rollback: revert the store change alone; the CSS reorganisation is independently safe.

---

### WP-021 — Chat rail until the assistant is configured

|                              |                                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| **Objective**                | Stop reserving a quarter of the workspace for a feature that cannot run. |
| **Audit findings addressed** | UX-028                                                                   |
| **Severity reduced**         | Medium → none                                                            |
| **Type**                     | Workflow                                                                 |
| **Decision**                 | **Product decision required** (`PD-4`, §14)                              |
| **Size**                     | S                                                                        |
| **Risk**                     | Low                                                                      |
| **Dependencies**             | WP-000, WP-024                                                           |
| **Blocks**                   | none                                                                     |
| **Parallel with**            | WP-015, WP-016, WP-018                                                   |

**Current behaviour.** `.chat-wrap` is always rendered at the persisted width (default 360 px). Verified at 1440×900: 360 px of full-height column containing only the panel head and `No API key. Open Settings`. `hasApiKey()` (`store/settings.ts`) is false until a key is entered.

**Target behaviour.** While `hasApiKey()` is false in the wide tier, the chat column collapses to a ~48 px vertical rail with a labelled `Set up the assistant` control and a one-sentence description on hover/focus. Activating it opens Settings focused on the API-key field. Once a key exists, the column expands to the persisted width. On mobile the Chat tab remains but its panel shows the setup call to action.
**`PD-4`.** Collapsing a panel by default is a product judgement — an alternative is to keep the column and simply replace its content with a proper setup call to action. Default if inconclusive: keep the column at full width but replace the terse error line with the setup card, because collapsing risks users never discovering the assistant.

**Implementation approach.** `App.tsx` chooses the chat width from `hasApiKey()`; `store/layout.ts` gains a `chatCollapsed()` derived value so the divider is disabled and the persisted width is untouched while collapsed. `ChatPanel.tsx` renders a `ChatSetupCard` when `!hasApiKey()`. `SettingsDrawer` accepts an `initialFocus` target.

**Existing behaviour to preserve.** The persisted chat width must be restored unchanged when a key is added — collapsing must not overwrite it. The mobile Chat tab must remain present. The existing `No API key` link behaviour (opening Settings) must keep working.

**Acceptance criteria.**

- With no API key at 1440×900, `.chat-wrap` is ≤ 56 px wide and the board and side panel absorb the released width.
- The rail control is keyboard reachable, has an accessible name, and opens Settings with focus on the API-key field.
- Adding a key restores the chat column to its previously persisted width (assert the exact stored value).
- At 390×844 the Chat tab is present and shows the setup card.
- The side│chat divider is not focusable and not draggable while collapsed.

**Automated tests.** Playwright: collapsed width, restore-to-persisted-width, focus target, mobile tab presence.

**Manual validation.** PD-4 task before implementation.

**Failure and rollback.** Regression mode: the persisted width lost on collapse. Detection: the restore assertion. Rollback: single revert.

---

### WP-022 — Repertoire tools regrouped by user goal

|                              |                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Objective**                | Replace ten identical collapsed sections organised by implementation tier with four goal-named groups. |
| **Audit findings addressed** | UX-021, UX-035 (partial)                                                                               |
| **Severity reduced**         | High → none                                                                                            |
| **Type**                     | Workflow + Content                                                                                     |
| **Decision**                 | **Design validation required** (`DV-4`, §14)                                                           |
| **Size**                     | M                                                                                                      |
| **Risk**                     | Medium — the panel is the app's densest surface                                                        |
| **Dependencies**             | WP-011, WP-024                                                                                         |
| **Blocks**                   | WP-029                                                                                                 |
| **Parallel with**            | WP-017, WP-025, WP-030                                                                                 |

**Current behaviour.** `RepertoirePanel.tsx:144–404` renders, in order: an `outcome-label` "Repertoire", a depth scope note, the Strategic Fit entry card, a staged-preview block, then `<details class="rep-section">` for Prescribed-move audit, Only moves & drills, Structure search, Opponent preparation, Annotated repertoire, `StrategicFitTransfer` (Strategic Fit portability), an `outcome-label` "Advanced", then Gaps (open), Connect, Shorten, Extend here. Source comments name these "Tier A" and "Tier B". Each section repeats a depth/scope note; each carries a differently-labelled action button (`Audit`, `Find`, `Search`, `Prepare`, `Generate`, `Scan` ×3, `Suggest`).

**Target behaviour.** Four goal groups per audit §12: **Check my repertoire** (book-move audit, unanswered opponent moves, critical positions), **Extend it** (suggest next moves, finish unfinished lines), **Simplify it** (shorten what you memorise), **Prepare and export** (opponent prep, structure search, annotated PGN, drill deck). Each collapsed group shows a one-line summary of its last result. The depth statement appears once, in the panel header. The `Advanced` divider is removed.

**Implementation approach.** `RepertoirePanel.tsx` is decomposed into `RepertoireToolGroup` + one component per tool (`AuditTool`, `GapsTool`, `OnlyMovesTool`, `StructureTool`, `PrepTool`, `AnnotateTool`, `ExtendTool`, `ConnectTool`, `ShortenTool`, `DrillDeckTool`) under `src/components/repertoire/`. Each tool owns its own store bindings; the panel owns only grouping and the shared depth statement. Last-result summaries derive from the existing `commandStates` results and the scan stores. Group titles and tool titles from `content/repertoire.ts`.
**`DV-4` gate.** The four-group taxonomy is an information-architecture proposal. Validate with a card sort against the ten current tool names before implementation. Default if inconclusive: the four groups above, because they map to the audit's user-goal analysis and to the ROADMAP's repertoire-building framing.

**Existing behaviour to preserve.** Every tool's arguments, depth passing (`RepertoirePanel.tsx:86`), cancellation, progress rendering, result rows, staging behaviour (`stagePreviewLine`, `acceptPreview`), the covered-by-transposition muted rows, the `best eval`/`best fit` fill pair, the Shorten inspect panel's data, the `usersTurn()` guard on Extend, and the artifact save flow. Gaps stays open by default. `StrategicFitTransfer` keeps its current behaviour and moves into "Prepare and export".

**Acceptance criteria.**

- The panel renders exactly four groups with the agreed titles; no `Advanced` label remains.
- Each of the ten tools is present, and every tool's action produces the same command with the same arguments as before (assert via `window.__chess.commandStates` and store spies for the scan stores).
- The depth statement appears exactly once in the panel.
- A collapsed group whose tool has a result shows a one-line summary including a count and a relative time.
- Keyboard: each group summary is a `<summary>` reachable by `Tab`, `Enter`/`Space` toggles it, `aria-expanded` reflects state.
- `touchTargetViolations(repertoirePanel, 24)` empty at 1280×800.
- Panel height with all groups collapsed is no greater than today's height with all sections collapsed.

**Automated tests.** A per-tool argument-equivalence spec (the strongest guard against a regrouping regression); group summary assertions; keyboard toggling.

**Manual validation.** DV-4 card sort before implementation.

**Failure and rollback.** Regression mode: a tool losing an argument during the move. Detection: the argument-equivalence spec, which must be written **before** the refactor and pass against the current code first. Rollback: revert; the decomposition is one PR.

---

### WP-023 — Strategic Fit entry point

|                              |                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------- |
| **Objective**                | Make the app's most sophisticated capability discoverable and self-explanatory. |
| **Audit findings addressed** | UX-035                                                                          |
| **Severity reduced**         | Medium → none                                                                   |
| **Type**                     | Content + Workflow                                                              |
| **Decision**                 | Implementation-defined; the value sentence is content (`WP-024`)                |
| **Size**                     | XS                                                                              |
| **Risk**                     | Low                                                                             |
| **Dependencies**             | WP-024                                                                          |
| **Blocks**                   | none                                                                            |
| **Parallel with**            | everything in Phase 3                                                           |

**Current behaviour.** `RepertoirePanel.tsx:148–160` renders the entry card inside the scrolling side column, below the analysis panel: title "Strategic Fit", body "Explore the review workspace. Opening it does not analyze or change this repertoire.", button "Open workspace".

**Target behaviour.** The card leads with the user's question — "Is your repertoire asking you to learn too many different plans?" — followed by one sentence of what it does and the existing no-side-effects promise, with the button labelled `Open Strategic Fit`. It sits at the top of the "Check my repertoire" group (after `WP-022`) so it is reached before the ten tools.

**Implementation approach.** Copy from `content/strategicFit.ts`; markup change in the entry card only. No behavioural change.

**Existing behaviour to preserve.** The no-side-effects sentence must survive verbatim in meaning — it is the reassurance the audit identifies as correct. The `setStrategicFitWorkspaceOpen(true)` call and the focus behaviour on open.

**Acceptance criteria.**

- The card's first line is a question naming the user's problem, not a description of the UI.
- The card states that opening it does not analyse or change the repertoire.
- The button label reads `Open Strategic Fit`.
- Opening still triggers no analysis (assert `strategicFitLifecycle().status === "idle"` after opening).

**Automated tests.** A copy assertion and the no-analysis assertion in `strategic-fit-workspace.spec.ts`.

**Manual validation.** None.

---

### WP-024 — Content registry foundation

|                              |                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Objective**                | Create the one place user-facing language lives, with a mechanism that stops raw identifiers returning. |
| **Audit findings addressed** | Enables UX-015, UX-016, UX-020, UX-023, UX-034, UX-036, UX-037, UX-039, UX-043; Workstream I            |
| **Severity reduced**         | — (enabler)                                                                                             |
| **Type**                     | Architecture + Content                                                                                  |
| **Decision**                 | Implementation-defined for structure; individual strings are content (some flagged `PD-1`)              |
| **Size**                     | M                                                                                                       |
| **Risk**                     | Low                                                                                                     |
| **Dependencies**             | WP-000                                                                                                  |
| **Blocks**                   | WP-008, WP-016, WP-018, WP-021, WP-022, WP-023, WP-025, WP-029, WP-030, WP-034, WP-038                  |
| **Parallel with**            | WP-011, WP-012, WP-013                                                                                  |

**Current behaviour.** Every user-visible string is an inline literal. Formatting helpers are duplicated per component: `evalText` in `AnalysisPanel.tsx:14`, `cloudText` at `:20`, `gapEval` in `RepertoirePanel.tsx:57`, `cp2` at `:62`, `numbered` at `:63`, `cpDelta` at `:119`, `titleCase` in `ToolResult.tsx:86`, `diffValue` at `:316`, `countLabel` at `:364`. `ERROR_LABELS` (`ToolResult.tsx:639–685`) is a 47-entry code→label map — the repository's only existing content table and the model for the registry. `strategicFitPlanSectionLabel` and `STRATEGIC_FIT_PROFILE_LABELS`/`STRATEGIC_FIT_LIFECYCLE_LABELS` live next to their components.

**Target behaviour.** No user-visible change. All strings live in `src/content/`, formatting helpers are shared, and a check script fails the build if a browser-host tool has no user-facing label.

**Implementation approach.**

- Create `src/content/` per §4.9. Migration is mechanical and per-surface; this package moves the **existing** strings without rewording them, so a diff review can confirm nothing changed. Rewording happens in the packages that own each surface (`WP-016`, `WP-018`, `WP-025`, `WP-026`, `WP-029`, `WP-030`, `WP-031`, `WP-034`, `WP-038`).
- Consolidate the nine duplicated formatters into `content/format.ts` with a single implementation each, keeping their current output byte-identical.
- `content/errors.ts` absorbs `ERROR_LABELS` and extends each entry to `{ title, cause?, action? }` — the `action` field is consumed by `WP-026`.
- `content/tools.ts` exports `taskLabel(name)` plus a `TOOL_LABELS` record.
- New `scripts/check-content.mjs` run from a new `pnpm check:content` script and added to CI: asserts every `contractsForHost("browser")` name has a `TOOL_LABELS` entry, and every `error` code produced by `browserCommandImplementations` (enumerated from a static list maintained beside the registry) has an `errors.ts` entry. This is the mechanism that prevents regression, and it belongs next to the existing `docs:check` and `check:skills` gates.
- Expert/plain pairing is expressed as `{ plain, expert? }` and rendered by consumers as label + description, never the reverse.

**Existing behaviour to preserve.** Every string's current rendered text, exactly, in this package. Strategic Fit's existing label maps stay where they are for now if they are typed against chess-tools enums (`STRATEGIC_FIT_LIFECYCLE_LABELS` is exported from `AnalysisLifecycle.tsx` and consumed by `StrategicFitWorkspace.tsx:436`); re-export them through `content/strategicFit.ts` rather than moving them, to avoid a circular import.

**Acceptance criteria.**

- `grep -rn '"[A-Z][a-z].* .*"' src/components` returns no user-facing sentence outside `src/content/` (allowing class names, ARIA role values, and test ids) — enforced by a review checklist, not a brittle script.
- Every formatter has exactly one implementation; the nine duplicates are gone.
- `pnpm check:content` exists, is wired into CI, and fails when a browser tool lacks a label (verified by temporarily adding a fake contract entry in a test).
- The full Playwright suite passes with zero snapshot or text-assertion changes — proving the migration changed no rendered text.
- `pnpm -r typecheck` passes with `content/` fully typed (no `any`, no string-keyed lookups without an exhaustive record type).

**Automated tests.** The unchanged-text proof is the existing suite. Add `test/content.test.ts` asserting formatter output parity against fixtures captured from the current implementations, and a check-script self-test.

**Manual validation.** None.

**Failure and rollback.** Regression mode: a subtle wording change slipping in during the move. Detection: the zero-text-change requirement on the existing suite. Rollback: revert; no behaviour depends on the registry until later packages.

---

### WP-025 — Tool and navigation labels

|                              |                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| **Objective**                | Replace contract identifiers and JSON-key-derived labels with task language. |
| **Audit findings addressed** | UX-015 (label half)                                                          |
| **Severity reduced**         | High → Medium (card hierarchy lands in WP-026)                               |
| **Type**                     | Content                                                                      |
| **Decision**                 | Implementation-defined                                                       |
| **Size**                     | S                                                                            |
| **Risk**                     | Low                                                                          |
| **Dependencies**             | WP-024                                                                       |
| **Blocks**                   | WP-026                                                                       |
| **Parallel with**            | WP-017, WP-022, WP-030                                                       |

**Current behaviour.** `ChatPanel.tsx:85` renders `⚙ {tc.function.name}` — raw contract identifiers such as `analyze_repertoire_congruence`. `ChatPanel.tsx:91` renders `{toolName} result`. `ToolResult.tsx:62–84` `NavigationRows` walks arbitrary JSON and derives labels from keys via `childKey.replace(/_/g, " ")`, producing verified output such as `gaps 1`, `result 3 position`, and `uncovered opponent moves 2`.

**Target behaviour.** Tool chips read as tasks (`Checking repertoire coverage`). Result headers read as outcomes (`Repertoire coverage`). Navigation rows read as chess locations (`Line 1 · 1.d4 Nf6 2.Nf3`), never as JSON paths.

**Implementation approach.** `ChatPanel.tsx` and `ToolResult.tsx` consume `taskLabel()` and a new `content/tools.ts` `navigationLabel(key, index)` dictionary keyed by the field names `NavigationRows` actually looks for (`path`, `san_path`, `variation_path`, `pivot_path`, `fen`, `ply`) plus the parent key. Unknown keys fall back to a generic ordinal label (`Line 3`), never to the raw key. Formatting of SAN paths goes through `content/format.ts`'s `numbered()`.

**Existing behaviour to preserve.** `NavigationRows`' traversal bounds (8 rows, 12 array items), its `indexPathOfSan` validity check before offering navigation, and the `navigateFen` fallback. The typed renderer registry (`byOperation`, `byKind`) and its dispatch order.

**Acceptance criteria.**

- No chat message, chip, or result header displays a string matching any `contractsForHost("browser")` name (`rawIdentifierViolations` empty for the chat log).
- Every navigation row label is either a chess description or an ordinal; none contains an underscore or a raw JSON key.
- Navigation targets still resolve to the same board positions as before (assert path equality for a fixture result).
- `pnpm check:content` passes with all browser tools labelled.

**Automated tests.** A chat spec injecting fixture tool results through `appendToolResultForTesting` and asserting labels and navigation targets; baseline check 8 partially flips (chat half).

---

### WP-026 — Chat result hierarchy, technical-details policy, and error recovery

|                              |                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Objective**                | Make results scannable, make consequential results look consequential, and make failures actionable. |
| **Audit findings addressed** | UX-015 (hierarchy half), UX-020, UX-034                                                              |
| **Severity reduced**         | High → none (UX-015, UX-020); Medium → none (UX-034)                                                 |
| **Type**                     | Content + Visual system                                                                              |
| **Decision**                 | Implementation-defined                                                                               |
| **Size**                     | M                                                                                                    |
| **Risk**                     | Low                                                                                                  |
| **Dependencies**             | WP-024, WP-025                                                                                       |
| **Blocks**                   | WP-027                                                                                               |
| **Parallel with**            | WP-029, WP-030                                                                                       |

**Current behaviour.** `ToolResult.tsx:783` appends `<details class="tool-result-raw"><summary>Raw JSON</summary>` to **every** result — verified three results produced three disclosures. All cards share `.result-card`; mutating cards add `.staged-card` (`ToolResult.tsx:333, 424, 468, 596`) but are otherwise visually equivalent to informational ones. `StagedEditResult` (`:592–608`) shows `nodes 45 → 46 · leaves 6 → 7` and offers `Preview on board` / `Accept` / `Reject` with no statement of scope or reversibility. `ErrorResult` (`:687–693`) shows the mapped label, an optional reason, and `<div class="result-code">{code}</div>` — the raw code — with no recovery action.

**Target behaviour.** Three visually distinct card tiers: informational (flat), navigational (subtle border plus a go action), mutating (accent left border, a `Changes your repertoire` badge, a scope line in moves and lines, and a reversibility line). Raw payloads are behind one global `Show technical details` setting, off by default. Errors state a cause and offer a recovery action.

**Implementation approach.**

- `ToolResult.tsx` gains a `tier` concept derived from the renderer registry: `byKind` entries and `strategic_fit_portfolio`/`proposal`/`plan_card` are mutating; results containing navigable paths are navigational; the rest informational. The tier drives a class on `.result-card`; no per-card rewrite.
- Raw disclosure is rendered only when a new `showTechnicalDetails()` setting (in `store/settings.ts`, persisted to localStorage, default false) is true. `ErrorResult`'s `result-code` follows the same setting.
- `StagedEditResult` copy comes from `content/chat.ts` and is expressed in moves and lines using `content/format.ts` — the underlying `before`/`after` node and leaf counts are retained in the payload and shown only under technical details.
- `ErrorResult` renders `{ title, cause, action }` from `content/errors.ts`; the `action` is a typed union (`retry` | `open-settings` | `open-lichess-token` | `none`) so the card can render a real button.
- `styles.css`: three tier treatments using surface elevation and a left accent border — no size increase, preserving density.

**Existing behaviour to preserve.** The typed renderer registry and every specialised renderer (`StrategicFitResult`, `StrategicFitRetrievalResult`, `StrategicFitProposalResult`, `StrategicFitPlanBasisResult`, `StrategicFitPlanCardResult`, `StrategicFitPortfolioConstraintsResult`, `StrategicFitPortfolioResultCard`, `StagedEditResult`, `ArtifactResult`). **All staged-mutation copy must survive verbatim in meaning**: "Nothing is saved until you accept…", "Withheld evidence exists; it is not absent…", "Nothing is bound and no preference was saved…". The `pending`/`stale`/`unavailable` status rendering and its exact messages. `findArtifactMetadata` and the artifact save flow.

**Acceptance criteria.**

- With `Show technical details` off, no `Raw JSON` disclosure and no raw error code appears anywhere in the chat log; with it on, both appear.
- A mutating card is visually distinguishable from an informational card by a non-colour cue (border weight or a badge), verified under `forced-colors: active`.
- A staged-edit card states the change in moves and lines, states that acceptance affects the working repertoire in this browser, and states that it can be undone.
- An `engine_unavailable` error card offers a working `Retry`; an `explorer_auth_required` card offers `Add Lichess token` that opens Settings focused on the token field.
- Every existing staged-mutation sentence listed above is still present (assert by text match in the Strategic Fit chat spec).
- The Strategic Fit chat specs (`strategic-fit-chat.spec.ts`, `strategic-fit-plan.spec.ts`, `strategic-fit-portfolio.spec.ts`) pass with only the technical-details toggle accounted for.

**Automated tests.** Fixture-driven card-tier spec; a technical-details on/off spec; an error-action spec per action kind; text-preservation assertions for the staged-mutation copy.

**Manual validation.** Forced-colors check of the tier differentiation.

**Failure and rollback.** Regression mode: hiding `Raw JSON` removes a debugging affordance developers rely on. Mitigation: the setting is discoverable in Settings and defaults on in DEV builds. Rollback: revert the gating condition alone.

---

### WP-027 — Chat context, run history, and per-tool cancellation

|                              |                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Objective**                | Show what the assistant can see, keep the record of what ran, and scope stop and retry honestly. |
| **Audit findings addressed** | UX-046, UX-040, UX-047                                                                           |
| **Severity reduced**         | Medium → none (all three)                                                                        |
| **Type**                     | Workflow                                                                                         |
| **Decision**                 | Implementation-defined — feasibility traced, see below                                           |
| **Size**                     | M                                                                                                |
| **Risk**                     | Medium — touches the chat turn loop                                                              |
| **Dependencies**             | WP-010, WP-024, WP-026                                                                           |
| **Blocks**                   | WP-028                                                                                           |
| **Parallel with**            | WP-029, WP-031                                                                                   |

**Current behaviour.** `chat.ts:52–59` `systemMessage()` injects normalized FEN, repertoire colour, selected SAN path, document type, revision, filename, and tree stats on every turn — none of it visible to the user. `chat.ts:143–165` `executeCalls` runs tool calls **sequentially** in a `for` loop sharing one turn-level `AbortSignal`; `toolRuns` is reset at `chat.ts:172` on every `send()`, so the previous turn's run record is destroyed. `ChatPanel.tsx:106–122` renders `toolRuns()` after the whole log rather than beside the message that caused it. `stop()` aborts the turn controller; `retry()` re-sends `lastRequest` (the last user text).

**Per-tool cancellation feasibility (traced, D7).** `executeBrowserCommand` accepts and re-checks `options.signal` (`client.ts:13, 19`) and forwards it to implementations. `engine/stockfish.ts` honours a per-job signal including cancelling **queued** jobs (`:251–261`). Therefore per-tool cancellation requires exactly one change: in `executeCalls`, create a child `AbortController` per call, abort it when either the turn signal aborts or the user cancels that run, and pass the child signal down. Because calls are sequential, a `queued` run is cancelled by skipping it — already the behaviour at `chat.ts:146`. **This is feasible and is committed to.**

**Target behaviour.** A context chip above the input summarising what the assistant can see, expandable to the full injected block. Tool runs attach to the assistant message that requested them and persist for the conversation. A running tool has its own `Cancel`. `Stop this request` stops the turn; `Send again` re-sends the last message, and its tooltip says so.

**Implementation approach.**

- `chat.ts`: move `toolRuns` from a flat signal into the message history — the assistant message that carries `tool_calls` gains a parallel `runs` record keyed by `tool_call_id`. Remove the `setToolRuns([])` reset. Keep `ToolRunState`'s shape and its `ExecutionStatus` values.
- `executeCalls`: per-call `AbortController` linked to the turn signal; expose `cancelRun(id)`.
- Register each run with the operation registry (`WP-010`) so it also appears in the activity strip.
- New `src/components/ChatContextChip.tsx` rendering a summary derived from the same values `systemMessage()` uses, with a disclosure showing the exact injected text. Source the values from one shared function so the chip cannot drift from the prompt.
- `ChatPanel.tsx` renders runs inline under their assistant message; labels via `taskLabel()`.
- Relabel `Stop` and `Retry` from `content/chat.ts`.

**Existing behaviour to preserve.** `MAX_ROUNDS = 12` and the round-limit summary turn (`chat.ts:188–193`) with its exact message. The abnormal-finish handling. `compactMessages`/`compactToolResult` and the `REFERENCE_KEYS` pinning of Strategic Fit identities — **this is the mechanism that keeps `report_id`/`finding_id` valid across compaction and must not be disturbed**. The `focus` message role and `focusLine`. `clearChat`'s semantics. The existing `test/chat.test.ts` and `test/cancellation.test.ts` must pass.

**Acceptance criteria.**

- The context chip shows the current position in SAN, the repertoire colour, the document name, and the line count; expanding it shows text equal to the block `systemMessage()` injects.
- After two consecutive turns, the first turn's tool runs are still visible under their message.
- A running tool exposes a `Cancel` control; activating it marks that run `cancelled`, leaves earlier completed runs intact, and allows the turn to continue to the next call.
- `Stop this request` cancels the in-flight call and the turn; already-completed runs stay `completed`.
- `Send again` re-sends the last user message and its accessible description says so.
- Strategic Fit identities survive compaction unchanged (existing `chat.test.ts` compaction assertions pass).
- Each chat tool run appears in `operations()` while running.

**Automated tests.** Extend `test/chat.test.ts` with per-call cancellation (a fake executor that blocks on the second call), run-history persistence across turns, and context-summary parity with `systemMessage()`. Playwright for the chip and the cancel control.

**Manual validation.** A real OpenRouter turn with a long-running tool, to confirm cancel latency is acceptable.

**Failure and rollback.** Regression mode: the child-controller wiring leaking so a per-run cancel aborts the turn. Detection: the blocking-executor test. Rollback: revert; run history returns to per-turn.

---

### WP-028 — Result-to-board back-references

|                              |                                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| **Objective**                | Keep the user's place when a chat or panel result moves the board. |
| **Audit findings addressed** | UX-038                                                             |
| **Severity reduced**         | Low → none                                                         |
| **Type**                     | Workflow                                                           |
| **Decision**                 | Implementation-defined                                             |
| **Size**                     | S                                                                  |
| **Risk**                     | Low                                                                |
| **Dependencies**             | WP-027                                                             |
| **Blocks**                   | none                                                               |
| **Parallel with**            | WP-029, WP-032                                                     |

**Current behaviour.** `AnalysisPanel.tsx:62–84` renders `Suggested (from chat)` with Accept/Reject but no link to the message that produced it. `ToolResult`'s `.result-nav` buttons call `actions.goto` with no indication afterwards of which result is showing.

**Target behaviour.** The suggestion block links to its source message. The card that last moved the board is marked `Showing on board` until another result supersedes it.

**Implementation approach.** `store/suggestions.ts`'s `Suggestion` gains `sourceMessageIndex`. A new `store/ui.ts` signal `lastNavigationSource: { kind: "chat" | "repertoire"; id: string } | null` is set by every navigation-producing control and read by the cards. Scrolling to a message uses an id on the message element.

**Existing behaviour to preserve.** `acceptSuggestion`/`rejectSuggestion` semantics, the blue suggestion arrows and their `pathEq` gating, `previewedKeys()` highlighting.

**Acceptance criteria.**

- Activating a `Go to line` button marks that card `Showing on board`; activating another moves the marker.
- The suggestion block's source link scrolls the chat log to the originating message and focuses it.
- Navigating by any other means (move tree, arrow keys) clears the marker.

**Automated tests.** Playwright: marker set, moved, and cleared; source link scroll target.

---

### WP-029 — Repertoire states, single-action artifacts, and plain-language evidence

|                              |                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Split conflated states, distinguish errors from empties, collapse two-step exports, and make numeric evidence readable. |
| **Audit findings addressed** | UX-036, UX-037, UX-039, UX-042                                                                                          |
| **Severity reduced**         | Medium → none (all four)                                                                                                |
| **Type**                     | Content + Workflow                                                                                                      |
| **Decision**                 | Implementation-defined                                                                                                  |
| **Size**                     | M                                                                                                                       |
| **Risk**                     | Low                                                                                                                     |
| **Dependencies**             | WP-011, WP-022, WP-024                                                                                                  |
| **Blocks**                   | none                                                                                                                    |
| **Parallel with**            | WP-026, WP-030                                                                                                          |

**Current behaviour.** `RepertoirePanel.tsx:246` renders `"No scan yet — or no gaps."` for two opposite states. Scan errors render through `.empty` at `:96`, `:244`, `:293`, `:323` — visually identical to empty results. `:194–199` renders `Generate CSV deck` and, after it completes, `Save CSV deck` — two identical-looking buttons in the same slot; `:222` has the same pattern for the annotated PGN. `:350–372` renders the Shorten inspect panel with `evalΔ`, `fit 0.33→0.5`, `structureStay→structureTranspose`, `↓`/`★` badges whose meaning is only in `title`, and the sentence "fit weak — branches resemble the repertoire about equally". `:191` renders `margin {n}cp`.

**Target behaviour.** Every tool has a distinct pre-run call to action, a distinct clean result, and a distinct error treatment with a retry. Export tools are one action with an internal progress-to-download state. The Shorten inspect panel leads with a verdict sentence and puts the numbers under a `Why?` disclosure with text-labelled badges. Numeric evidence carries a plain-language reading alongside the number.

**Implementation approach.** Per-tool components from `WP-022` each render `RegionState`-shaped empties (primitive lands in `WP-037`; use its shape now) and a new `ErrorState` treatment with a retry that re-invokes the same command with the same arguments. The two-step export becomes one `executeCommand` chain: run, then auto-invoke `saveArtifact` on the returned `artifact_id`, with the button's label reflecting the phase. Copy and the plain readings come from `content/repertoire.ts` using `{ plain, expert }` pairs — `margin 47cp` becomes label `only move by 0.47` with expert text `margin 47 cp`.

**Existing behaviour to preserve.** **All analytical data and its meaning.** Every field currently shown must still be reachable — `evalDelta`, `fitStay`, `fitTranspose`, `structureStay`, `structureTranspose`, `basis`, `eval_disagrees_with_fit`, `introduces_gap`, `new_gaps.length`, `bestSavings`, `bestEval`, `evalConfirmed`, `savedPlies` — moved under a disclosure, never removed. The covered-by-transposition muted rows. The `best eval`/`best fit`/`alt` labelling logic (`RepertoirePanel.tsx:264–267`). The artifact `saveArtifact` flow and its `artifactById` availability check.

**Acceptance criteria.**

- Before any Gaps scan the section shows a call to action naming what the scan does; after a scan finding nothing it shows a distinct success message; the two strings differ.
- A failed scan renders an error treatment distinguishable from an empty state without colour, with a retry that re-runs the same command and arguments.
- Creating a drill deck is one button; it shows progress and then downloads, with no second button appearing.
- Creating an annotated repertoire is one button with the same pattern.
- The Shorten inspect panel's first line is a verdict sentence; every numeric field listed above is present under a disclosure; `↓` and `★` each have a visible text label.
- `margin` values render as a plain reading with the centipawn value available as expert text.
- No analytical field present before the change is absent after it (assert by a field-presence spec over a fixture inspect result).

**Automated tests.** A field-presence spec written before the change and passing against current code; state-distinction specs per tool; a single-action export spec asserting exactly one button and one download.

**Manual validation.** Forced-colors check of the error-versus-empty distinction.

**Failure and rollback.** Regression mode: an evidence field lost under the disclosure refactor. Detection: the field-presence spec. Rollback: per-tool revert is possible because `WP-022` split them into separate components.

---

### WP-030 — Strategic Fit display names and raw-identifier suppression

|                              |                                                                           |
| ---------------------------- | ------------------------------------------------------------------------- |
| **Objective**                | Stop showing hashes where a name belongs.                                 |
| **Audit findings addressed** | UX-016                                                                    |
| **Severity reduced**         | High → none                                                               |
| **Type**                     | Content                                                                   |
| **Decision**                 | Implementation-defined for the mechanism; the naming rule is `PD-6` (§14) |
| **Size**                     | M                                                                         |
| **Risk**                     | Low                                                                       |
| **Dependencies**             | WP-024                                                                    |
| **Blocks**                   | WP-031                                                                    |
| **Parallel with**            | WP-017, WP-022, WP-026                                                    |

**Current behaviour.** `StrategicFitWorkspace.tsx:519, 525, 534, 578` call `strategicFitCohortDisplayName(cohortId, cohortId)` — the fallback **is** the identifier. Verified in a live run: the cohort filter lists `cohort:314849cdced212ef (1)`, `cohort:327fa53b3f7d438f (0)`, …; finding cards show `Cohort cohort:b6b48b1c47f62275`; the strategic map lists excluded branches as `fda16c53`, `96c967e8`, `197aee69`, `794e44db`. The same findings already carry human opening names (`Traditional Variation`, `London System`, `Wade-Tartakower Defense`, `with e6`) in their `opening_scope` field.

**Target behaviour.** Every cohort and branch is identified by its dominant opening plus a size, e.g. `London System (3 lines)`. Identifiers remain available in a detail row and in `Show technical details`, and are still copied verbatim into chat when the assistant needs them.

**Implementation approach.** A new `src/store/strategic-fit-names.ts` deriving a display name per `cohort_id` from the findings in the current report — the most frequent `opening_scope` among the cohort's findings, with a branch count, and a disambiguating suffix when two cohorts resolve to the same name. Branch identifiers get the same treatment from their `source_san_paths`. `strategicFitCohortDisplayName`'s call sites pass the derived name instead of the id. Identifiers render only inside `<code>` in a detail row gated on `showTechnicalDetails()`.
**`PD-6`.** Whether a cohort should be named by its dominant opening or by its structural signature is a product judgement with different failure modes (opening names collide; structural signatures are less familiar). Default: dominant opening with a count, because the data is already displayed on the cards.

**Existing behaviour to preserve.** **The identifiers themselves must remain exact everywhere the assistant or the retrieval projection uses them.** `chat.ts`'s `REFERENCE_KEYS` pinning of `cohort_id`, `report_id`, `finding_id` is untouched. The `BROWSER_ADAPTATION` prompt rule "preserve report_id and finding_id exactly in follow-up discussion" stays true. Cohort override and editing flows (`CohortEditor`, `strategic-fit-cohort-adjustments.ts`) keep operating on ids.

**Acceptance criteria.**

- `rawIdentifierViolations(strategicFitWorkspace)` is empty with `Show technical details` off (baseline check 8 fully flips).
- Every cohort selector option, finding card, evidence header, and map/heatmap axis label shows a name plus a count, not a hash.
- Two cohorts resolving to the same opening name are disambiguated visibly.
- With `Show technical details` on, the underlying `cohort_id` is visible in a detail row.
- Chat retrieval results still contain exact `report_id`, `finding_id`, and `cohort_id` values (existing `strategic-fit-retrieval.test.ts` and `strategic-fit-chat.spec.ts` pass unchanged).
- Cohort override, finding resolution, and training-exception flows still round-trip by id (existing store suites pass unchanged).

**Automated tests.** A name-derivation store test including the collision case and a cohort with no findings; the raw-identifier sweep; the unchanged existing suites.

**Manual validation.** Review with a chess-literate reader that the derived names are recognisable.

**Failure and rollback.** Regression mode: a name derived from too few findings being misleading. Mitigation: fall back to `Comparison group N (k lines)` when the dominant opening covers under half the cohort. Rollback: revert; ids return.

---

### WP-031 — Limited-evidence framing and the zero-comparable-route terminal state

|                              |                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Stop claiming success when nothing was measured, and give the user a next action when the repertoire cannot support the analysis. |
| **Audit findings addressed** | UX-017                                                                                                                            |
| **Severity reduced**         | High → none                                                                                                                       |
| **Type**                     | Content + Workflow                                                                                                                |
| **Decision**                 | Implementation-defined for the state machine; the threshold copy is `PD-7` (§14)                                                  |
| **Size**                     | M                                                                                                                                 |
| **Risk**                     | Low — additive presentation over an unchanged analysis                                                                            |
| **Dependencies**             | WP-024, WP-030                                                                                                                    |
| **Blocks**                   | WP-032                                                                                                                            |
| **Parallel with**            | WP-027, WP-029                                                                                                                    |

**Current behaviour.** Verified on a six-line repertoire: the header shows `Analysis complete` (`STRATEGIC_FIT_LIFECYCLE_LABELS.completed`, `AnalysisLifecycle.tsx:16`) while `PreflightResults` shows `Preflight degraded`, `Routes found 6 / Comparable routes 0 / Incomplete routes 6`, and all six findings read `Uncertain · Incomplete strategic evidence · Low confidence · 0/100 · Replacement: Insufficient evidence · Training: Insufficient evidence`. The Evidence pane then shows `No typical-versus-branch dimensions are available`, `Contribution breakdown is unavailable`, and `Board unavailable at this milestone` five times. No state names the threshold or the remedy.

**Target behaviour.** The header status reflects the evidence state, not just the lifecycle. When `comparable_route_count === 0`, the findings, evidence, and resolution regions are replaced by a single terminal state naming the threshold, the current counts, and two concrete remedies, with an `Analyze again` action. When comparable routes exist but preflight is degraded, findings render as today with a persistent limited-evidence banner.

**Implementation approach.** A derived `strategicFitEvidenceState()` in `store/strategic-fit.ts`: `"none" | "limited" | "full"` from `preflight.state` and `preflight.comparable_route_count`. `AnalysisLifecycle`'s completed label becomes `Analysis finished — limited evidence` when the state is `limited` or `none`. A new `src/components/strategic-fit/InsufficientEvidence.tsx` rendered by `StrategicFitWorkspace` in place of the three content panes when the state is `none`. Copy from `content/strategicFit.ts`; the ply/route thresholds are read from the preflight issue payloads rather than hard-coded, so the message cannot drift from the analysis (`PD-7` covers whether to state a specific number or a qualitative threshold).

**Existing behaviour to preserve.** **The analysis itself, the preflight payload, and every honest bounded-evidence statement.** `PreflightResults` keeps its counts and issue list. The finding cards' `Insufficient evidence` labels remain when findings render. The "no cohort produced a strategic mode" style explanations stay — they are correct and the audit calls them a strength; they simply stop being the only thing the user sees. All existing Strategic Fit specs, especially `strategic-fit-preflight.spec.ts` and `strategic-fit-preflight-presentation.test.ts`, must pass.

**Acceptance criteria.**

- With `comparable_route_count === 0`: the header does not read `Analysis complete`; the findings, evidence, and resolution regions render one terminal state naming the current route counts and at least two remedies; `Analyze again` is present and works.
- With `comparable_route_count > 0` and `preflight.state === "degraded"`: findings render as today plus a persistent limited-evidence banner, and the header reads the limited-evidence label.
- With a full-evidence report, the header reads `Analysis complete` and no banner appears.
- The preflight counts and issue list are unchanged in all three cases.
- A positive-control fixture (the `RICH_PGN` from `WP-000`, ≥12 routes past ply 12) produces a full-evidence report and reaches the resolution step.
- `strategic-fit-preflight.spec.ts` and the preflight presentation test pass unchanged.

**Automated tests.** Three-state spec driven by fixture reports through `window.__chess.setResolutionProofForTesting`-style seams or a fixture lifecycle result; a positive-control end-to-end run.

**Manual validation.** Confirm with a chess reader that the remedies are actionable ("extend your main lines past move 12" must be something a user can actually do).

**Failure and rollback.** Regression mode: the terminal state hiding findings that were in fact useful. Mitigation: it triggers only on `comparable_route_count === 0`, and the raw report stays available under technical details. Rollback: revert.

---

### WP-032 — Strategic Fit process-telemetry collapse

|                              |                                              |
| ---------------------------- | -------------------------------------------- |
| **Objective**                | Put results above the machine's self-report. |
| **Audit findings addressed** | UX-018                                       |
| **Severity reduced**         | High → none                                  |
| **Type**                     | Workflow                                     |
| **Decision**                 | Implementation-defined                       |
| **Size**                     | S                                            |
| **Risk**                     | Low                                          |
| **Dependencies**             | WP-031                                       |
| **Blocks**                   | none                                         |
| **Parallel with**            | WP-028, WP-034                               |

**Current behaviour.** Verified at 1440×900 after a completed analysis: six `Analysis phases` cards plus the `Preflight results` block occupy the entire first screen; the first finding is below the fold. `AnalysisProgress` renders while `request_id !== null` (`AnalysisLifecycle.tsx:115`) and `PreflightResults` renders on completion (`:118`).

**Target behaviour.** While running, the phase list stays full-size — it is the progress display. On completion it collapses to one line (`All six phases completed ▸`) that expands on demand. Preflight collapses to a one-line summary with its counts and a disclosure holding the issue list. The first finding is visible without scrolling at 1280×800.

**Implementation approach.** `AnalysisLifecycle.tsx` renders `AnalysisProgress` in a collapsed variant when `status === "completed"`. `PreflightResults` gains a `collapsed` prop defaulting to true on completion. Both remain fully expanded in print/export mode.

**Existing behaviour to preserve.** **Print and export mode must still render everything.** `strategicFitPrintExportMode()` (`store/ui.ts:37`) and the `beforeprint`/`afterprint` handlers (`StrategicFitWorkspace.tsx:393–396`) must force both blocks open — this is the same contract the visualisation components already honour. The running-state progress display is unchanged. `PreflightResults`' counts and issues are unchanged when expanded.

**Acceptance criteria.**

- After a completed analysis at 1280×800, the first finding card's top edge is within the viewport without scrolling the findings pane.
- The phase list renders at full size while `status` is `running` or `provisional`.
- The collapsed phase line and preflight summary each expand on activation and are keyboard operable with `aria-expanded`.
- In print/export mode and under `window.print()`, both blocks render fully expanded (assert via the existing print-mode test pattern).
- `strategic-fit-lifecycle.spec.ts` and `strategic-fit-preflight.spec.ts` pass unchanged apart from the collapse state.

**Automated tests.** A viewport assertion for first-finding visibility; a print-mode expansion assertion.

---

### WP-033 — Persistent Strategic Fit stage model

|                              |                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Objective**                | Give the workspace one progression model at every width, and remove the duplicated resolution rendering. |
| **Audit findings addressed** | UX-033                                                                                                   |
| **Severity reduced**         | Medium → none                                                                                            |
| **Type**                     | Workflow + Architecture                                                                                  |
| **Decision**                 | **Design validation required** (`DV-5`, §14)                                                             |
| **Size**                     | M                                                                                                        |
| **Risk**                     | Medium — the app's best-tested surface                                                                   |
| **Dependencies**             | WP-007, WP-031                                                                                           |
| **Blocks**                   | WP-035                                                                                                   |
| **Parallel with**            | WP-034, WP-036                                                                                           |

**Current behaviour.** `styles.css:1711–1713` sets `.strategic-fit-stage-nav { display: none }`; `:4613` restores it as a grid inside `@media (max-width: 820px)`. `StrategicFitWorkspace.tsx:128, 349–352` computes `usesStageTabs` from `matchMedia("(max-width: 820px)")` and switches roles between `tablist`/`tab`/`tabpanel` and plain `region`s. Verified at 1440×900: three panes visible, the resolution pane `display: none`, and resolution actions duplicated into the evidence pane by `:630–650` while `:672` renders them again for the compact tier. The workspace also implements its own focus trap rather than using the `Dialog` primitive from `WP-007`.

**Target behaviour.** A persistent stage indicator at all widths showing `Overview → Findings → Evidence → Decide` with the current stage marked and completed stages indicated. Wide viewports keep three visible columns but gain a fourth decide column or a persistent decide region — resolved by `DV-5`. Resolution actions are rendered once.

**Implementation approach.** Extract the duplicated `ResolutionActions`/`TrainException`/`CohortEditor` block into one `ResolutionPanel` component rendered in exactly one place per tier. Replace `usesStageTabs` with a single stage model that renders a progress strip at all widths and switches only the _panel visibility_ strategy by tier. Migrate the workspace's focus trap onto `Dialog` (`nested` support already required for the Replacement Lab).
**`DV-5` gate.** Whether the wide tier gains a fourth column or a persistent decide region below the evidence column is a layout decision with real trade-offs at 1101–1440 px, where four columns would each be ~280 px. Default if inconclusive: keep three columns and render the decide region at the bottom of the evidence column, with the stage strip making the progression explicit — this is closest to today's behaviour and lowest risk.

**Existing behaviour to preserve.** Every Strategic Fit accessibility behaviour verified today: focus trap, `Escape`, focus restoration, `inert` + `aria-hidden` on `.app-main`, the roving-tabindex tablist with `Home`/`End` in the compact tier, print/export mode, reduced motion, forced colors, and the chart/table fallbacks. The 22 existing specs are the gate. The resolution-blocked message when the report is `stale` (`StrategicFitWorkspace.tsx:224–233, 651–655`).

**Acceptance criteria.**

- A stage indicator is visible at 390×844, 820×1000, 1101×800, and 1440×900, showing the current stage.
- `ResolutionActions`, `TrainException`, and `CohortEditor` each appear exactly once in the DOM at every width.
- The stale-report resolution-blocked message appears at every width.
- The compact tier's tablist keyboard behaviour (`←`/`→`/`Home`/`End`, roving tabindex, `aria-selected`) is unchanged.
- The workspace uses the `Dialog` primitive and satisfies its full contract; the Replacement Lab still nests correctly with `Escape` closing the Lab first.
- All 22 Strategic Fit specs pass, including `strategic-fit-accessibility.spec.ts`.

**Automated tests.** Duplicate-render assertions; stage-indicator presence at four widths; the existing suite as the regression gate; the `Dialog` contract suite extended to the workspace and the Lab.

**Manual validation.** Screen-reader pass after the `Dialog` migration (gate AG-1 re-run).

**Failure and rollback.** Highest risk in the Strategic Fit workstream. Mitigation: split into two PRs — (a) de-duplicate the resolution block and add the stage strip, (b) migrate to `Dialog` — so a focus regression can be reverted without losing the stage work.

---

### WP-034 — Strategic Fit vocabulary and explanations

|                              |                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Objective**                | Replace mechanism vocabulary with the user's question, without weakening the evidence statements.       |
| **Audit findings addressed** | UX-043, and the Strategic Fit rows of the audit terminology table                                       |
| **Severity reduced**         | Low → none (UX-043); supports UX-016, UX-017                                                            |
| **Type**                     | Content                                                                                                 |
| **Decision**                 | **Product decision required** for the `resolution proof` and `training exception` renames (`PD-8`, §14) |
| **Size**                     | M                                                                                                       |
| **Risk**                     | Low                                                                                                     |
| **Dependencies**             | WP-024, WP-030                                                                                          |
| **Blocks**                   | none                                                                                                    |
| **Parallel with**            | WP-032, WP-033                                                                                          |

**Current behaviour.** `ResolutionProof.tsx:9–20` `PROOF_STATUS_LABELS` reads `No accepted change`, `Awaiting affected-cohort rescan`, `Rescanning affected cohorts`, `Post-rescan result available`, `Evidence superseded by another edit`, `Rescan failed`, `Rescan cancelled`, `Undoing accepted change`, `Undo rejected`, `Undo applied and rescanned`. `ProfileSetup` repeats the same advanced-preference sentence verbatim for four sliders and uses the undefined term "strategic distance". The strategic map's axis explanation reads "Horizontal position is the explainable strategic distance from the heaviest weighted repertoire route (no cohort produced a strategic mode)". `TrainException`, `ChangeSetPreview`, `preflight`, and `Pareto status` all surface mechanism vocabulary.

**Target behaviour.** Per the audit terminology table: `Resolution proof` → `Did this help?` with plain statuses; `Training exception` → `Keep and train this line`; `preflight` → `Evidence check`; `Pareto status` → `No better option on every measure` / `Beaten by <name>` with the expert term as a secondary line; `strategic distance` defined once before first use; the four advanced sliders reduced to a name plus a two-word effect under one shared definition.

**Implementation approach.** All strings move to `content/strategicFit.ts` (already created by `WP-024`) and are then reworded. Expert terms are retained through the `{ plain, expert }` pair so `Pareto-optimal` still appears for readers who want it. No component logic changes.
**`PD-8`.** Renaming `resolution proof` and `training exception` changes vocabulary that appears in the workflow contract prompts (`packages/chess-tools/src/workflow-contract.ts`) and in the generated skills. Decide whether the UI diverges from the contract vocabulary (UI-only rename, contract unchanged) or both change together. Default: **UI-only rename**, because the contract vocabulary is consumed by the assistant and by MCP hosts, and changing it is out of this plan's scope.

**Existing behaviour to preserve.** **Every bounded-evidence and staged-mutation statement's meaning.** Specifically: "Withheld evidence exists; it is not absent, and it cannot be cited in a plan", "Nothing is saved until you accept", "Nothing is bound and no preference was saved", "This route shares no supported comparable evidence with an anchor route, so a position would be fabricated rather than measured", and the "Analysis in progress / Nothing is current until the report completes" copy. These may be shortened only if the reviewer confirms the meaning is intact. The profile wizard's structure, `RECOMMENDED` badge, consequence statement, and `Skip for now` are preserved exactly.

**Acceptance criteria.**

- `Pareto` does not appear as a primary label; it appears only as expert text.
- `preflight` does not appear as a primary label.
- `resolution proof` and `training exception` do not appear as primary labels (subject to `PD-8`).
- `strategic distance` is defined in prose before its first use on any surface where it appears.
- The four advanced-preference fields share one definition and have distinct, non-repeated help text.
- Each of the five preserved statements listed above is still present, verbatim or with a reviewer-approved equivalent, asserted by text match.
- `packages/chess-tools` is unmodified.

**Automated tests.** Text-presence assertions for the preserved statements; a vocabulary sweep asserting the retired primary labels are absent from rendered text.

**Manual validation.** A chess-literate reviewer confirms the rewordings do not change meaning — this is the merge gate for this package.

---

### WP-035 — Strategic Fit Review/Redesign split: validation checkpoint

|                              |                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Decide, with evidence, whether the workspace should become two focused modes.                                   |
| **Audit findings addressed** | Audit §4 (E2), §7, §13 Phase E — no numbered finding; the audit explicitly flags this as an XL product decision |
| **Severity reduced**         | —                                                                                                               |
| **Type**                     | Workflow (research)                                                                                             |
| **Decision**                 | **Product decision required** (`PD-5`, §14)                                                                     |
| **Size**                     | S (this package is the study, not the split)                                                                    |
| **Risk**                     | Low as a study; XL if the split proceeds                                                                        |
| **Dependencies**             | WP-031, WP-032, WP-033                                                                                          |
| **Blocks**                   | any future split                                                                                                |
| **Parallel with**            | WP-036–WP-038                                                                                                   |

**Rationale.** The audit recommends considering a split but is explicit that it is not an automatic implementation requirement, and that `WP-033`'s stage strip may already resolve the overload. Committing to an XL restructuring before that is measured would be exactly the "redesign to appear comprehensive" the audit warns against.

**Approach.** After `WP-033` ships, run the §14 `PD-5` study: five participants, two tasks (a review task ending in a decision, and a redesign task ending in an applied change set), measuring time to first finding, number of times a participant enters a redesign surface while doing review work, and self-reported clarity of where they are. Recommend a split only if participants enter redesign surfaces unintentionally in ≥2 of 5 sessions or cannot state their current stage.

**Acceptance criteria.** A written recommendation in `docs/` with the measurements, a recommendation, and — if the split is recommended — a scoped follow-up package proposal. No production code changes in this package.

---

### WP-036 — Design tokens

|                              |                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | One token set for type, spacing, surfaces, borders, status, motion, focus, targets, and layering, extracted from what the repository already does well. |
| **Audit findings addressed** | UX-030, UX-048 (token half)                                                                                                                             |
| **Severity reduced**         | Medium → none (UX-030); High → Medium (UX-048; primitives half in WP-037)                                                                               |
| **Type**                     | Visual system                                                                                                                                           |
| **Decision**                 | Implementation-defined                                                                                                                                  |
| **Size**                     | L                                                                                                                                                       |
| **Risk**                     | Medium — touches `styles.css` globally                                                                                                                  |
| **Dependencies**             | WP-006                                                                                                                                                  |
| **Blocks**                   | WP-037                                                                                                                                                  |
| **Parallel with**            | WP-033, WP-034                                                                                                                                          |

**Current behaviour.** Six `:root` variables (`--bg --panel --border --text --muted --accent`). ~40 hard-coded hexes in the Strategic Fit half (`#24272d`, `#20242a`, `#31343c`, `#4d5561`, `#596473`, …). Over 100 rules set text below 12 px (32× `0.72rem`, 32× `0.68rem`, 18× `0.62rem`, 12× `0.57rem`); 32 distinct `font-size` values in total. Spacing is inline `rem` with no rhythm. Two magic `z-index` values (100, 120). 24 `!important` declarations.

**Target behaviour.** No intended visual change beyond the type floor. A documented token block; all core-app rules consuming tokens; the Strategic Fit half migrated where it is mechanical.

**Implementation approach.**

- Step 1 (additive, no visual change): add the full token block to `:root`, values chosen to equal the most common current value in each role. Ship and verify zero visual diff.
- Step 2 (type): introduce the six-step scale with a `0.75rem` floor for body text and `0.7rem` reserved for uppercase micro-labels. Migrate the sub-`0.75rem` body rules. **This is the only intended visual change** and it will make some panels taller — the density guard from `WP-006`/`WP-011` applies (≤15% growth per panel).
- Step 3 (spacing, surfaces, borders): mechanical replacement, one stylesheet region per commit.
- Step 4: replace the two `z-index` magic numbers with `--z-*`; audit the 24 `!important`s and remove those made unnecessary by the tier reorganisation from `WP-020`.
- **Constraint (D12):** no external font, icon, or asset may be introduced — COEP `require-corp` would break the engine. Typography stays on the existing `ui-sans-serif, system-ui, sans-serif` stack.

**Existing behaviour to preserve.** Chessground's imported theme CSS (`styles.css:1–4`) is untouched. The 16 px input floor for iOS. All Strategic Fit visual behaviour verified by its screenshot-backed specs (`strategic-fit-map.spec.ts-snapshots`, `strategic-fit-findings.spec.ts-snapshots`, `strategic-fit-visualization-hardening.spec.ts-snapshots`) — **these snapshots are the regression gate for this package and must be reviewed, not blanket-updated.**

**Acceptance criteria.**

- A documented `:root` token block exists covering all nine categories.
- No rendered body text is below 12 px; uppercase micro-labels may be as small as 11.2 px and are explicitly listed.
- No hard-coded hex colour remains in the core-app region of `styles.css` (the Strategic Fit region may retain hexes not yet migrated, listed explicitly).
- `z-index` literals appear only in the token block.
- Step 1 produces a zero-pixel visual diff across the Strategic Fit snapshot suite.
- After step 2, no panel's rendered height at 1280×800 grows by more than 15% versus the pre-change baseline.
- Any snapshot update is accompanied by a reviewer note stating what changed and why.

**Automated tests.** The existing Strategic Fit visual snapshots as the primary gate; the density guard assertions; a stylesheet assertion that raw hexes and `z-index` literals do not appear outside allowed regions.

**Manual validation.** A side-by-side review of the type migration at 1280×800 and 390×844 before merge.

**Failure and rollback.** Regression mode: the type floor breaking dense analytical layouts. Mitigation: step 2 is a separate commit; the density guard fails before merge. Rollback: revert step 2 alone, keeping the tokens.

---

### WP-037 — Presentation primitives

|                              |                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**                | Replace five parallel status systems, three progress patterns, two empty-state patterns, three header patterns, and eleven button treatments with one of each. |
| **Audit findings addressed** | UX-048 (primitive half), audit §10                                                                                                                             |
| **Severity reduced**         | High → none (UX-048)                                                                                                                                           |
| **Type**                     | Visual system + Architecture                                                                                                                                   |
| **Decision**                 | Implementation-defined                                                                                                                                         |
| **Size**                     | L                                                                                                                                                              |
| **Risk**                     | Medium — broad but mechanical                                                                                                                                  |
| **Dependencies**             | WP-036                                                                                                                                                         |
| **Blocks**                   | WP-038                                                                                                                                                         |
| **Parallel with**            | WP-035                                                                                                                                                         |

**Current behaviour.** Status: `.sev-*`, `.fit-*`, `.tool-run.*`, `.result-status.*`, `.strategic-fit-*-state` — five systems for one concept. Progress: `<progress>` (chat, `ChatPanel.tsx:117`), `.scan-bar`/`.scan-bar-fill` (gaps, `RepertoirePanel.tsx:237`), `.scan-meter` (commands, `:93`). Empty states: `.empty` (one italic line) and `RegionState` (title + body + spinner, `StrategicFitWorkspace.tsx:94`). Headers: `.outcome-label` (10 px caps), `.panel-head` (12.5 px caps), `.strategic-fit-pane-heading` (kicker + `h2`). Buttons: `.topbar button`, `.scan-btn`, `.fix-btn`, `.chat-retry`, `.result-accept`, `.stop-btn`, `.accept`, `.reject`, `.color-btn`, `.model-chip`, `.strategic-fit-open-button`. Fields: `.topbar select`, `.rep-mode`, `.chat-mode`, `.field input` styled independently. Tables: Strategic Fit uses real `<table>` with `<th scope>`; the core app uses flex rows of `<span>`.

**Target behaviour.** One `Status`, one `Progress`, one empty-state (`RegionState` generalised), one `ErrorState`, one `PanelHeader`, three `Button` variants plus a `danger` modifier, one `Field`/`Select`. Adoption is incremental; nothing is required to adopt all of them at once.

**Implementation approach.** Create `src/components/primitives/` entries one per commit, each with its consumers migrated in the same commit. Order by risk: `Progress` (3 consumers, purely visual) → `Status` (5 systems) → `RegionState`/`ErrorState` (already partially exists) → `PanelHeader` → `Button` → `Field`. The core app's flex-row "tables" (analysis lines, repertoire rows) are **not** converted to `<table>` — they are lists of actions, correctly rendered as buttons by `WP-011`; only genuinely tabular findings use `<table>`, which Strategic Fit already does.

**Existing behaviour to preserve.** Productive density: the one-line `severity · line · eval` row, the engine-line row, and the finding-card layout must not grow. Strategic Fit's existing `RegionState` behaviour and its `role="alert"`/`role="status"` mapping. The chart/table fallbacks and print/export mode.

**Acceptance criteria.**

- Exactly one progress component renders in the app; `grep` finds no `.scan-bar-fill` or `.scan-meter` class.
- Exactly one status component; the five class families are gone or are thin aliases of it.
- Every panel uses `PanelHeader`; `.outcome-label` and `.panel-head` no longer both appear on the same panel.
- Buttons expose exactly three variants plus `danger`; a reviewer can state which variant every button in the app uses.
- No panel's rendered height grows by more than 10% versus the `WP-036` baseline.
- All Strategic Fit snapshots pass or have reviewed, justified updates.
- `basicAccessibilityViolations` is empty for every migrated surface.

**Automated tests.** Class-absence assertions; density guards; the snapshot suite; the accessibility helper across core-app roots.

**Manual validation.** Visual review at 390×844, 1280×800, and 1440×900 before merge.

**Failure and rollback.** Mechanical but broad. Mitigation: one primitive per commit, each independently revertible.

---

### WP-038 — Board arrow legend and fit terminology

|                              |                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **Objective**                | Make the board's richest information channel readable without reverse-engineering it. |
| **Audit findings addressed** | UX-023                                                                                |
| **Severity reduced**         | Medium → none                                                                         |
| **Type**                     | Content + Visual system                                                               |
| **Decision**                 | Implementation-defined                                                                |
| **Size**                     | S                                                                                     |
| **Risk**                     | Low                                                                                   |
| **Dependencies**             | WP-024, WP-037                                                                        |
| **Blocks**                   | none                                                                                  |
| **Parallel with**            | WP-035                                                                                |

**Current behaviour.** `analysis.ts:32` maps fit to brush (`in-book` → green, `adjacent` → yellow, `out` → red); `:33` maps eval weight to line width (14/10/6 px); `:43–49` draws repertoire child-move arrows also in green at width 7. `Board.tsx:74–87` de-duplicates overlapping arrows with gold preview winning, then book, then engine. `AnalysisPanel.tsx:12` abbreviates fit to `book`/`adj`/`out`. The weight swatch (`.weight.w-*`) is a bare `<span>` with only a `title`. There is no legend anywhere.

**Target behaviour.** A compact legend under the analysis panel explaining colour (fit) and thickness (evaluation strength), and distinguishing repertoire arrows from engine arrows. Fit labels expand to readable text with the abbreviations retained as expert text. The weight swatch gains a text equivalent.

**Implementation approach.** A new `src/components/ArrowLegend.tsx` rendered collapsed by default under the engine lines, expanding on activation and persisting its state to localStorage. Distinguish repertoire from engine arrows visually — the lowest-risk option is a different `lineWidth` band plus a distinct brush registered alongside the existing custom `gold` brush (`Board.tsx:44–49`), since Chessground brushes already support this. Fit labels and the weight text from `content/analysis.ts` as `{ plain, expert }` pairs.

**Existing behaviour to preserve.** The arrow de-duplication order (gold > book > engine) and the `pathEq` gating on suggestion and preview arrows. The `weightFor` classification from chess-tools. `classifyUciMove`'s fit semantics.

**Acceptance criteria.**

- A legend is reachable from the analysis panel, explains all three fit colours and all three thickness bands, and distinguishes repertoire arrows from engine arrows.
- Repertoire arrows and engine `in-book` arrows are visually distinguishable on the board.
- Fit labels read as words; the abbreviations remain available as expert text.
- The weight swatch has a text equivalent readable by a screen reader.
- Arrow de-duplication behaviour is unchanged (assert overlapping-arrow counts for a fixture position).
- The legend's collapsed/expanded state persists across reloads.

**Automated tests.** An arrow-count assertion for a position with overlapping repertoire and engine suggestions; a legend content assertion; a persistence assertion.

**Manual validation.** Confirm the repertoire/engine distinction is visible at the smallest board size (160 px) and under forced colors.

---

## 7. Audit coverage matrix

Acceptance-criteria reference format: `WP-nnn AC-k` = the k-th bullet in that package's Acceptance criteria list.

| Audit ID | Summary                                                               | Disposition                                                  | Primary WP                             | Supporting WPs         | Acceptance criteria ref        | Status after roadmap |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- | ---------------------- | ------------------------------ | -------------------- |
| UX-001   | Zero-height panels at 200% zoom / short viewports                     | Implement                                                    | WP-001                                 | WP-020, WP-013         | WP-001 AC-1..5                 | Closed               |
| UX-002   | Horizontal scroll 721–823px; scan buttons off-screen                  | Implement                                                    | WP-002                                 | WP-017, WP-020         | WP-002 AC-1..5                 | Closed               |
| UX-003   | Board not keyboard/AT operable                                        | Implement with revised approach (prototype-gated)            | WP-014                                 | WP-005, WP-007, WP-009 | WP-014 AC-1..9                 | Closed, pending DV-1 |
| UX-004   | Move list and result rows click-only                                  | Implement                                                    | WP-011                                 | WP-015, WP-022, WP-029 | WP-011 AC-1..8                 | Closed               |
| UX-005   | `Ctrl+Z` deletes with no redo; dual semantics                         | Implement                                                    | WP-005                                 | WP-004, WP-007         | WP-005 AC-1..11                | Closed               |
| UX-006   | `New` wipes a clean document with no confirmation                     | Implement                                                    | WP-003 (prevention), WP-004 (recovery) | WP-018                 | WP-003 AC-1..8; WP-004 AC-1..8 | Closed               |
| UX-007   | Overlays: no trap, no Escape, no restore, shortcuts live behind       | Implement                                                    | WP-007                                 | WP-005, WP-008         | WP-007 AC-1..9                 | Closed               |
| UX-008   | Top bar mixes four concerns; 258px at 360px                           | Implement                                                    | WP-017                                 | WP-002, WP-016, WP-018 | WP-017 AC-1..7                 | Closed, pending DV-3 |
| UX-009   | Eval off by default; "No lines yet." misdiagnoses                     | Implement                                                    | WP-016                                 | WP-024                 | WP-016 AC-1..9                 | Closed               |
| UX-010   | Move tree below the fold                                              | Implement                                                    | WP-015                                 | WP-011                 | WP-015 AC-1..5                 | Closed               |
| UX-011   | Mobile tablist incomplete; running work invisible cross-tab           | Implement                                                    | WP-013                                 | WP-009, WP-010         | WP-013 AC-1..6                 | Closed               |
| UX-012   | No live region for any core status event                              | Implement                                                    | WP-009                                 | WP-010                 | WP-009 AC-1..7                 | Closed               |
| UX-013   | Dividers drag-only, 5/14px, no reset                                  | Implement                                                    | WP-012                                 | WP-006                 | WP-012 AC-1..6                 | Closed               |
| UX-014   | Targets 14–20px; coarse rule covers six selectors                     | Implement                                                    | WP-006 (policy), WP-011 (structure)    | WP-012, WP-022         | WP-006 AC-7; WP-011 AC-5       | Closed               |
| UX-015   | Contract identifiers, JSON-key labels, Raw JSON on every card         | Implement                                                    | WP-025 (labels), WP-026 (hierarchy)    | WP-024                 | WP-025 AC-1..4; WP-026 AC-1..6 | Closed               |
| UX-016   | Raw cohort and branch hashes as display names                         | Implement                                                    | WP-030                                 | WP-024                 | WP-030 AC-1..6                 | Closed, pending PD-6 |
| UX-017   | "Analysis complete" contradicts degraded preflight; no terminal state | Implement                                                    | WP-031                                 | WP-030, WP-032         | WP-031 AC-1..6                 | Closed, pending PD-7 |
| UX-018   | Process telemetry owns the first screen                               | Implement                                                    | WP-032                                 | WP-031                 | WP-032 AC-1..5                 | Closed               |
| UX-019   | Promotion and colour-picker modals lack dialog semantics              | Implement                                                    | WP-007                                 | —                      | WP-007 AC-1, 4, 5, 6, 8        | Closed               |
| UX-020   | Staged-edit card uses `nodes`/`leaves`; no reversibility              | Implement                                                    | WP-026                                 | WP-005, WP-024         | WP-026 AC-3                    | Closed               |
| UX-021   | Repertoire panel organised by implementation tier                     | Implement                                                    | WP-022                                 | WP-011, WP-024         | WP-022 AC-1..7                 | Closed, pending DV-4 |
| UX-022   | Depth-30 notice re-fires; dismissal not remembered                    | Implement                                                    | WP-016                                 | WP-017                 | WP-016 AC-5                    | Closed               |
| UX-023   | No arrow legend; green means two things                               | Implement                                                    | WP-038                                 | WP-024, WP-037         | WP-038 AC-1..6                 | Closed               |
| UX-024   | Three uncoordinated breakpoints; 1100px board cliff                   | Implement                                                    | WP-020                                 | WP-001, WP-002         | WP-020 AC-1..5                 | Closed               |
| UX-025   | App-wide `user-select: none` blocks copying analysis output           | Implement                                                    | WP-006                                 | —                      | WP-006 AC-4, 5, 6              | Closed               |
| UX-026   | Reduced motion and forced colors only inside Strategic Fit            | Implement                                                    | WP-006                                 | WP-037                 | WP-006 AC-2, 3                 | Closed               |
| UX-027   | Focus styling only inside Strategic Fit                               | Implement                                                    | WP-006                                 | WP-036                 | WP-006 AC-1                    | Closed               |
| UX-028   | 360px chat column reserved with no API key                            | Implement with revised approach (collapse is PD-4)           | WP-021                                 | WP-024                 | WP-021 AC-1..5                 | Closed, pending PD-4 |
| UX-029   | Download-fallback save marks clean with no handle                     | Implement                                                    | WP-018                                 | WP-003                 | WP-018 AC-3; WP-003 AC-6       | Closed               |
| UX-030   | 100+ rules below 12px; 32 font sizes                                  | Implement                                                    | WP-036                                 | WP-037                 | WP-036 AC-2, 6                 | Closed               |
| UX-031   | "Save"/"saved" overloaded; no autosave visibility                     | Implement                                                    | WP-018                                 | WP-004, WP-024         | WP-018 AC-1..7                 | Closed, pending PD-1 |
| UX-032   | `reopenLast()` silent on permission denial                            | Implement                                                    | WP-018                                 | WP-003                 | WP-018 AC-6; WP-003 AC-7       | Closed               |
| UX-033   | Stage nav hidden ≥821px; resolution duplicated                        | Implement                                                    | WP-033                                 | WP-007, WP-031         | WP-033 AC-1..6                 | Closed, pending DV-5 |
| UX-034   | Error cards print the raw code, no recovery action                    | Implement                                                    | WP-026                                 | WP-024                 | WP-026 AC-1, 4                 | Closed               |
| UX-035   | Strategic Fit entry buried and unexplained                            | Implement                                                    | WP-023                                 | WP-022                 | WP-023 AC-1..4                 | Closed               |
| UX-036   | "No scan yet — or no gaps." conflates two states                      | Implement                                                    | WP-029                                 | WP-024                 | WP-029 AC-1                    | Closed               |
| UX-037   | Scan errors styled as empty states                                    | Implement                                                    | WP-029                                 | WP-037                 | WP-029 AC-2                    | Closed               |
| UX-038   | Chat suggestions orphaned from their source                           | Implement                                                    | WP-028                                 | WP-027                 | WP-028 AC-1..3                 | Closed               |
| UX-039   | Shorten inspect panel dense, symbol-heavy, undefined                  | Implement                                                    | WP-029                                 | WP-024                 | WP-029 AC-5, 6, 7              | Closed               |
| UX-040   | Tool-run list detached from the log; reset every turn                 | Implement                                                    | WP-027                                 | WP-010                 | WP-027 AC-2, 7                 | Closed               |
| UX-041   | Service worker auto-updates silently                                  | Implement                                                    | WP-019                                 | WP-009, WP-010         | WP-019 AC-1..5                 | Closed               |
| UX-042   | Two-step Generate/Save exports                                        | Implement                                                    | WP-029                                 | WP-022                 | WP-029 AC-3, 4                 | Closed               |
| UX-043   | Advanced-preference copy repeated; "strategic distance" undefined     | Implement                                                    | WP-034                                 | WP-024                 | WP-034 AC-4, 5                 | Closed               |
| UX-044   | No shortcut discoverability                                           | Implement                                                    | WP-008                                 | WP-007, WP-024         | WP-008 AC-1..4                 | Closed               |
| UX-045   | `aria-hidden` without `inert` on the SF workspace                     | Merge with another root-cause fix (WP-007's dialog contract) | WP-007                                 | WP-033                 | WP-007 AC-7                    | Closed               |
| UX-046   | Assistant context invisible to the user                               | Implement                                                    | WP-027                                 | WP-024                 | WP-027 AC-1                    | Closed               |
| UX-047   | `Stop`/`Retry` scope not stated; no per-tool cancel                   | Implement                                                    | WP-027                                 | WP-010                 | WP-027 AC-3, 4, 5              | Closed               |
| UX-048   | Two visual languages; investment asymmetry                            | Implement                                                    | WP-036 (tokens), WP-037 (primitives)   | WP-000 (test parity)   | WP-036 AC-1..7; WP-037 AC-1..7 | Closed               |

**Dispositions used:** Implement (44), Implement with revised approach (3: UX-003 prototype-gated, UX-028 collapse subject to PD-4, and the terminology entries folded into content packages), Merge with another root-cause fix (1: UX-045). **No finding is deferred or rejected.** All 48 identifiers appear above.

Findings whose closure is conditional on a gate are marked "pending". A gate that returns a different answer does not reopen the finding — it changes the _implementation_, and the acceptance criteria are rewritten accordingly before the package starts.

---

## 8. Recommended roadmap

### Phase 0 — Baseline and regression harness

**Entry:** none. **Exit:** CI runs UI unit and Playwright suites on three browsers; ten baseline checks exist with finding IDs; the 22 Strategic Fit specs pass in CI.
**Packages:** `WP-000`.
**Why first:** every Critical finding is in untested code (§2). Without this phase, no acceptance criterion below is enforceable and no regression is detectable.

### Phase 1 — Critical safety and reachability

**Entry:** Phase 0 exit. **Exit:** baseline checks 1, 2, 3 (policy half), 5, and 6 pass; no Critical finding remains except UX-003 and UX-004.
**Packages:** `WP-001`, `WP-002`, `WP-006`, `WP-007`, `WP-003`, `WP-004`, `WP-005`.
**Note:** `WP-006` and `WP-007` sit in Phase 1 rather than Phase 2 because `WP-003` cannot ship without `Dialog`, and `WP-006` is `Dialog`'s styling dependency. This is a deliberate revision of the audit's Phase A/B ordering, justified by the dependency trace in §5.

### Phase 2 — Shared accessibility and interaction primitives

**Entry:** Phase 1 exit. **Exit:** baseline checks 4, 7, and 9 pass; keyboard-only core journey succeeds (milestone M-2); no Critical finding remains.
**Packages:** `WP-009`, `WP-010`, `WP-011`, `WP-012`, `WP-013`, `WP-008`, `WP-014`.
**Gate:** `DV-1` must complete before `WP-014` implementation begins.

### Phase 3 — Core hierarchy and document-state clarity

**Entry:** Phase 2 exit. **Exit:** the move tree is above the fold at ≥1024×600; engine controls live with the analysis; document location is always visible; the PWA notifies before updating.
**Packages:** `WP-024`, `WP-015`, `WP-016`, `WP-018`, `WP-019`, `WP-020`, `WP-021`, `WP-023`, `WP-017`, `WP-022`.
**Gates:** `PD-1` before `WP-018`; `PD-4` before `WP-021`; `DV-3` before `WP-017`; `DV-4` before `WP-022`.

### Phase 4 — Chat and repertoire workflow comprehension

**Entry:** Phase 3 exit (`WP-024` and `WP-022` specifically). **Exit:** no raw identifier in the chat log; mutating results visually distinct; per-tool cancel works; repertoire states distinguish empty from error from clean.
**Packages:** `WP-025`, `WP-026`, `WP-027`, `WP-028`, `WP-029`.

### Phase 5 — Strategic Fit comprehension

**Entry:** Phase 4 exit (`WP-024`, `WP-026`). **Exit:** no raw identifier anywhere; a useful terminal state exists for insufficient evidence; the stage model is consistent at all widths; all 22 Strategic Fit specs still pass.
**Packages:** `WP-030`, `WP-031`, `WP-032`, `WP-033`, `WP-034`.
**Gates:** `PD-6` before `WP-030`; `PD-7` before `WP-031`; `DV-5` before `WP-033`; `PD-8` before `WP-034`.

### Phase 6 — Design-system consolidation

**Entry:** Phase 5 exit. **Exit:** one token set consumed by both halves; one status, progress, empty, error, header, button, and field primitive; no panel grew more than 15%.
**Packages:** `WP-036`, `WP-037`, `WP-038`.
**Why last:** the audit is explicit that visual polish must not precede safety or accessibility, and every earlier package would otherwise churn against a moving token set.

### Phase 7 — Advanced validated redesigns

**Entry:** Phase 6 exit. **Exit:** a written recommendation on the Review/Redesign split.
**Packages:** `WP-035`.

---

## 9. Critical path and parallelisation

### Critical path

```text
WP-000 → WP-001 → WP-002 → WP-006 → WP-007 → WP-003 → WP-004 → WP-005 → WP-011 → WP-014
```

Ten packages close all seven Critical findings. Each link is a real dependency:

| Link                  | Why it is real                                                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WP-000 →` everything | Every Critical fix's acceptance criterion is an automated check that does not exist and that CI does not run (D2).                                                                                                                                                            |
| `WP-001 → WP-002`     | Not a hard dependency, but both edit `styles.css` layout regions; sequencing avoids a merge conflict in the file most contended in the plan (§9.3). Either order works.                                                                                                       |
| `WP-002 → WP-006`     | Soft: `WP-006` adds `:root` tokens `WP-002` does not need. Sequenced for the same file-contention reason.                                                                                                                                                                     |
| `WP-006 → WP-007`     | `Dialog` needs the global focus ring and the target-size tokens; otherwise the ring is written once in `WP-007` and again in `WP-006`.                                                                                                                                        |
| `WP-007 → WP-003`     | The `New`/`Open` confirmation needs a three-action dialog. `window.confirm` cannot express three actions, and hand-rolling a fourth overlay contradicts the plan's first principle.                                                                                           |
| `WP-003 → WP-004`     | Snapshots are captured at the document-replacement boundary that `WP-003` centralises into `requestDocumentClose`.                                                                                                                                                            |
| `WP-004 → WP-005`     | Undo increases the rate of intentional destructive edits; recovery must exist first.                                                                                                                                                                                          |
| `WP-005 → WP-011`     | Soft: `WP-011` adds the delete control's permanent home in the move tree, which `WP-005` stubs. Either order works if `WP-005` keeps its interim control.                                                                                                                     |
| `WP-011 → WP-014`     | Hard: the board layer announces destinations and relies on the same focus and announcement infrastructure; more importantly, shipping keyboard move entry before keyboard _navigation_ of the move list would leave a keyboard user able to create moves but not review them. |
| `WP-005 → WP-014`     | Hard: keyboard move entry raises the accidental-edit rate; undo must exist first.                                                                                                                                                                                             |

**Shortest chain if `WP-014` is deferred by `DV-1`:** `WP-000 → WP-001 → WP-002 → WP-006 → WP-007 → WP-003 → WP-004 → WP-005 → WP-011` closes six of seven Critical findings; UX-003 remains open and is the sole reason `WP-014` cannot be deferred indefinitely.

### Parallel work map

| Group | Packages                                             | Safe because                                                                                                                                                                            |
| ----- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | `WP-001` ∥ `WP-002`                                  | Disjoint `styles.css` regions (compact-tier layout vs `.topbar`), no shared TSX except `TopBar.tsx` in `WP-002` only                                                                    |
| P2    | `WP-006` ∥ `WP-009` ∥ `WP-010`                       | `WP-006` is CSS + one `Board.tsx` line; `WP-009` and `WP-010` are new store files plus `App.tsx` mount                                                                                  |
| P3    | `WP-011` ∥ `WP-012` ∥ `WP-013`                       | Different components (`MoveTree`/`RepertoirePanel`, `Divider`, `MobileTabs`); shared `styles.css` regions are disjoint                                                                  |
| P4    | `WP-015` ∥ `WP-016` ∥ `WP-018` ∥ `WP-021` ∥ `WP-023` | `WP-015` touches `App.tsx` order only; `WP-016` `AnalysisPanel`+`TopBar`; `WP-018` `TopBar`; `WP-021` `App.tsx`+`ChatPanel`; `WP-023` `RepertoirePanel` — see the contention note below |
| P5    | `WP-025` ∥ `WP-030` ∥ `WP-029`                       | Chat labels, Strategic Fit names, and repertoire copy are separate content modules and separate components                                                                              |
| P6    | `WP-032` ∥ `WP-034` ∥ `WP-028`                       | Strategic Fit telemetry, Strategic Fit copy, and chat back-references are disjoint                                                                                                      |
| P7    | `WP-035` ∥ `WP-036`                                  | A study and a stylesheet migration                                                                                                                                                      |

**Not parallelisable:** `WP-003`/`WP-004`/`WP-005` (a single data-safety chain); `WP-036`/`WP-037` (the primitives consume the tokens); `WP-031`/`WP-032` (telemetry collapse assumes the evidence state exists); `WP-017` with anything else touching `TopBar.tsx`.

### File-contention hotspots

| File                                    | Contending packages                                                            | Mitigation                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.css` (5,513 lines)              | WP-001, WP-002, WP-006, WP-011, WP-012, WP-013, WP-020, WP-026, WP-036, WP-037 | Sequence by phase; each package edits a named region and states it in the PR description; `WP-036`/`WP-037` land last and rebase over everything               |
| `App.tsx`                               | WP-001 (none), WP-005, WP-007, WP-009, WP-013, WP-015, WP-021                  | Small file (124 lines); serialise `WP-007` (shortcut handler removal) before `WP-005` and `WP-015`; `WP-009`/`WP-013` add mounts only                          |
| `TopBar.tsx`                            | WP-002, WP-016, WP-017, WP-018                                                 | Strict order: `WP-002` (wrap) → `WP-016` (remove engine controls) → `WP-018` (add status) → `WP-017` (restructure). Never parallel                             |
| `RepertoirePanel.tsx` (406 lines)       | WP-011, WP-022, WP-023, WP-029                                                 | `WP-022` decomposes the file into per-tool components; run it after `WP-011` and before `WP-029`, and fold `WP-023` into the `WP-022` PR if they land together |
| `ChatPanel.tsx`                         | WP-021, WP-025, WP-027                                                         | Sequence `WP-025` → `WP-027`; `WP-021` touches only the no-key branch                                                                                          |
| `ToolResult.tsx` (785 lines)            | WP-025, WP-026                                                                 | Sequence; both are additive to the renderer registry                                                                                                           |
| `StrategicFitWorkspace.tsx` (708 lines) | WP-007 (scope only), WP-030, WP-031, WP-033                                    | `WP-007` touches one early-return; then `WP-030` → `WP-031` → `WP-033` in order                                                                                |
| `store/game.ts`                         | WP-003 (`changesSinceExport`), WP-005 (history hooks)                          | Sequence `WP-003` → `WP-005`                                                                                                                                   |
| `store/persist.ts`                      | WP-004 only                                                                    | No contention                                                                                                                                                  |
| `store/files.ts`                        | WP-003, WP-018                                                                 | Sequence                                                                                                                                                       |

---

## 10. Pull-request plan

Twenty-six PRs. "Independent" means the PR can merge to `main` and deploy on its own without leaving the app in an incoherent state.

| #   | PR title                                                                        | Packages                               | Primary files                                                                                       | Reviewer expertise          | Test evidence expected                                                | Independent           | Rollout notes                                                                                 |
| --- | ------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `test: UI regression harness and CI job`                                        | WP-000                                 | `ci.yml`, `playwright.config.ts`, `test/e2e/helpers/*`, new specs                                   | CI, Playwright              | Three green CI runs on three browsers                                 | Yes                   | Make the job required only after the soak                                                     |
| 2   | `fix(layout): keep panels reachable on short viewports`                         | WP-001                                 | `styles.css`                                                                                        | Frontend, responsive        | Baseline check 1; phone ±2px baselines                                | Yes                   | —                                                                                             |
| 3   | `fix(layout): wrap the top bar and contain the filename`                        | WP-002                                 | `styles.css`, `TopBar.tsx`                                                                          | Frontend, responsive        | Baseline check 2 across 320–2560 on 3 browsers                        | Yes                   | —                                                                                             |
| 4   | `feat(a11y): global focus, motion, forced-colors, target, and selection policy` | WP-006                                 | `styles.css`, `Board.tsx`                                                                           | Accessibility               | `core-a11y.spec.ts`; density guard; touch-drag test                   | Yes                   | Split selection inversion and target floors into separate commits                             |
| 5   | `feat(a11y): Dialog primitive and shortcut-scope registry`                      | WP-007                                 | `primitives/Dialog.tsx`, `store/shortcuts.ts`, three overlays, `App.tsx`                            | Accessibility, architecture | Dialog contract suite; 22 SF specs unchanged; AG-1 screen-reader note | Yes                   | AG-1 blocks merge                                                                             |
| 6   | `feat(safety): confirm before replacing the working document`                   | WP-003                                 | `store/files.ts`, `store/game.ts`, `TopBar.tsx`, `DocumentCloseDialog.tsx`                          | Product, frontend           | `core-document.spec.ts`; byte-identical PGN assertions                | Yes                   | PD-1 wording may land later; ship with draft copy                                             |
| 7   | `feat(safety): autosave snapshot history and recovery`                          | WP-004                                 | `store/persist.ts`, `RecoverDialog.tsx`, `SettingsDrawer.tsx`                                       | Persistence, data safety    | `persist-snapshots.test.ts`; forward/backward record compat           | Yes                   | PD-2 decides retention; ship with 5                                                           |
| 8   | `feat(safety): undo, redo, and explicit line deletion`                          | WP-005                                 | `store/history.ts`, `store/game.ts`, `App.tsx`, `MoveTree.tsx`                                      | Data safety, chess domain   | `history.test.ts` round trips per mutation kind; SF suites unchanged  | Yes                   | Revert `WP-014` too if this is reverted                                                       |
| 9   | `feat(a11y): app live region and announcement policy`                           | WP-009                                 | `store/announce.ts`, `AppLiveRegion.tsx`, `App.tsx`                                                 | Accessibility               | Baseline check 7; AG-5 note                                           | Yes                   | —                                                                                             |
| 10  | `refactor(state): unified operation registry`                                   | WP-010                                 | `store/operations.ts`, `gaps.ts`, `repertoire.ts`, `commands.ts`, `chat.ts`, `analysis.ts`          | Architecture                | `operations.test.ts`; `cancellation.test.ts` unchanged                | Yes                   | Migrate one store per commit                                                                  |
| 11  | `feat(a11y): interactive rows and keyboard move tree`                           | WP-011                                 | `primitives/InteractiveRow.tsx`, `primitives/MoveButton.tsx`, `MoveTree.tsx`, `RepertoirePanel.tsx` | Accessibility, chess domain | Baseline check 4; density guard; AG-3 note                            | Yes                   | Separate commits for MoveTree and RepertoirePanel; DV-2 first                                 |
| 12  | `feat(a11y): keyboard-operable dividers`                                        | WP-012                                 | `Divider.tsx`, `store/layout.ts`, `styles.css`                                                      | Accessibility               | Keyboard resize spec; pointer non-regression                          | Yes                   | —                                                                                             |
| 13  | `feat(mobile): tab semantics, state indicators, activity strip`                 | WP-013                                 | `MobileTabs.tsx`, `App.tsx`, `ActivityStrip.tsx`, `styles.css`                                      | Accessibility, mobile       | Baseline check 9; AG-2 note                                           | Yes                   | —                                                                                             |
| 14  | `feat(a11y): shortcut help sheet`                                               | WP-008                                 | `ShortcutHelpDialog.tsx`, `store/shortcuts.ts`                                                      | Accessibility               | `?` in/out of text field spec                                         | Yes                   | Needs WP-024 labels                                                                           |
| 15  | `feat(a11y): board keyboard layer`                                              | WP-014                                 | `BoardKeyboardLayer.tsx`, `store/board-cursor.ts`                                                   | Accessibility, chess domain | Full keyboard journey; pointer non-regression ×3 browsers; AG-4 note  | Yes                   | DV-1 must complete first; AG-4 blocks merge                                                   |
| 16  | `refactor(content): content registry and shared formatters`                     | WP-024                                 | `src/content/*`, all components, `scripts/check-content.mjs`, `ci.yml`                              | Architecture, content       | Full suite green with **zero** text-assertion changes                 | Yes                   | Pure move; no rewording                                                                       |
| 17  | `feat(ui): move tree first; engine controls in Analysis`                        | WP-015, WP-016                         | `App.tsx`, `AnalysisPanel.tsx`, `AnalysisSettings.tsx`, `TopBar.tsx`, `EvalBar.tsx`, `store/ui.ts`  | Product, frontend           | `core-analysis.spec.ts`; depth-propagation assertion                  | Yes                   | —                                                                                             |
| 18  | `feat(document): browser-vs-file state indicators`                              | WP-018                                 | `DocumentStatus.tsx`, `TopBar.tsx`, `store/files.ts`                                                | Product, content            | `core-document.spec.ts` across three link states                      | Yes                   | PD-1 gate                                                                                     |
| 19  | `feat(pwa): prompt before applying an update`                                   | WP-019                                 | `vite.config.ts`, `pwa/updates.ts`, `Toast.tsx`                                                     | PWA, release                | Toast/deferral specs; `dist` manifest assertion                       | Yes                   | Requires a preview deploy to validate                                                         |
| 20  | `refactor(layout): named responsive tiers; smooth the 1100px transition`        | WP-020                                 | `styles.css`, `store/layout.ts`                                                                     | Responsive                  | Cliff bound; continuous-resize sweep                                  | Yes                   | —                                                                                             |
| 21  | `feat(chat): rail until the assistant is configured`                            | WP-021                                 | `App.tsx`, `ChatPanel.tsx`, `store/layout.ts`                                                       | Product                     | Collapse/restore width spec                                           | Yes                   | PD-4 gate                                                                                     |
| 22  | `feat(repertoire): goal-based tool groups and Strategic Fit entry`              | WP-022, WP-023                         | `components/repertoire/*`, `RepertoirePanel.tsx`                                                    | Product, chess domain       | Per-tool argument-equivalence spec (written first)                    | Yes                   | DV-4 gate                                                                                     |
| 23  | `feat(chat): task labels, result tiers, technical-details policy`               | WP-025, WP-026                         | `ChatPanel.tsx`, `ToolResult.tsx`, `content/*`, `store/settings.ts`                                 | Content, product            | Raw-identifier sweep; staged-copy preservation assertions             | Yes                   | —                                                                                             |
| 24  | `feat(chat): context chip, run history, per-tool cancellation`                  | WP-027, WP-028                         | `store/chat.ts`, `ChatPanel.tsx`, `ChatContextChip.tsx`, `store/suggestions.ts`                     | Architecture, chat          | `chat.test.ts` extensions; blocking-executor cancel test              | Yes                   | —                                                                                             |
| 25  | `feat(repertoire): distinct states, single-action exports, plain evidence`      | WP-029                                 | `components/repertoire/*`, `content/repertoire.ts`                                                  | Chess domain, content       | Field-presence spec (written first)                                   | Yes                   | —                                                                                             |
| 26  | `feat(strategic-fit): names, evidence framing, telemetry, stages, vocabulary`   | WP-030, WP-031, WP-032, WP-033, WP-034 | `strategic-fit/*`, `store/strategic-fit-names.ts`, `content/strategicFit.ts`                        | Strategic Fit, product      | 22 SF specs unchanged; raw-identifier sweep; AG-1 re-run              | **No — split into 3** | Split: (a) names+vocabulary, (b) evidence framing+telemetry, (c) stage model+Dialog migration |
| 27  | `feat(design): tokens`                                                          | WP-036                                 | `styles.css`                                                                                        | Design system               | Zero-diff step 1; density guard step 2; snapshot review               | Yes                   | Four commits, each revertible                                                                 |
| 28  | `feat(design): presentation primitives`                                         | WP-037                                 | `primitives/*`, all panels                                                                          | Design system               | Class-absence assertions; snapshots                                   | Yes                   | One primitive per commit                                                                      |
| 29  | `feat(analysis): board arrow legend`                                            | WP-038                                 | `ArrowLegend.tsx`, `Board.tsx`, `content/analysis.ts`                                               | Chess domain, design        | Arrow de-duplication assertion                                        | Yes                   | —                                                                                             |
| 30  | `docs: Strategic Fit Review/Redesign split study`                               | WP-035                                 | `docs/`                                                                                             | Product research            | Study write-up                                                        | Yes                   | No code                                                                                       |

PR 26 is explicitly marked non-independent and must be split into three; it is listed as one row because the five packages share `StrategicFitWorkspace.tsx` and must be sequenced.

Copy changes are **not** given their own PRs. `WP-024` moves strings without rewording (one reviewable PR proving zero text change), and each subsequent package rewords only the surface it owns. This is safer than a single mass-rewording PR and avoids thirty trivial PRs.

---

## 11. Testing and regression strategy

### 11.1 Baseline harness (`WP-000`) — the ten checks

| #   | Check                                        | Framework                                     | Fixture                                            | Assertion strategy                                                                                                                                            | Expected stability                                                                         | Before or after implementation   |
| --- | -------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 1   | No zero-height core panel on short viewports | Playwright                                    | `RICH_PGN`, four short viewports                   | `getBoundingClientRect().height >= 192` for the active panel; tab bar fully in viewport                                                                       | Very stable — pure geometry                                                                | **Before** `WP-001` (as `fixme`) |
| 2   | No horizontal overflow 320–2560 px           | Playwright                                    | `LONG_FILENAME` (120 chars)                        | `scrollWidth === clientWidth` at 5 px steps                                                                                                                   | Stable; sensitive to font metrics, so assert equality not a threshold                      | **Before** `WP-002`              |
| 3   | Target sizes                                 | Playwright + existing `touchTargetViolations` | Full app, Gaps expanded                            | Empty violation array at 24 px (fine) and 44 px (`hasTouch`)                                                                                                  | Stable; needs a reviewed exclusion list that must stay empty                               | **Before** `WP-006`/`WP-011`     |
| 4   | Keyboard reachability                        | Playwright + new `keyboardReachable`          | Branching PGN                                      | Tab-walk collects reached elements; assert every board square, `.move`, and row is reached                                                                    | Moderately stable; brittle if focus order changes — assert set membership, not order       | **Before** `WP-011`/`WP-014`     |
| 5   | Dialog and shortcut-scope contract           | Playwright, parameterised                     | Each overlay                                       | Focus in, Tab cycle, `Escape`, restore, `inert`, `ArrowRight` inert on `currentPath()`                                                                        | Very stable                                                                                | **Before** `WP-007`              |
| 6   | Undo/redo round trips                        | `tsx --test` store suite                      | Each mutation kind                                 | `toPgn()` equality at each step; `version()` monotonicity                                                                                                     | Very stable — pure functions over strings                                                  | **Before** `WP-005`              |
| 7   | Status announcements                         | Playwright                                    | Each operation kind                                | Read live-region `textContent` after each action; assert exact message count                                                                                  | Moderately stable; rate limiting must be deterministic in tests (inject a clock)           | **Before** `WP-009`              |
| 8   | No raw user-facing identifiers               | Playwright + new `rawIdentifierViolations`    | Chat log with fixture results; completed SF report | Regex sweep of rendered text, excluding `<details>` and `<code>` under technical details                                                                      | Stable; must enumerate tool names from `contractsForHost("browser")` so it cannot go stale | **Before** `WP-025`/`WP-030`     |
| 9   | Mobile tab state visible across switches     | Playwright                                    | Running Gaps scan at 390×844                       | Start scan, switch tab, assert an indicator element is visible and the activity strip names the operation                                                     | Stable once `WP-010` exists; before that it asserts the failure                            | **Before** `WP-013`              |
| 10  | Strategic Fit strengths protected            | Playwright, extending existing specs          | Existing SF fixtures                               | Text-presence assertions for the staged-mutation and bounded-evidence sentences; filter/sort behaviour; chart↔table fallback; print/export complete-list mode | Stable — these are the specs that already exist; this check formalises them as protected   | **Before** any SF package        |

### 11.2 Test layers

**Unit / store (`tsx --test`, `pnpm --filter @chess-mcp/ui test:chat`).** `history.test.ts`, `operations.test.ts`, `persist-snapshots.test.ts`, `content.test.ts`, `shortcuts.test.ts`, plus extensions to `chat.test.ts` (per-tool cancel, run history, context parity) and `cancellation.test.ts` (registry integration). These carry the correctness burden for undo, persistence, and cancellation — the areas where a Playwright test would be slow and indirect.

**Component behaviour.** Solid has no component-test harness in this repo and the plan does not add one; component behaviour is covered by Playwright against the dev server, which is the existing convention (22 specs) and avoids introducing a testing dependency.

**Playwright.** New core specs: `core-layout`, `core-keyboard`, `core-dialogs`, `core-document`, `core-status`, `core-a11y`, `core-analysis`. Existing 22 Strategic Fit specs are the regression gate for Phase 5 and Phase 6.

**Accessibility checks.** The existing `helpers/accessibility.ts` (`basicAccessibilityViolations`, `touchTargetViolations`, `contrastViolations`) is extended, not replaced, and is pointed at core-app roots. No `axe-core` dependency is added — the helper already covers duplicate ids, broken `aria-*` references, missing accessible names, target size, and contrast, and adding a dependency would need justification against D12.

**Visual/layout assertions.** Geometry assertions (heights, widths, overflow, position relative to the viewport) rather than screenshots for interaction correctness. Screenshots are used only where they already exist (three Strategic Fit snapshot directories) and are reviewed, never blanket-updated.

**Regression fixtures.** `RICH_PGN` (≥12 routes past ply 12 — required as the positive control for `WP-031`), `SIMPLE_PGN`, `BRANCHING_PGN` (for move-tree traversal), `LONG_FILENAME`, and a set of fixture tool-result payloads for `ToolResult` rendering injected via `appendToolResultForTesting`.

### 11.3 Browser and device matrix

| Dimension              | Values                                                                                                                       | CI or manual                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Browsers               | Chromium, Firefox, WebKit                                                                                                    | **CI** (all three, via Playwright projects)                                                 |
| Viewports              | 360×740, 390×844, 640×400, 720×900, 721×900, 768×1024, 1024×768, 1100×800, 1101×800, 1280×800, 1280×600, 1440×900, 1920×1080 | **CI** (layout specs only; interaction specs run at 1280×800 and 390×844)                   |
| Zoom equivalents       | 125% (1024×640), 150% (853×533), 200% (640×400)                                                                              | **CI** as reduced CSS viewports                                                             |
| Real browser zoom      | 125/150/200% via browser UI                                                                                                  | **Manual**, once per phase — CSS-viewport emulation is not identical to real zoom for `dvh` |
| Coarse pointer         | `hasTouch: true` contexts                                                                                                    | **CI**                                                                                      |
| Reduced motion         | `reducedMotion: "reduce"`                                                                                                    | **CI**                                                                                      |
| Forced colors          | `forcedColors: "active"`                                                                                                     | **CI** (Chromium only — Playwright support)                                                 |
| Keyboard only          | Tab/arrow-driven specs                                                                                                       | **CI**                                                                                      |
| Screen reader          | NVDA on Windows, VoiceOver on macOS/iOS                                                                                      | **Manual**, at gates AG-1..AG-7                                                             |
| Real iOS/iPadOS device | Virtual keyboard, installed PWA, touch drag, long-press                                                                      | **Manual**, at the end of Phases 1, 2, and 3                                                |
| Installed PWA update   | Deploy → update → toast → reload                                                                                             | **Manual**, once, after `WP-019` (needs a real deploy, D13)                                 |

### 11.4 Performance and stability checks

These must not regress; each is tied to the packages that could break it.

| Property                         | Guard                                                                                                | Packages                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| Board interaction responsiveness | Pointer-drag interaction spec measuring time from `pointerdown` to `fen()` change; fail above 150 ms | WP-006, WP-014                 |
| Chessground lifecycle stability  | Board element identity assertion across mobile tab switches, tier transitions, and undo              | WP-001, WP-013, WP-005, WP-020 |
| Engine-worker scheduling         | Existing pool behaviour unchanged; assert `analyseLive` returns while a scan is running              | WP-010, WP-016                 |
| Analysis cancellation            | `cancellation.test.ts` unchanged plus registry assertions                                            | WP-010, WP-027                 |
| Chat streaming                   | `chat.test.ts` streaming assertions unchanged                                                        | WP-025, WP-026, WP-027         |
| IndexedDB autosave reliability   | Snapshot writes must not block or corrupt the live slot; pause-respect and compat tests              | WP-004                         |
| PGN load/save                    | Round-trip test through `openFile`→`saveFile` on all three save paths                                | WP-003, WP-018                 |
| Strategic Fit scan behaviour     | 41 store suites + 22 e2e specs unchanged                                                             | WP-030..WP-034                 |
| Mobile tab state preservation    | Element identity + chat scroll position assertions                                                   | WP-013                         |
| Static hosting                   | `dist` builds and serves from a file server with no server-side logic                                | WP-019, WP-036                 |
| PWA installability               | `dist/manifest.webmanifest` and precache entries asserted in CI                                      | WP-019                         |

No package may remount a major panel to simplify responsive rendering — asserted by the Chessground identity check.

---

## 12. Data migration and recovery strategy

### 12.1 The four concepts, kept separate

| Concept                                | Owner              | Lifetime                 | Survives refresh             | Survives `New`                |
| -------------------------------------- | ------------------ | ------------------------ | ---------------------------- | ----------------------------- |
| **Navigation history** (`path`)        | `store/game.ts`    | Session                  | Yes (restored from autosave) | No                            |
| **Mutation undo** (`store/history.ts`) | `store/history.ts` | Session, in-memory       | **No**                       | No (cleared)                  |
| **Autosave recovery** (snapshot ring)  | `store/persist.ts` | Durable, 5 entries       | Yes                          | **Yes — that is its purpose** |
| **File persistence** (PGN + handle)    | `store/files.ts`   | Durable, user-controlled | Yes                          | Handle cleared                |

Arrow keys touch only the first. `Ctrl+Z` touches only the second. `Recover` touches only the third. `Save to file` touches only the fourth. No control spans two of them.

### 12.2 IndexedDB changes

**No schema version bump and no `onupgradeneeded` migration.** `store/idb.ts` opens `chess-repertoire` v1 with a single `kv` object store; the plan adds keys, not stores (D5).

| Key                               | Status        | Shape                                                                            |
| --------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `workingRepertoire`               | **Unchanged** | `SavedWorkingRepertoire` exactly as today                                        |
| `fileHandle`                      | **Unchanged** | `FilePickerHandle`                                                               |
| `workingRepertoire.snapshotIndex` | New           | `{ id, savedAt, fileName, moveCount, lineCount, reason }[]`, newest first, max 5 |
| `workingRepertoire.snapshot.<id>` | New           | `SavedWorkingRepertoire`                                                         |
| Strategic Fit keys                | **Unchanged** | Owned by `strategic-fit-metadata.ts` etc.                                        |

Writes use `idbMutateAtomically` so the index and the payload land in one transaction; a torn write is impossible, and an index entry without a payload is treated as unreadable rather than as a crash.

### 12.3 Migration from the single slot

There is nothing to migrate. On first run after `WP-004`, `snapshotIndex` is absent and reads as an empty list; the first capture creates it. The live slot is never rewritten by the migration.

### 12.4 Corrupt and partial snapshots

- A snapshot whose payload key is missing → listed as unreadable, offered for deletion, never thrown.
- A payload that fails `GameTree.fromPgn` → same treatment.
- A malformed `snapshotIndex` → replaced with an empty list; existing payload keys are left in place (they are inert) and a DEV diagnostic is logged.
- The existing `restoreWorking()` `try/catch/finally` contract is unchanged: a corrupt live slot still starts fresh and still arms autosave.

### 12.5 Retention and quota

Five snapshots plus a 2 MB total budget, whichever binds first (`PD-2` may change the count). On `QuotaExceededError`: evict the oldest snapshot and retry once; on a second failure, set `snapshotsUnavailable` and continue — **the live autosave must never fail because a snapshot failed**, and this is an explicit acceptance criterion of `WP-004`.

### 12.6 Rollback compatibility

Reverting `WP-004` leaves the snapshot keys in the store as inert data the older build never reads. No user data is lost by reverting. Snapshot keys are **not** deleted on rollback, so re-applying the package restores access to them.

Reverting `WP-005` loses only in-memory history — by design, nothing was persisted. It also restores the destructive `Ctrl+Z`, which is why `WP-014` must be reverted alongside it.

Reverting `WP-003` restores `window.confirm` guards; no persisted state was created.

### 12.7 Why undo history is not persisted

Three reasons, stated so the decision is not silently revisited:

1. Persisting inverse trees multiplies the storage footprint of the only copy of the user's work, in a store that already has a quota risk.
2. A refresh is not a mistake the user is trying to undo — the mistakes undo exists for (a wrong delete, a wrong accept) happen inside a session, and the snapshot ring already covers the cross-session case at a coarser granularity.
3. Persisted history would need its own corruption story, its own migration, and its own interaction with document identity rotation, for a benefit the audit did not evidence.

If evidence later shows users expect cross-session undo, the snapshot ring is the extension point (increase the count and expose it as a timeline), not the in-memory stack.

### 12.8 Undo's interaction with staged edits and Strategic Fit

- Undo allocates a **new** revision (D10). Any staged chat card bound to the pre-undo revision correctly becomes `stale` through the existing mechanism. This is asserted, not assumed (`WP-005` AC-6).
- `restoreStrategicFitSnapshot` is excluded from history — it is already a rollback and deliberately restores the prior revision number without allocating one (D8).
- Global undo of a Strategic-Fit-applied change set is **blocked by default** with a message pointing at the Replacement Lab, because the Lab's undo also triggers the affected-cohort rescan and updates the resolution proof. `PD-3` may revise this.

---

## 13. Accessibility review gates

Each gate blocks merge of the listed packages. **Presence of ARIA attributes is never sufficient evidence for any gate.**

| Gate     | Scope                                | Required automated evidence                                                                                                                                                  | Required manual evidence                                                                                                                                                                                       | Reviewer                                                       | Blocks merge when                                                                        |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **AG-1** | `Dialog` primitive and its consumers | Dialog contract suite passing for all three overlays on three browsers; `basicAccessibilityViolations` empty per dialog root; `ArrowRight`/`Mod+Z` inert behind each overlay | One NVDA and one VoiceOver session confirming: the dialog is announced with its name and as a dialog; the background is not reachable by virtual cursor; focus returns audibly on close                        | Accessibility reviewer                                         | Any dialog fails to announce its name, or the background is reachable                    |
| **AG-2** | Mobile tabs                          | Complete tab-pattern assertions (ids, `aria-controls`, `tabpanel`, roving tabindex, arrow keys); baseline check 9                                                            | VoiceOver on a real iPhone confirming tab role, position ("tab 2 of 3"), and selection state are announced                                                                                                     | Accessibility reviewer                                         | Tabs announce as plain buttons, or panel association is not announced                    |
| **AG-3** | Move tree                            | `keyboardReachable` empty; single tab stop; `aria-current` on the active move; `aria-expanded` on toggles                                                                    | NVDA and VoiceOver confirming tree role, level, and expanded state are announced, and that traversal does not read the entire tree on every key                                                                | Accessibility reviewer + chess-domain reviewer                 | Tree semantics are mis-announced, or traversal produces speech floods                    |
| **AG-4** | Board keyboard layer                 | Full keyboard journey; pointer non-regression on three browsers; orientation test                                                                                            | NVDA and VoiceOver confirming square identity, piece identity, legal-destination announcement, and move confirmation are all spoken and comprehensible; a keyboard-only user completes the M-2 journey unaided | Accessibility reviewer + a keyboard-only or screen-reader user | The M-2 journey cannot be completed, or pointer behaviour regresses                      |
| **AG-5** | Live-region announcement policy      | Exact message-count assertions per operation; no message on progress ticks or streaming                                                                                      | NVDA and VoiceOver confirming messages are spoken once, are not truncated by the next, and do not interrupt user input                                                                                         | Accessibility reviewer                                         | Announcement storms, or a required event is silent                                       |
| **AG-6** | Resizable divider                    | `aria-valuenow/min/max`, name, key handling, bounds, reset                                                                                                                   | Screen-reader confirmation that the separator reports its value and that value changes are perceivable                                                                                                         | Accessibility reviewer                                         | The separator is unfocusable, unnamed, or does not report its value                      |
| **AG-7** | Forced colors and reduced motion     | Playwright emulation assertions for both, covering severity, fit, tab selection, progress, and card tiers                                                                    | Windows High Contrast pass over the core app and Strategic Fit; a reduced-motion pass confirming no piece animation                                                                                            | Accessibility reviewer                                         | Any status is distinguishable only by colour, or motion persists with the preference set |

Gate evidence is recorded in the PR description as a short written note naming the AT, version, OS, and what was observed. A gate cannot be satisfied by a screenshot.

---

## 14. Product and design validation gates

Each gate names the decision, the smallest prototype that answers it, the task, the evidence, and the default if results are inconclusive. **Defaults exist so no gate can block the roadmap indefinitely.**

| ID       | Decision to validate                                                                               | Smallest testable prototype                                                                     | Representative user task                                                                   | Evidence required                                                                                 | Default if inconclusive                                                                                                                                                                               | Blocks                       |
| -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **DV-1** | The board keyboard interaction model: two-step cursor select/place vs coordinate entry             | A standalone HTML page with the 8×8 focus grid over a static board, both models behind a switch | "Play 1.e4, then navigate to the resulting position and play 1…c5" using only the keyboard | 2 keyboard-only or screen-reader participants; completion, time, error count, stated preference   | **Two-step cursor model** — it matches the established pattern in Lichess and chess.com board accessibility, and coordinate entry excludes users unfamiliar with algebraic input                      | WP-014                       |
| **DV-2** | Move-tree arrow semantics: `→` enters a variation vs advances the mainline                         | The move tree alone, both mappings behind a query flag                                          | "Find the second variation after 2.Nf3 and go to its last move"                            | 2 repertoire builders; wrong-key rate, time, stated model                                         | **`→` enters a variation, `↓`/`↑` move between siblings** — it matches the tree role's ARIA pattern, which screen readers already teach                                                               | WP-011                       |
| **DV-3** | Top bar: `Save` visible vs inside the `Repertoire ▾` menu                                          | Two static mockups at 360, 768, and 1280 px                                                     | "Save your work to a file" and "Start a new repertoire"                                    | 3 users, 2 existing and 1 new; time to locate each action                                         | **`Save to file` stays a visible button; only Open, Re-link, New, and Recover move into the menu** — burying a frequent action is the larger risk                                                     | WP-017                       |
| **DV-4** | Repertoire tool taxonomy: the four goal groups                                                     | An open card sort of the ten current tool names                                                 | "Group these tools the way you'd look for them"                                            | 4 repertoire builders; agreement rate with the proposed grouping                                  | **The four groups in §12 of the audit** — they map to the user-goal analysis and the ROADMAP framing                                                                                                  | WP-022                       |
| **DV-5** | Strategic Fit wide-tier decide surface: fourth column vs decide region below evidence              | A layout mockup at 1101 and 1440 px with real content lengths                                   | "Review the top finding and record a decision"                                             | 3 users; time to decide, backtracking count, column-width complaints                              | **Three columns with the decide region at the bottom of the evidence column, plus a stage strip** — closest to today's behaviour, lowest regression risk on the best-tested surface                   | WP-033                       |
| **PD-1** | Persistence vocabulary: "Stored in this browser" vs "Saved here" vs "Draft"                        | Copy variants in a static mockup of the top bar                                                 | "Where is your work right now, and what happens if you close this tab?"                    | 4 users; correct answer rate per variant                                                          | **"Stored in this browser · autosaved HH:MM" + "File: name — N changes not exported"** — the audit's proposal, which is literal and testable                                                          | WP-018, WP-003 copy          |
| **PD-2** | Snapshot retention count and presentation (5 vs 10; list vs timeline)                              | The Recover dialog with seeded snapshots                                                        | "Get back the repertoire you had before you clicked New"                                   | 3 users; success rate, time                                                                       | **5 snapshots, a list ordered newest-first with timestamp, filename, and size**                                                                                                                       | WP-004                       |
| **PD-3** | Global `Ctrl+Z` on a Strategic-Fit-applied change set: block vs perform-and-supersede              | Behaviour toggle behind a dev flag                                                              | "Undo the change Strategic Fit just applied"                                               | 3 users; whether they expect the proof to update, and whether a blocked undo reads as broken      | **Block with a message pointing at the Lab** — performing it would silently invalidate the resolution proof, which is a correctness risk, not a preference                                            | WP-005                       |
| **PD-4** | Collapse the chat column before setup, or keep it and replace its content                          | Two mockups at 1440 px                                                                          | "Ask the assistant about this position" starting from a fresh install                      | 3 new users; discovery rate of the assistant                                                      | **Keep the column at full width with a proper setup card** — collapsing risks users never discovering the assistant, and the audit's density complaint is satisfied by replacing the terse error line | WP-021                       |
| **PD-5** | Split Strategic Fit into Review and Redesign                                                       | Post-`WP-033` build, unchanged                                                                  | (a) "Review the top finding and decide"; (b) "Replace this line and confirm the change"    | 5 users; unintended entries into redesign surfaces during (a); ability to state the current stage | **Do not split.** Recommend a split only if ≥2 of 5 sessions show unintended redesign entry or an inability to state the stage                                                                        | WP-035, and any future split |
| **PD-6** | Cohort naming: dominant opening vs structural signature                                            | The findings pane with both naming schemes                                                      | "Which comparison group does this finding belong to, and what else is in it?"              | 3 chess-literate users; correct grouping rate                                                     | **Dominant opening plus a line count**, falling back to `Comparison group N` when the dominant opening covers under half the cohort                                                                   | WP-030                       |
| **PD-7** | Insufficient-evidence copy: a specific threshold ("12 plies, 6 routes") vs a qualitative one       | Two variants of the terminal state                                                              | "What would you do next to get results from this?"                                         | 3 repertoire builders; whether they name a concrete next action                                   | **State the specific numbers, read from the preflight payload** — a qualitative threshold gives no action                                                                                             | WP-031                       |
| **PD-8** | Rename `resolution proof` and `training exception` in the UI only, or in the workflow contract too | A diff listing every contract and skill occurrence                                              | — (a scope decision, not a user test)                                                      | Owner decision, recorded                                                                          | **UI-only rename** — the contract vocabulary is consumed by the assistant and by MCP hosts, and changing it is outside this plan's scope                                                              | WP-034                       |

Gates run **before** their package's implementation begins, not before its merge. A gate that returns the default costs one session, not a phase.

---

## 15. Risk register

| Risk                                                         | Trigger                                                                            | Impact                                                                            | Likelihood                          | Affected packages              | Mitigation                                                                                                                         | Detection                                                                    | Rollback                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Snapshot writes corrupt or block the live autosave slot      | Concurrent snapshot and autosave writes, or a quota failure mid-transaction        | Loss of the only copy of a repertoire                                             | Low                                 | WP-004                         | `idbMutateAtomically` for index+payload; respect `autosavePauseDepth`; snapshot failure never propagates to the live write         | Pause-respect and quota-degradation store tests; DEV diagnostics per write   | Revert; snapshot keys become inert; **no data lost**                |
| A wrong inverse silently corrupts a repertoire               | An undo entry whose `beforePgn` was captured after a partial mutation              | Silent data corruption the user may not notice for days                           | Low                                 | WP-005                         | Capture `beforePgn` synchronously before the mutation; DEV invariant asserting the undo result equals the recorded `beforePgn`     | Round-trip suite per mutation kind; DEV invariant                            | Revert; history is in-memory, nothing persists. Revert `WP-014` too |
| IndexedDB migration breaks existing users                    | A schema change or a key rename                                                    | App starts with an empty repertoire                                               | Very low (no schema change planned) | WP-004                         | No version bump, no key rename, additive keys only                                                                                 | Forward/backward record-compatibility tests                                  | Revert                                                              |
| Focus regressions from the `Dialog` extraction               | The extracted trap behaving differently from the Strategic Fit original            | Keyboard users stranded; a worse state than today                                 | Medium                              | WP-007, WP-033                 | Extract verbatim; migrate the three simple overlays first and Strategic Fit last; 22 SF specs as the gate                          | Dialog contract suite; SF specs; AG-1                                        | Revert; overlays return to today's behaviour                        |
| Board pointer regression from the keyboard layer             | The overlay intercepting pointer events                                            | The app's core gesture breaks                                                     | Medium                              | WP-014, WP-006                 | `pointer-events: none` on the layer except while focused; pointer non-regression suite on all three browsers                       | Drag, click-move, and touch-drag interaction tests                           | Revert; the layer is purely additive                                |
| Keyboard conflicts between global shortcuts and new controls | Arrow keys in the move tree, board cursor, and divider all claiming arrows         | Unpredictable behaviour depending on focus                                        | Medium                              | WP-005, WP-011, WP-012, WP-014 | The shortcut registry owns global keys; component-local arrow handling never registers globally and always calls `stopPropagation` | A focus-context matrix test: for each focus target, assert which handler ran | Revert the offending component's key handling                       |
| Responsive regression at normal phone heights                | The `dvh` board term or the panel minimum firing where it should not               | The pinned-board phone layout starts scrolling                                    | Medium                              | WP-001, WP-020                 | ±2 px baseline assertions at 360×740 and 390×844                                                                                   | Baseline assertions in CI                                                    | Single CSS hunk revert                                              |
| CSS cascade regression from token migration                  | A token value differing from the rule it replaced                                  | Widespread subtle visual drift                                                    | Medium                              | WP-036, WP-037                 | Step 1 is additive with a zero-diff requirement; migration is one region per commit; snapshots reviewed not updated                | Strategic Fit snapshot suite; density guards                                 | Per-commit revert                                                   |
| Density loss from target-size floors                         | Padding pushing panels taller                                                      | Less information visible; the audit's explicit anti-goal                          | Medium                              | WP-006, WP-011, WP-037         | Reach floors with hit-area and padding, not layout; 15%/10% growth guards                                                          | Density guard assertions with baseline constants                             | Revert the floors commit alone                                      |
| Engine performance degradation                               | Extra reactive work in the analysis path or the operation registry                 | Slower board interaction, queued analyses                                         | Low                                 | WP-010, WP-016                 | The registry stores plain data and is written on transitions only, not per progress tick beyond the existing rate                  | Board-responsiveness timing test; `analyseLive` availability during a scan   | Revert the registry migration for the offending store               |
| Chat cancellation regression                                 | Child-controller wiring aborting the turn instead of one call                      | `Stop` and per-run cancel become indistinguishable, or cancellation stops working | Medium                              | WP-027                         | Child controller linked one-way to the turn signal; a blocking-executor test proving one call cancels while the turn continues     | `chat.test.ts` extensions; `cancellation.test.ts` unchanged                  | Revert to the shared turn signal                                    |
| PWA users stranded on a stale build                          | The update toast failing to render after switching from `autoUpdate` to `prompt`   | Users never receive fixes                                                         | Low                                 | WP-019                         | Dev simulation seam; a manual post-deploy check on the first release                                                               | Toast test; manual installed-PWA check                                       | One-line revert to `autoUpdate`                                     |
| Browser capability differences                               | File System Access absent on Firefox/WebKit; `@container` support; `inert` support | Divergent behaviour or a broken flow on one browser                               | Medium                              | WP-003, WP-018, WP-020, WP-007 | Three-browser CI from `WP-000`; explicit fallback copy for the download path; a media-query fallback for `@container`              | Three-browser CI                                                             | Per-browser feature detection, already the pattern in `files.ts`    |
| Strategic Fit evidence misinterpretation                     | The insufficient-evidence terminal state hiding findings that were useful          | The user loses access to real analysis                                            | Low                                 | WP-031                         | Trigger only on `comparable_route_count === 0`; the full report stays available under technical details                            | The positive-control `RICH_PGN` fixture must still reach the resolution step | Revert the terminal state; the banner alone remains                 |
| Strategic Fit strengths weakened during rewording            | A shortened sentence losing a bounded-evidence qualification                       | The app starts overclaiming — the opposite of its current strength                | Medium                              | WP-026, WP-030, WP-031, WP-034 | Text-presence assertions for each protected statement; a chess-literate reviewer sign-off as the merge gate                        | Protected-statement assertions in CI                                         | Revert the content commit                                           |
| Argument drift during the repertoire regroup                 | A tool losing a parameter while being moved into a new component                   | A scan silently runs with wrong bounds or depth                                   | Medium                              | WP-022                         | Write the per-tool argument-equivalence spec **first** and prove it passes against current code before refactoring                 | Argument-equivalence spec                                                    | Per-tool revert (components are separate files)                     |
| CI flakiness blocking the roadmap                            | WebKit or engine-backed specs timing out                                           | The team disables the gate that protects everything                               | Medium                              | WP-000                         | Three-run soak before making the job required; `test.slow()` for engine specs; narrow WebKit scope if needed                       | Soak results                                                                 | Make the job non-required; never delete it                          |
| Deploy-on-merge exposes a regression to users immediately    | Any merged package with a defect                                                   | Users hit the defect before it is noticed                                         | Medium                              | all                            | Keep PRs small and independently revertible (§10); the plan's revert notes are per-commit where possible                           | CI plus the next session's manual check                                      | `git revert` and let `deploy-ui.yml` re-run                         |

---

## 16. Milestones and completion criteria

### M-1 — Critical issues resolved

**Condition:** every Critical audit finding closed and verified.

- Baseline checks 1, 2, 4, 5, and 6 pass on Chromium, Firefox, and WebKit.
- No viewport in the matrix produces horizontal page scroll with a 120-character filename.
- No core panel measures zero height at 640×400, 360×640, 720×500, or 800×450.
- `New` on a saved document requires an explicit choice; a snapshot of the replaced document exists and restores.
- `Ctrl+Z` and `Ctrl+Shift+Z` round-trip every mutation kind; no key path deletes without a confirmation and an undo.
- All three overlays satisfy the `Dialog` contract; AG-1 evidence recorded.
- Every board square, move, and result row is keyboard reachable; AG-3 and AG-4 evidence recorded.
  **Packages:** `WP-000`–`WP-007`, `WP-009`, `WP-011`, `WP-014`.

### M-2 — Keyboard-only core journey succeeds

**Condition:** a keyboard-only user, unaided, completes: open a PGN → navigate to move 6 → add a variation → save to file → undo the variation → redo it.
**Evidence:** an automated Playwright run of the journey using only keyboard events, plus one observed session with a keyboard-only or screen-reader user (AG-4).
**Packages:** through `WP-014`.

### M-3 — Core UX stabilised

**Condition:** hierarchy, status, and responsive behaviour are correct.

- The move tree is visible without scrolling at every viewport ≥1024×600.
- Engine controls live in the analysis panel; the panel's four states are distinct.
- Document location is visible at all times, distinguishing browser storage from file export, in all three file-link states.
- Running operations are visible from every mobile tab; announcements fire once per event (AG-2, AG-5).
- Crossing 1100→1101 px changes the board width by ≤15%.
- The PWA prompts before updating.
  **Packages:** through `WP-023`.

### M-4 — Language and comprehension corrected

**Condition:** no implementation vocabulary reaches the user.

- `rawIdentifierViolations` is empty for the chat log and the Strategic Fit workspace with technical details off.
- `pnpm check:content` passes and is required in CI, so a new tool cannot ship without a label.
- Mutating results are visually and semantically distinct from informational ones under forced colors.
- Every repertoire tool distinguishes pre-run, clean-result, and error states.
- Strategic Fit provides a terminal state with concrete remedies when no comparable routes exist, and the header no longer claims completion when evidence is degraded.
- Every protected bounded-evidence and staged-mutation statement is still present.
  **Packages:** through `WP-034`.

### M-5 — Audit fully addressed

**Condition:** all 48 findings closed per §7, and the shared system is in place.

- Core and Strategic Fit consume one token set; one status, progress, empty, error, header, button, and field primitive each.
- No rendered body text below 12 px.
- The arrow system has a legend and repertoire arrows are distinguishable from engine arrows.
- All seven accessibility gates have recorded evidence.
- All thirteen validation gates have a recorded decision (default or measured).
- The Review/Redesign study is written up with a recommendation.
- No package left a `test.fixme` behind.
  **Packages:** all.

---

## 17. Deferred and rejected recommendations

No audit finding is deferred or rejected. Four _implementation approaches_ suggested by the audit are revised or explicitly scoped down; each is recorded with evidence, risk, and a reconsideration trigger.

| Item                                                                               | Audit position                                                             | Plan position                                                                                             | Why                                                                                                                                                                                                                | Risk of the plan's position                                         | Reconsideration trigger                                                                                   | Interim mitigation                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Splitting Strategic Fit into Review and Redesign** (audit §13 E2)                | Listed as an XL option, explicitly conditional                             | Not scheduled; a study (`WP-035`) is scheduled instead                                                    | The audit itself says the split is "only if E1 shows the stage strip is still overloaded". Committing to XL restructuring of the best-tested surface without evidence contradicts the plan's own principles        | The workspace may remain overloaded for another cycle               | `PD-5` measures unintended redesign entry in ≥2 of 5 sessions, or an inability to state the current stage | `WP-033`'s persistent stage strip and single-render resolution panel address the measured symptom |
| **Converting core "tables" to `<table>`** (audit §10 data-table row)               | "Use `<table>` for tabular findings, or ARIA grid roles on the flex rows"  | Rows become `<button>`s in lists (`WP-011`); only genuinely tabular Strategic Fit findings keep `<table>` | The analysis lines and repertoire rows are lists of _actions_, not data grids; a grid role would make each row's activation harder to expose, and Strategic Fit already uses real tables where the data is tabular | A screen-reader user does not get column semantics for engine lines | If AG-3 testing shows users expect column navigation for engine lines                                     | Each row's accessible name carries all its fields in order                                        |
| **Adding `axe-core`**                                                              | Not proposed by the audit; a natural instinct when writing an a11y harness | Not added; the existing `helpers/accessibility.ts` is extended                                            | The helper already covers duplicate ids, broken ARIA references, missing names, target size, and contrast; a new dependency needs justification against COEP (D12) and adds CI surface                             | Some WCAG rules the helper does not implement go unchecked          | If a gate finds a class of defect the helper cannot express                                               | The seven manual accessibility gates cover what static analysis cannot                            |
| **A linter as part of Definition of Done** (audit §13 implies "lint" is available) | Implied                                                                    | Removed from every DoD; replaced with `typecheck` + `docs:check` + `check:skills` + `check:content`       | There is no linter in the repository (D1) and adding one is unrelated churn that would produce a large formatting diff across every file this plan touches                                                         | Style inconsistencies accumulate                                    | If the team adopts a linter for other reasons, add it to the DoD then                                     | Type checking plus the new content check cover the failure modes this plan cares about            |

Nothing is deferred because it is difficult. `WP-014` (board keyboard layer) is the hardest package in the plan and is on the critical path.

---

## 18. Final execution checklist

### Before starting any package

1. Read the package's **Current behaviour** section and open every file and line it cites. If the code does not match, stop and record the delta in §2 before proceeding.
2. Confirm every package in **Dependencies** is merged to `main`.
3. Confirm any gate the package names (`AG-*`, `DV-*`, `PD-*`) has a recorded decision. If not, run the gate or apply its documented default and record that you did.
4. Confirm the baseline check that guards this package exists and currently records the expected failure. If it does not exist, write it first — a check added after the fix proves nothing.
5. For packages that move or refactor behaviour (`WP-022`, `WP-024`, `WP-029`), write the equivalence spec **first** and prove it passes against the current code.
6. Check §9's file-contention table and confirm no in-flight PR holds the same file.

### While implementing

7. Keep each listed sub-step a separate commit where the package's rollback notes call for it (`WP-006`, `WP-010`, `WP-011`, `WP-036`, `WP-037`).
8. Do not add a runtime dependency. If one seems necessary, stop and justify it against D12 (COEP `require-corp` forbids external assets).
9. Do not widen scope into an adjacent package. If a defect is found outside the package, record it and file it — do not fix it here.
10. Preserve every behaviour listed under **Existing behaviour to preserve**, and add an assertion for each one that is not already covered.

### Before declaring the package complete

11. `pnpm -r typecheck` passes.
12. `pnpm docs:check` and `pnpm check:skills` pass.
13. `pnpm check:content` passes (from `WP-024` onward).
14. `pnpm --filter @chess-mcp/ui test:chat` passes.
15. `pnpm exec playwright test --config apps/ui/playwright.config.ts` passes on Chromium, Firefox, and WebKit.
16. Every acceptance criterion in the package has a named test that asserts it, and that test is green.
17. The baseline check this package was meant to flip is no longer `test.fixme` and passes.
18. All 22 Strategic Fit specs and all 43 store suites pass unchanged, or every change is individually justified in the PR description.
19. Any Strategic Fit snapshot update carries a written note stating what changed and why. Blanket snapshot updates are not acceptable.
20. Density guards pass: no panel grew more than its package's stated bound.
21. Required manual validation is done and recorded in the PR description, naming the browser, OS, device, or assistive technology and what was observed.
22. Required accessibility gate evidence is recorded as prose, not a screenshot.
23. The rollback note in the PR description states exactly what reverting does to user data. For `WP-004` and `WP-005` this is mandatory.
24. `docs/ui-ux-remediation-plan.md` §7 is updated: the finding's "Status after roadmap" moves to Closed and any "pending" gate note is removed.
25. If the package changed a documented command, `AGENTS.md` is updated.

### Before declaring a milestone complete

26. Every package listed under the milestone is merged.
27. Every condition in the milestone is verified by a named, green test or a recorded manual session.
28. No `test.fixme` remains anywhere in `apps/ui/test`.
29. The coverage matrix in §7 has no remaining "pending" entries for findings owned by that milestone.
