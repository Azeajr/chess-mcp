# UX Review Report for chess-mcp

## Overview

This review evaluates the user experience of the chess-mcp application, focusing on the Strategic Fit workflow as outlined in `docs/UX_REVIEW.md`. The review was conducted using the Playwright-based UX review tool in a headless WebKit environment simulating an iPhone 13 Mini.

## Steps Performed

1. `pnpm ux:review -- preflight` – verified environment and dependencies.
2. `pnpm ux:review -- start --workflow strategic-fit` – launched the app and seeded a fresh profile.
3. `pnpm ux:review -- cli click "getByRole('button', { name: 'Open Strategic Fit' })"` – opened the Strategic Fit modal.
4. `pnpm ux:review -- cli snapshot --depth=6 --boxes` – captured the modal structure and accessibility tree.
5. `pnpm ux:review -- cli click "getByRole('button', { name: 'Use Balanced profile' })"` – selected the Balanced profile.
6. `pnpm ux:review -- screenshot overview` – captured the main viewport after profile selection.
7. `pnpm ux:review -- check` – verified no runtime faults occurred.
8. `pnpm ux:review -- cli click "getByRole('button', { name: 'Return to repertoire' })"` – closed the modal and returned to the main view.
9. `pnpm ux:review -- cli snapshot --depth=6 --boxes` – captured the post-modal view.

## Findings

### Usability of MCP Tools / Resources / Prompts

- The Strategic Fit modal is accessible via a clearly labeled button ("Open Strategic Fit").
- Once opened, the modal presents a coherent workflow: profile selection, followed by analysis categories (Analyze, Prepare, Generate, Improve).
- Interactive elements (buttons, combobox) are correctly labeled and reachable via role-based queries.
- The UI provides immediate feedback: after selecting a profile, the modal updates to show the chosen profile (Balanced · Inferred · provisional).
- Navigation is intuitive: a prominent "Return to repertoire" button allows users to exit the modal without losing context.

### Clarity of Descriptions and Documentation

- Headings and prose within the modal are concise and informative. Example: "How should Strategic Fit review your repertoire?" followed by a plain-language explanation.
- The note about engine depth ("Engine depth is used only later when comparing alternatives or replacements, never for the initial structural scan.") effectively sets expectations and prevents confusion.
- Profile information includes source (Balanced), inference status, and provisional flag, helping users understand the nature of the selection.
- Section labels (Analyze, Prepare, Generate, Improve) use familiar verbs that align with user goals.

### Error Handling and User Feedback

- No errors were encountered during this review flow; the `check` command reported zero faults.
- The application does not display inline validation errors in this flow (e.g., for invalid inputs) because the interaction was limited to button clicks and profile selection.
- It would be beneficial to test error scenarios (e.g., missing Lichess token for explorer-dependent features) to verify that structured errors are presented clearly and guide users toward resolution.

### Consistency and Discoverability

- The UI follows a consistent pattern: regions are grouped by function, each with a clear heading and descriptive text.
- Icons and symbols (e.g., the arrow legend "▸") are used consistently.
- The modal respects the underlying application state: upon returning to the repertoire view, the board and move list remain unchanged, indicating that the modal is truly a transient overlay.
- Discoverability is good for primary actions; however, the "Advanced preferences" group is nested within the "Review profile" section and may be overlooked by users who do not expand it.

### Friction Points and Improvement Opportunities

1. **Initial Profile Discovery** – While the Balanced profile is pre-selected and described, users unfamiliar with the terminology might benefit from a brief tooltip or guided tour explaining what each profile (Familiar-plans, Balanced, Versatile, Custom) entails.
2. **Advanced Preferences Visibility** – The "Advanced preferences" button is currently inside a collapsible group. Consider making it more prominent (e.g., a separate button) or auto-expanding this section for first-time users.
3. **Modal Header Summary** – Adding a one-sentence summary of what Strategic Fit does (e.g., "Strategic Fit identifies high-impact improvements to your repertoire based on your learning goals.") could help users quickly grasp the purpose.
4. **Visual Hierarchy of Profile Indicator** – The profile badge (Balanced · Inferred · provisional) is text‑only; enhancing its visual weight (e.g., with a colored badge or icon) would make the current selection more noticeable at a glance.
5. **Keyboard Navigation** – Although not tested in this review, ensuring that all modal controls are reachable via keyboard (Tab order) and that focus is trapped within the modal would improve accessibility.
6. **Post‑Action Feedback** – After selecting a profile, a subtle confirmation toast or animation could reinforce that the choice has been registered.

## Ratings (Scale: 1–5)

- **Usability**: 4 – The workflow is straightforward and frictionless for the core tasks.
- **Clarity**: 5 – Explanations are clear, concise, and context‑appropriate.
- **Error Handling**: N/A – Not exercised in this review; recommend dedicated error‑path testing.
- **Consistency**: 4 – Consistent layout and terminology; minor opportunities to improve discoverability.
- **Overall**: 4.5 – The Strategic Fit UX is polished and user‑centric, with only minor enhancements needed.

## Actionable Recommendations

1. Add a brief on‑screen tooltip or modal tour for first‑time users explaining profile choices.
2. Increase the visibility of the "Advanced preferences" section (e.g., promote to top‑level or auto‑expand).
3. Include a concise summary of Strategic Fit’s purpose in the modal header.
4. Enhance the visual prominence of the current profile indicator.
5. Verify keyboard navigability and focus management within the modal.
6. Consider adding subtle confirmation feedback after profile selection.

## Artifacts

- Screenshots and snapshots were captured during the review and are stored in the `.ux-review` directory:
  - Seeded view: `.ux-review/chess-ux/2026-09-07T15-49-20-205Z-230177b3/00-seeded.png`
  - Overview after profile selection: `.ux-review/chess-ux/2026-09-07T15-49-20-205Z-230177b3/01-overview.png`
  - Snapshots (YAML) detailing the accessibility tree are also available in the same directory.
