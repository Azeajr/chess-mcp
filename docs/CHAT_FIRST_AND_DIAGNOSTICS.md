# Chat-first interpretation and diagnostic bundles

Status: decisions D1–D8 accepted 2026-10-11; Phase 1 (diagnostics) implemented, Phases 2–3 pending.
Date: 2026-10-11.
Source: a live guided-chat run, "Run Strategic Fit on this repertoire and tell me what it found",
on a 62-line Black repertoire with the familiar-plans profile.

This amends [CHAT_DRIVEN_UI_SPEC.md](CHAT_DRIVEN_UI_SPEC.md) §1 and §9 where noted. Delete this
document once both parts ship, after folding the lasting rules into that spec and `AGENTS.md`.

## 1. What the run showed

| #   | Observation                                                                                                                                                                                                                                                                                            | Cause                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The model could not read 7 of the 19 findings and fetched them a second time.                                                                                                                                                                                                                          | Every findings page exceeded the 6,000-character compaction cap. Fixed in PR #101.                                                                                                                                                                               |
| 2   | The reply recited the report: preflight codes, a metrics table (entropy 2.97, concept reuse 0.919, …), field names such as `intentional_exception_count`, classification slugs with counts, the report ID and revision. It never said, in chess terms, what the analysis found or what to do about it. | The prompt is built from evidence rules ("quote the projection's own values", per-field `Cite:` lists) and has explanation levels for one finding only. Nothing describes a report-level answer, and the summary view gives counts and numbers without grouping. |
| 3   | `##`, `**` and table rows were printed literally.                                                                                                                                                                                                                                                      | `ChatPanel.tsx` renders assistant text as plain text (`{m.content}`); models write markdown anyway.                                                                                                                                                              |
| 4   | About 26 full finding cards (1–19, then 13–19 again) appeared in the conversation ahead of the reply.                                                                                                                                                                                                  | Every tool message renders its complete `ToolResult` card inline.                                                                                                                                                                                                |
| 5   | At setup, the model led with "complete the setup panel yourself".                                                                                                                                                                                                                                      | `BROWSER_ADAPTATION` says Strategic Fit setup preferences "are the user's" and asks the model to name "the control the user can use to repeat it".                                                                                                               |
| 6   | Diagnosing #1 meant recreating the repertoire, re-running the analysis in a script and re-implementing compaction to see what the model had been sent.                                                                                                                                                 | Nothing retains the requests sent to the model, its per-round responses, usage or timing. Chat history lives in memory and is lost on reload.                                                                                                                    |

## 2. Requirements (user, 2026-10-11)

- A Settings button saves a dump of the run: logs, outputs, chats and everything else needed to
  assess what went wrong.
- A user who engages the chat wants the simplified path. The model drives the app and interprets the
  results; the user can work through chat alone, without looking at or clicking the app.
- The model interprets findings and tells the user what they mean. It does not relay tool output.

**Amendment to spec §1.** "Guided use should also teach the interface" becomes secondary. Name a
control only when the user asks how to do something themselves, or is already working manually.

**Chat-only completeness.** Every decision a guided journey needs can be made by replying in chat.
The exceptions are gestures the browser requires (file picker, save) and credential entry, which
stays in Settings (spec §9 is unchanged there).

## Part A: Diagnostic bundle

### A.1 Recorder

Add `apps/ui/src/store/diagnostics.ts`. It is always on, bounded, and nothing leaves the browser.
It records:

- **Model rounds:** turn ID, round index, start time, duration, model, chat mode, the exact
  messages sent (after compaction), a digest of the tool schemas (names plus a hash, with the full
  schemas stored once per distinct hash), and the response text, tool calls, finish reason,
  `usage`, `generationId` or error. The system message holds the injected UI snapshot; store its
  text once per distinct hash.
- **Tool executions:** call ID, name, parsed arguments, the full result before compaction, status,
  duration and the last progress detail. A single result is capped at 200k characters, with a
  truncation marker.
- **Faults:** `console.error` and `console.warn` (including `[engine]` warnings), `window` `error`
  and `unhandledrejection`, each with its message, stack and time.
- **Events:** operation register/settle, document load or replace (file name, color, revision),
  Strategic Fit lifecycle transitions (status, report ID, error code), and changes to public
  settings.

The round record reuses the fields of the live suite's `Round`
(`apps/ui/test/live/live-chat.ts`), so a field bundle and a live transcript can be compared directly.

Hook points:

- the two `chatTransport` calls in `sendTurn` (`chat.ts`);
- `executeCalls`;
- `registerOperation` and `settleOperation`;
- console and window listeners installed in `main.tsx` before the app mounts.

### A.2 Persistence

**Recommended: keep the current and the previous session in IndexedDB** (the existing `idb.ts`
key-value store), at about 8 MB in total. Evict the oldest rounds first and keep faults. Write after
each round.

| Option                                | For                                                                                           | Against                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| IndexedDB, two sessions (recommended) | Survives the reload a user often does after something breaks; "previous run" works literally. | About 60 more lines and asynchronous writes.               |
| Memory only                           | Simplest.                                                                                     | Loses the evidence at exactly the moment the user reloads. |

### A.3 Bundle contents

The bundle is one JSON file, `chess-debug-YYYYMMDD-HHMMSS.json`, with `schemaVersion: 1`:

- `app`: package version and git short SHA (injected with Vite `define`), build mode, user agent,
  viewport and layout tier, `crossOriginIsolated`, service worker state, engine status.
- `settings`: model, chat mode, analysis depth, cloud eval, technical details, plus `apiKeySet` and
  `lichessTokenSet` as booleans.
- `sessions`: the current and the previous session, each with its rounds, tools, faults and events.
- `state` at save time: the UI snapshot, chat context, pending proposals, tool runs, and the
  Strategic Fit lifecycle, profile and metadata status.
- `document`: file name, color, revision, tree statistics and the PGN.
- `strategicFit`: the profile, the metadata sidecar (the same content as
  `export_strategic_fit_metadata`), the report ID, the analysis version, the conversation summary
  view and every finding as a conversation row (about 1 KB each).
- `timeline`: one time-ordered line per user message, round, tool call and result, fault and
  reply, for reading without tooling.

**Recommended: leave out the full Strategic Fit report.** For this repertoire it is 6.9 MB, against
14 KB of PGN. The PGN, profile and metadata reproduce it deterministically, and this run needed
exactly those inputs to reproduce.

**Recommended: include the PGN by default,** with an "Include repertoire" checkbox (on) for a bundle
the user wants to share with someone else.

### A.4 Secrets

- Request headers are never recorded. `Authorization` exists only inside `streamChat`.
- Settings are exported as booleans only.
- After serializing, replace every occurrence of the current API key and Lichess token values with
  `[redacted]`, along with any string carrying an `sk-or-` or `lip_` prefix.
- Credentials typed into chat are already removed by `withoutCredentials` before they reach history.
- A test proves that a bundle built while known secrets are set never contains them.

### A.5 UI

Add a Diagnostics section to the Settings drawer, and add `diagnostics` to `SETTINGS_SECTIONS` so the
assistant can open it with `open_settings` when asked. The section has:

- a "Save diagnostic bundle" button. It downloads through `downloadText`, the download that
  `saveArtifact` uses, rather than keeping a multi-megabyte artifact in memory, and reports the
  outcome with `artifactSaveMessage`;
- the "Include the repertoire PGN" checkbox;
- a "Clear diagnostic log" button;
- one line showing the recorded rounds and size.

Saving remains the user's gesture. The assistant may open the section, but it never builds or saves a
bundle itself.

### A.6 Out of scope

Uploads or telemetry, an in-app viewer, and logging in the MCP server.

## Part B: Chat-first interpretation

### B.1 Answer shape (prompt)

Add a short "How to answer" block at the start of `BROWSER_ADAPTATION`, so the rules after it don't
bury it:

- Lead with the conclusion in plain chess language, in two to five sentences.
- Group findings rather than listing them. Name the one to three that matter most and why; give the
  rest as a count.
- Translate classifications into what they mean for the player: "these differ only by move order,
  so there is nothing to fix"; "these lines stop too early to judge".
- Mention a metric only when it changes the conclusion, and say what it means. Never give a bare
  name or number.
- Keep IDs, field names, snake_case, error codes and revision strings out of replies. They belong in
  tool calls. The exceptions are when the user asks for them or technical details are on.
- No tables or headings. Use short paragraphs and at most one short list.
- End with a single concrete question that offers the next step.
- The evidence rules are unchanged: every claim comes from returned evidence, and missing evidence
  stays missing, said in words ("16 of the 19 couldn't be judged because those lines end early").

Rewrite the lines that conflict:

| Current                                                             | Proposed                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "preserve report_id and finding_id exactly in follow-up discussion" | "… exactly in follow-up tool calls"                                                                                                                                                                                                                                      |
| "naming the control the user can use to repeat it"                  | Only when the user asks how to do it themselves or is working manually.                                                                                                                                                                                                  |
| "choosing Strategic Fit setup preferences … are the user's"         | The choice is the user's, and they can make it in chat. Ask the preference question in plain terms, stage it with `propose_strategic_fit_profile`, and approve it on the user's explicit reply. Opening the setup panel is the fallback for a user who prefers to click. |

`STRATEGIC_FIT_EXPLANATIONS` in `workflow-contract.ts` also feeds the MCP skills:

- Keep "quote the projection's own values" for numbers.
- Add: "Translate a category into plain language for the user; the label is evidence, not the
  answer."
- Add a grounded query, "What did the analysis find?". It uses the summary view and its digest
  (B.2), and its answer is a headline, the top items, what is still unknown, and the next step.

Regenerate the skills with `pnpm sync:skills`.

Prompt size is a follow-up, not part of this change. Auto mode currently sends 24.4k characters of
guidance and 38.6k characters of tool schemas on every round.

### B.2 A digest the model can narrate (`chess-tools`)

Today the model has to page all the finding rows and aggregate them itself. Counting and grouping is
the library's job, not the model's (the engine and library are the arbiters). Add a `digest` to the
`strategic-fit-summary` conversation view in `conversation-projection.ts`:

- `by_classification`: classification, plain-language category, count, and whether it is
  actionable.
- `by_opening`: the opening families (`opening_scope` before the `:`) with the most findings, with
  their counts and dominant classification. Bounded to 5.
- `actionable`: up to 3 decidable findings in replacement-priority order, each with `finding_id`,
  category, opening, line summary and one SAN path.
- `evidence_gaps`: incomplete routes out of total, and the preflight issues in plain words.

The digest is deterministic, and the whole summary view stays under the 6,000-character cap. This is
a public contract change, so it needs the tool contract, a `pnpm docs:generate` run, skills sync and
plugin versions.

| Option                     | For                                                                           | Against                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Digest (recommended)       | One call answers "what did it find?"; the counts are exact; MCP benefits too. | A contract change.                                                                                        |
| Model pages and aggregates | No contract change.                                                           | Three calls and about 25k characters in this run, with miscount risk, and correctness moves to the model. |

### B.3 Chat rendering

- **Render a safe markdown subset in assistant messages:** paragraphs, bold, italic, inline code,
  and bulleted or numbered lists. Headings and tables fall back to plain lines. It builds Solid
  nodes without `innerHTML`, is about 80 lines, and adds no dependency. Recommended, because models
  write markdown whatever the prompt says. The alternative, plain text plus a "no markdown"
  instruction, is fragile.
- **Collapse tool results in the conversation to a one-line receipt** (label and a short count, such
  as "Strategic Fit findings · 19 read") with a disclosure to expand it.
  - Errors stay expanded.
  - "Show technical details" expands every receipt.
  - The result's own surface still shows it in full.
  - Recommended, because full cards are what made this run read as regurgitation.
- **Once the turn finishes, hide every completed run in the trailing run list,** not only `ui_*`
  steps.

Before implementing, list the guided-chat and phase specs that assert result cards in the
conversation, and update them and any affected visual baselines.

### B.4 Verification

- **Unit:**
  - The answer-shape block is present and the rewritten lines replace the old ones.
  - Digest: bounded, deterministic, classification counts sum to `finding_count`, and actionable
    rows are decidable.
  - The markdown renderer escapes HTML.
  - Receipts collapse.
- **Unit, diagnostics:**
  - Rounds are recorded as sent, after compaction.
  - Secrets are redacted.
  - The caps and eviction hold.
  - Faults are captured.
  - The previous session is restored after reload.
- **E2E:**
  - Settings → Save diagnostic bundle produces a download whose JSON has the expected top-level
    keys.
  - Chat results render as collapsed receipts.
- **Live suite** (local only), with a journey "Run Strategic Fit and tell me what it found". The
  reply:
  - contains no `finding:` or `report:` IDs and no snake_case tokens;
  - is at most 180 words;
  - names at least one opening family from the digest;
  - ends with a question.

## 3. Phases

1. **Diagnostics (Part A).** It is independent, and it lands first so Phase 2 can be judged from
   real bundles.
2. **Digest (B.2) and prompt (B.1).** The contract change and skills sync.
3. **Rendering (B.3), plus the e2e and live checks (B.4).**

Each phase is one PR.

## 4. Decisions

| #   | Decision                         | Recommendation                                        | Why                                                          |
| --- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| D1  | Recorder persistence             | IndexedDB, current and previous session, about 8 MB   | Evidence survives the reload that follows a failure.         |
| D2  | PGN in the bundle                | Included by default, with a checkbox                  | Reproduction needs it, and the file stays local.             |
| D3  | Full Strategic Fit report        | Excluded; include its inputs and rows instead         | 6.9 MB, and it is deterministic from the inputs.             |
| D4  | Report-level interpretation      | Digest in the summary view                            | Exact counts in one call; the library stays the arbiter.     |
| D5  | Teaching the interface           | Only on request or during manual use                  | Chat-first users do not want to learn the controls.          |
| D6  | Strategic Fit setup              | Asked and approved in chat; the panel is the fallback | Chat-only completeness.                                      |
| D7  | Markdown                         | Safe subset renderer                                  | Models write markdown anyway.                                |
| D8  | Tool results in the conversation | Collapsed receipts; technical details expand them     | The model's reply is the answer, and the cards are evidence. |
