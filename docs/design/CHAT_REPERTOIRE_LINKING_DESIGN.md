# Chat–Repertoire Linking Design

Status: **implemented**.

Extends the chat tree linking proposal (`CHAT_TREE_LINKS_DESIGN.md`) with six capabilities
that close the loop between chat analysis and the repertoire tree: (1) clickable tool-result
lines in chat that stage as previews in the repertoire, (2) clicking moves in the tree to inject
their line into chat context, (3) collapsible variation groups in the tree, (4) a flexible
panel layout with draggable dividers between the board, side panel, and chat, (5) dropping
the empty "raw assistant response" rows from the chat log (retro #2), and (6) a deterministic,
no-API repertoire backbone (Tier A scans + Tier B actions) with chat as the interpretive layer
on top.

> **Paths**: all file references below are repo-relative under `apps/ui/src/` (e.g.
> `store/suggestions.ts` = `apps/ui/src/store/suggestions.ts`). `chess-tools` references are
> `packages/chess-tools/src/`.

---

## Validation & Retro Reconciliation

Reviewed against the live code (2026-06-18). Corrections folded into the features below; the
load-bearing ones:

- **Retro #1 (next-move arrows) is already shipped.** `repertoireArrows()`
  (`store/analysis.ts`) already draws a **green** arrow for *every* child move at the current
  node — multiple lines ⇒ multiple arrows — composed with engine + suggestion arrows in
  `Board.tsx`. Feature 1's preview arrow is **additive and must be visually distinct** (gold),
  and must dedupe against the green book arrows the same way engine arrows already do
  (`bookKeys` filter in `Board.tsx`). No work needed for the base "show the options" ask.
- **Retro #3 (`modify_repertoire_line` → `variation_not_found`) is mostly a UX bug, and
  Feature 1 is its real fix.** For `action:"add"` that error is **unreachable**: `edit()`
  (`chess-tools/src/pgn.ts`) walks every path prefix down to the empty root, which always
  resolves, so a bad/added tail is tolerated. The failed call in the retro was therefore a
  `prune`/`reorder` with a stale path, or a non-canonical SAN in the *resolvable* prefix
  (`resolveSan` compares `data.san` by exact string). Two responses:
  1. **Prefer staging over model-authored edits.** Feature 1's chip → preview → Accept calls
     `actions.appendLine(fromPath, sans)` with **index Paths the UI owns**, never a model SAN
     path — so the whole class of `variation_not_found`/non-canonical-SAN failures disappears
     for adds. The workflow prompt should steer the model to `propose_line` for adds and reserve
     `modify_repertoire_line` for prune/reorder.
  2. **Make the error legible** (small, in-scope tools.ts change): when `add` falls back, return
     the prefix it actually matched and the moves it grafted, so a "not found" surfaces as
     "matched `1.e4 c6 2.c3 d5`, added `exd5 cxd5 d4`" instead of a bare error.
- **`tree.sanPathAt(path)` does not exist** (used in Feature 2). The tree exposes `nodeAt`,
  `positionAt`, `fenAt`, `sanAt` (last move only), `childSansAt`. Feature 2 below specifies the
  small helper to add and amends Non-Goal #5 accordingly.

---

## Motivation

The PWA chat can already analyse the repertoire (`find_repertoire_gaps`,
`suggest_complementary_lines`, `analyze_repertoire_congruence`, etc.) and propose lines
(`propose_line`). But the interaction is one-way: the user reads analysis in chat, then
manually navigates the tree to find the line, and manually plays out moves to add them.

What's missing:

- **Chat → repertoire**: click a tool-result line in chat → it stages as a preview on the
  board, tree, and a pending chip. Accept grafts it into the tree or extends the current line.
- **Repertoire → chat**: click a move in the tree → its line + FEN appears in chat context so
  the next message is automatically grounded on that position — no manual "get_position" call
  needed.
- **Tree density**: deep branching trees are hard to navigate. Per-variation-group
  collapse/expand (ChessTempo-style +/- circles) lets the user focus on one line at a time.
- **Panel rigidity**: the side panel and chat are fixed-width (`300px` / `360px`). A wide
  tree or a chat with preview chips + Accept/Reject buttons is cramped. The board should be
  able to give space to whichever panel is in use.

---

## Feature 1: Chat Click → Repertoire Preview

### Data Model

Add a **separate** preview store alongside `suggestions` in `store/suggestions.ts`. The
existing `Suggestion` interface is left unchanged — earlier drafts added `previewee` /
`previeweeLine` fields to it, but nothing consumes them; `PreviewLine` carries everything the
panels need, so keep the two concepts disjoint (suggestions = model-proposed + auto-cleared;
preview = user-initiated staging, at most one active).

```ts
// store/suggestions.ts additions
export interface PreviewLine {
  id: string;               // == the staged Suggestion id it was promoted from
  fromPath: Path;           // index Path (number[]) the line is anchored to
  sans: string[];
  firstUci?: string;
  pgn: string;              // rendered SAN snippet for the chat chip label
}

const [preview, setPreview] = createSignal<PreviewLine | null>(null);
export { preview };
// at most one active preview — staging a new one replaces the old.
```

### Tool Contract

The existing `propose_line` tool already returns `{ok, canonical, id}`. Extend its return
so chat can render clickable elements:

```ts
// Current return:
{ ok: true, canonical: ["c4", "c5", "Nc3", "Nc6"], id: "7" }

// Extended: same shape, the chat store detects id and renders inline
// No new tool needed — the chat store hooks into tool results that return
// an id matching a staged Suggestion.
```

When the tool loop finishes, the chat store iterates tool results. Any result with
`ok: true` and `id` that matches a Suggestion becomes a clickable inline element in the
assistant message area.

### Render in ChatPanel

Below the assistant message content, render a `preview-chips` container:

```
╔══════════════════════════════════════╗
║ The Caro-Kann ... 1.e4 c6 2.d4 d5   ║ ← assistant prose
║                                      ║
║ [preview] 1.e4 c6 2.d4 d5 3.e5      ║ ← clickable inline chip
║ [preview] 1.c4 c5 2.Nc3 Nc6         ║
╚══════════════════════════════════════╝
```

Each chip:
- Shows the SAN line as formatted text.
- Is styled distinctly (blue border, slight glow, hand cursor).
- On click: calls `stagePreview(id)` which sets the `PreviewLine` in the previews store.
- On stage: also clears any prior preview so only one is active at a time.

### Preview Visualization (Board + Tree + Chip)

When a `PreviewLine` is active:

**Board**: render the preview's first move as a **golden** arrow (new brush color, e.g.
`"gold"` at line width 10) alongside existing engine/repertoire arrows. Compose it in
`Board.tsx`'s `createEffect` shape list and **dedupe against the green book arrows** the same
way engine arrows already are (`bookKeys`/`arrowKey` filter) — a preview whose first move is
already a book move should show gold, not green-under-gold. If the board is already at the
preview's `fromPath`, the arrow is visible immediately; if the user navigates elsewhere, the
arrow disappears until they return.

**MoveTree**: highlight the target moves with a golden glow (a CSS class
`move-preview` added to each move span matching the SAN path).

**ChatPanel**: the tool-result chip adds a `[previewing]` badge and an `Accept` /
`Reject` pair:

```
[previewing] 1.e4 c6 2.d4 d5 3.e5 [Accept] [Reject]
```

### Accept / Reject

- **Accept**: calls `actions.appendLine(preview.fromPath, preview.sans)` (same as
  `acceptSuggestion` today). Preview is cleared. Board arrows / tree highlights vanish.
  Tree re-renders with the new line inserted.
- **Reject**: clears the preview. Arrows / highlights vanish.
- **Board navigation away** from `fromPath`: preview stays in the store (the chip persists
  in chat) but board arrows hide. Returning to the position shows them again.

### Staleness

If the tree is edited after the preview was staged (user prunes/edits another line), the
`fromPath` may no longer be valid. On Accept, resolve `fromPath` again; if stale, show an
error chip and clear the preview.

---

## Feature 2: Tree Click → Chat Context Injection

### Trigger

Clicking a move span in `MoveTree` already calls `actions.goto(path)`. That alone already
re-grounds the next chat turn: `chat.ts`'s `systemMessage()` injects the **current** FEN + PGN +
color fresh on every `send()`. So the minimum viable Feature 2 is *nothing* — navigate, then
type. The value-add here is making the *focused line* explicit in the visible log and clickable,
**without** persisting a synthetic turn that re-bloats every subsequent API call.

> **Path types**: `MoveTree`'s `path` is an **index Path** (`number[]`, child indices), not a
> SAN list. Building the SAN line needs a new helper on `GameTree` (no equivalent today —
> `sanAt` returns only the last move):
> ```ts
> // chess-tools/src/pgn.ts
> /** SAN list along an index path (root→node). */
> sanPathAt(path: Path): string[] {
>   const out: string[] = [];
>   let node: Node<PgnNodeData> = this.game.moves;
>   for (const idx of path) { node = node.children[idx]!; out.push(node.data.san); }
>   return out;
> }
> ```
> FEN comes free from the existing `tree.fenAt(path)` — no chessops re-replay needed.

No new `onClick` handler needed — add a reactive effect in `MoveTree` or in the chat store
that watches for a new signal: `focusedTreePath`.

### Signal

In a new or existing store, add:

```ts
// stores/chat.ts or stores/tree.ts
const [focusedTreePath, setFocusedTreePath] = createSignal<Path | null>(null);
const [focusedTreeSan, setFocusedTreeSan] = createSignal<string[]>([]);
```

When `MoveTree` handles a click (after `actions.goto`):

```ts
// Inside the move click handler:
setFocusedTreePath(path);
setFocusedTreeSan(tree.sanPathAt(path));
```

### Injection

The chat store watches `focusedTreePath`. On change:

```ts
createEffect(() => {
  const path = focusedTreePath();
  if (!path) return;
  const san = tree().sanPathAt(path);       // new helper above
  const lineFen = tree().fenAt(path);       // existing
  const linePgn = san.join(" ");
  // Display-only marker — NOT a real chat turn. It is rendered in the log but excluded
  // from the wire payload (see below), so it never re-inflates the API context. Position
  // grounding already rides in systemMessage() on the next send.
  setHistory((h) => [...h, {
    role: "focus",                          // local-only role, filtered in wireMessage()
    content: `Focused: ${san.at(-1)} — ${linePgn} (${lineFen})`,
  } as ChatMessage]);
  setFocusedTreePath(null);                  // one-shot
});
```

> **Wire filtering**: `openrouter.ts`'s `wireMessage()` / the `messages` assembly in
> `chat.ts` must skip `role: "focus"` entries (and the existing `tool`/`assistant` roles are
> unchanged). This keeps focus markers visible locally but out of the model payload, honouring
> the retro's "less chatter" direction.

The injected message appears in the chat log as a styled marker:

```
╔══════════════════════════════════════╗
║ 🔍 Focused on move: Nc3             ║
║ Line: 1.c4 c5 2.Nc3                 ║
║ FEN: r1bqkbnr/pp1ppppp/2n5/...     ║
╚══════════════════════════════════════╝
```

Styled with a distinct class (`.msg.focus-injection`) — muted background, small font,
monospace line display so it's visually distinct from user/assistant messages.

### Clickable Line in Injection

The injected `Line: ...` text is itself clickable (same inline rendering as Feature 1).
Clicking it calls `actions.goto(path)` so the user can jump back to the last move of
that line.

### Interaction with Existing Flow

- The injection is purely additive: it does not clear or replace chat history.
- The user can type a new message right after the injection, and the LLM receives the
  injected context as part of history.
- Multiple tree clicks in a row produce multiple injection messages.
- The `Clear` button clears injections along with everything else.

---

## Feature 3: Collapsible Variation Groups

### Rendering

In `MoveTree`, each group of sibling variations gets a collapse toggle:

```
  1. e4
    c6  [–]           ← expanded, showing Caro-Kann line
    d5
    ...
    e5  [+]           ← collapsed, hiding the Open Game line
  2. d4
```

The `[–]` / `[+]` is a small circle with a minus/plus symbol inside, placed to the
left of the first move in the variation group. Clicking toggles visibility of all
moves in that group.

### Data Model

```ts
// stores/tree.ts or inline in MoveTree component state
const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());
```

Key each group by `pathKey(parentPath)` — the path of the parent node whose children
are the variations. For the mainline (root's children), key is `"root"`.

### Visibility Rules

- A collapsed group hides all child nodes **except** the mainline (the first child).
- The current position's ancestors are never collapsed — the tree auto-expands
  groups that contain the current path.
- The toggle circle only appears when the group has ≥2 children (single-child
  groups can't be collapsed).

### Implementation

The current `MoveTree` recursively renders each node. Add a prop or signal check at
each level:

```tsx
// In the recursive MoveNode component (conceptual):
const groupKey = pathKey(parentPath());
const isCollapsed = collapsedGroups().has(groupKey);
const groupSize = children.length;
const isMainline = childIndex === 0;

<Show when={!isCollapsed || isMainline}>
  <span class="move" classList={{ "move-preview": isPreviewed }}>{san}</span>
  <Show when={groupSize > 1 && childIndex === 0}>
    <button class="collapse-toggle" onClick={() => toggleGroup(groupKey)}>
      {isCollapsed ? "+" : "–"}
    </button>
  </Show>
  {/* recursive children */}
</Show>
```

### Persistence

Collapsed state is session-only (not persisted to IndexedDB). A fresh page load starts
with all groups expanded.

---

## Feature 4: Flexible Panel Layout

### Current Layout

```css
.workspace {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 300px 360px;
  gap: 1rem;
  padding: 1rem;
  overflow: hidden;
}
```

Three columns: board panel (flexible), side panel (fixed 300px — Analysis + Gaps + MoveTree),
chat panel (fixed 360px). No user-accessible resize. At small viewports the grid collapses to
two rows via media queries — chat wraps to a full-width row.

### Motivation

The new preview + injection features add visual density. A fixed 300px side panel is too narrow
for a wide repertoire tree. A fixed 360px chat is suffocating when the assistant returns long
analysis with multiple inline chips + Accept/Reject buttons. Conversely, the user may want a
wider board and a narrow chat when not actively using it.

### Layout Model

Switch from CSS grid to a **flex-based row** with programmatic widths:

```
┌──────────────┬──────┬──────────────┬──────┬─────────────┐
│  Board Panel │  ║   │  Side Panel  │  ║   │  Chat Panel │
│  (flex: 1)   │ div │  Analysis    │ div │             │
│              │  i  │  Gaps        │  i  │             │
│              │  d  │  MoveTree    │  d  │             │
│              │  e  │              │  e  │             │
│              │  r  │              │  r  │             │
└──────────────┴──────┴──────────────┴──────┴─────────────┘
```

- `.workspace` becomes `display: flex; flex-direction: row`.
- Board panel: `flex: 1 1 0` (grows and shrinks to fill leftover space).
- Side panel + chat panel: `flex: 0 0 auto` with inline `width` set by JS.
- Two `<div class="divider">` elements: board↔side and side↔chat.
- Dividers are 4px wide, full height, with a `cursor: col-resize` grab area.
- On `pointerdown` → track `pointermove` → set new width → `pointerup` stops.

### Store

New file `store/layout.ts`:

```ts
const KEY_SIDE = "chess.layout.side";
const KEY_CHAT = "chess.layout.chat";
const MIN_PX = 240;
const MAX_PX = 800;
const SIDE_DEFAULT = 300;
const CHAT_DEFAULT = 360;

const [sideWidth, setSideWidth] = createSignal(clamp(read(KEY_SIDE, SIDE_DEFAULT)));
const [chatWidth, setChatWidth] = createSignal(clamp(read(KEY_CHAT, CHAT_DEFAULT)));

export { sideWidth, chatWidth, setSideWidth, setChatWidth };
```

### Divider Component

```tsx
// components/Divider.tsx
interface DividerProps {
  onResize: (deltaPx: number) => void;
}

function Divider(props: DividerProps) {
  let isDragging = false;
  let startX = 0;

  const onDown = (e: PointerEvent) => {
    isDragging = true;
    startX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!isDragging) return;
    props.onResize(e.clientX - startX);
    startX = e.clientX;
  };
  const onUp = () => { isDragging = false; };

  return (
    <div
      class="divider"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}
```

### Workspace layout update

```tsx
// In App.tsx workspace:
<div class="workspace">
  <div class="board-panel">
    <EvalBar />
    <Board />
  </div>
  <Divider onResize={(d) => setSideWidth((w) => clamp(w + d))} />
  <div class="side-panel" style={{ width: `${sideWidth()}px`, flex: "0 0 auto" }}>
    <AnalysisPanel />
    <GapsPanel />
    <MoveTree />
  </div>
  <Divider onResize={(d) => setChatWidth((w) => clamp(w - d))} /> {/* negate: dragging divider right steals from chat */}
  <div class="side-panel" style={{ width: `${chatWidth()}px`, flex: "0 0 auto" }}>
    <ChatPanel />
  </div>
</div>
```

### CSS additions

```css
.workspace {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  height: calc(100vh - 3.2rem);
  overflow: hidden;
}

.divider {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
}
.divider:hover,
.divider:active {
  background: var(--accent);
}
```

### Responsive fallback

`styles.css` currently has **two** breakpoints — `@media (max-width: 1100px)` (board + 320px
side, chat full-width row) and a narrower single-column `grid-template-columns: 1fr` fallback.
The flex rewrite must preserve **both**: at ≤1100px revert to the two-row grid (dividers hide,
widths reset to auto), and keep the existing narrowest single-column rule untouched below it.

```css
@media (max-width: 1100px) {
  .workspace {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) 320px;
    grid-auto-rows: min-content;
    overflow-y: auto;
    height: auto;
  }
  .chat {
    grid-column: 1 / -1;
    height: 360px;
  }
  .divider {
    display: none;
  }
}
```

The `.side-panel` and `.chat` elements keep their grid identities via a class-based
selector that swaps between flex and grid modes.

### Persistence

- Panel widths saved to `localStorage` on every drag-end (`pointerup`).
- Restored on page load via `read()` in the store.
- Cleared when the user explicitly resets layout (no reset UI in v1; clear `localStorage` manually).

---

The features share a common pattern: one panel produces an event that other panels
react to. The existing signal-based store pattern (SolidJS `createSignal` + `createEffect`)
handles this — no new framework needed.

```
┌──────────────┐    tool result with id     ┌──────────────┐
│  ChatPanel   │ ─────────────────────────→ │ previews()   │
│              │    click preview chip       │              │
│              │ ─────────────────────────→ │ setPreview() │
└──────────────┘                             └──────┬───────┘
                                                    │
                          ┌─────────────────────────┼─────────────┐
                          ▼                         ▼             ▼
                   ┌──────────────┐          ┌────────────┐ ┌──────────┐
                   │ Board.tsx    │          │ MoveTree   │ │ ChatPanel│
                   │ gold arrow   │          │ .move-     │ │ badge    │
                   │              │          │ preview    │ │          │
                   └──────────────┘          └────────────┘ └──────────┘

┌──────────────┐    click move    ┌──────────────┐
│  MoveTree    │ ───────────────→ │ focusedTree  │
│              │                  │ Path()       │
└──────────────┘                  └──────┬───────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │  ChatPanel    │
                                  │  inject msg   │
                                  └──────────────┘

┌──────────────┐    toggle group  ┌──────────────┐
│  MoveTree    │ ←────────────── │ collapsed-    │
│  (render)    │                 │ Groups()      │
│  hide/show   │                 │               │
└──────────────┘                 └──────────────┘
```

### Store additions summary

| Signal | Store file | Type | Consumers |
|---|---|---|---|
| `preview` | `store/suggestions.ts` | `PreviewLine \| null` (one at a time) | ChatPanel (chips), Board (gold arrow), MoveTree (highlight) |
| `focusedTreePath` | `store/chat.ts` | `Path \| null` | ChatPanel (display marker), reset after injection |
| `collapsedGroups` | inline in `MoveTree` component | `Set<string>` | MoveTree (render) |
| `sideWidth`, `chatWidth` | `store/layout.ts` | `number` (px) | App.tsx (inline style), persisted to localStorage |
| congruence/action scan state | `store/repertoire.ts` | results + `scanning` + `error` per section | RepertoirePanel (Tier A/B sections) |

---

## File Changes

| File | Change |
|---|---|
| `store/layout.ts` | **New** — `sideWidth`, `chatWidth` signals, localStorage persistence, clamp helper |
| `components/Divider.tsx` | **New** — pointer-event-based draggable divider |
| `chess-tools/src/pgn.ts` | Add `GameTree.sanPathAt(path)` (index Path → SAN list) |
| `store/suggestions.ts` | Add `PreviewLine`, `preview` signal (single), `stagePreview(id)`, `clearPreview()` |
| `store/chat.ts` | Add `focusedTreePath` signal + effect appending a `role:"focus"` marker; exclude `role:"focus"` from the wire `messages` |
| `llm/openrouter.ts` | `wireMessage()` skips `role:"focus"` markers |
| `components/ChatPanel.tsx` | Render inline preview chips per assistant tool result; Accept/Reject buttons; `msg.focus-injection` marker style; **skip empty `content` on assistant rows (Feature 5)** |
| `llm/tools.ts` | (optional) `modify_repertoire_line` add-fallback returns matched prefix + grafted moves (retro #3) |
| `components/MoveTree.tsx` | Add `move-preview` CSS class when node matches preview; add collapse toggles per sibling group; emit `focusedTreePath` on click |
| `components/Board.tsx` | Read `previews` signal; render gold arrow when board at preview's `fromPath` |
| `components/RepertoirePanel.tsx` | **New** — replaces `GapsPanel`; collapsible Tier A scan sections (gaps, congruence) + Tier B actions (extend / fix); rows are navigate/preview chips (Feature 6) |
| `components/GapsPanel.tsx` | **Removed** — folded into `RepertoirePanel` as the Gaps section |
| `store/repertoire.ts` | **New** — per-section scan signals (results, scanning, error) for congruence + the Tier B action results; wraps the shared `chess-tools` calls (gaps stays in `store/gaps.ts` or merges here) |
| `App.tsx` | Replace grid `.workspace` with flex layout + two `<Divider>` instances; panels get inline `width` from layout store; side panel renders `RepertoirePanel` instead of `GapsPanel` |
| `store/analysis.ts` | No change (eval remains independent) |
| `styles.css` | Restructure `.workspace` to flex; add `.divider` styles; update `.board-panel`, `.side-panel`, `.chat` for flex mode; add `.move-preview`, `.collapse-toggle`, `.preview-chip`, `.msg.focus-injection`, gold arrow brush; keep existing media query below 1100px |

---

## Non-Goals

- No chat prose parsing for chess lines — all clickable content is tool-result-driven.
- No annotation persistence across sessions for preview chips (previews are ephemeral).
- No multi-line staging (only one active preview at a time).
- No auto-trigger of LLM analysis on tree click — context injection only.
- No changes to the MCP server. **One small `chess-tools` addition** is required: the
  `GameTree.sanPathAt(path)` helper (Feature 2) — there is no existing index-Path→SAN-list
  method. Beyond that, the PWA store layer owns all new logic. (Optional in-scope tweak to
  `tools.ts` `modify_repertoire_line` to return the matched prefix — see Retro #3 above.)
- No changes to eval UX behavior (eval toggle stays independent).

---

## Feature 5: Drop the "raw assistant response" rows (retro #2)

Each tool round appends an assistant message even when it carries only `tool_calls` and
`content: null` (`chat.ts` `send()` loop). `ChatPanel` renders these as empty "raw assistant
response" rows — visual noise between the tool chips.

**Fix** (ChatPanel render only, no store change): when rendering an `assistant` message, skip
the prose block if `content` is null/empty — render only its tool-call chips. The final
assistant turn (which carries the actual answer and no further `tool_calls`) still renders its
prose normally. No message is dropped from history (the model still sees them); they just stop
producing empty rows in the log.

---

## Feature 6: Deterministic repertoire backbone (Tier A scans + Tier B actions)

The side panel's repertoire tooling is **no-API by default**: every report runs on the local
engine (Stockfish wasm) or pure tree math — no OpenRouter key, no token cost. Chat sits *on top*
as the interpretive layer ("why is this line incongruent"), never as a prerequisite for acting.

The standalone "Repertoire gaps" window (`GapsPanel`) is the first member of a family, not a
one-off. Generalize it into two tiers, distinguished by **input** and **click behaviour** (not
by output legibility — all four return clean structured arrays):

### Tier A — scans (zero input, whole tree → list → navigate)

A single `Scan` runs the report over the entire tree; rows are clickable to `actions.goto(path)`.

| Tool | Engine? | Row | Click |
|---|---|---|---|
| `find_repertoire_gaps` | yes (local) | severity · uncovered move · eval | goto decision node |
| `analyze_repertoire_congruence` | **no** (pure) | type · cluster · line | goto flagged line |

`analyze_repertoire_congruence` returns
`{ incongruencies: [{ type, cluster, path(s) }] }` (type ∈ `structure_outlier` /
`weakness_inconsistency` / `center_inconsistency`) — the same path-per-row shape as gaps, so it
drops straight into the backbone with no new machinery.

### Tier B — actions (parameterized, anchor → ranked candidates → preview-stage)

These take an input and emit **stageable lines**, so a row click runs `stagePreview` (Feature 1),
not `goto`. They are second-stage: triggered *from* a position or *from* a Tier-A flag, never as
cold scan buttons.

| Tool | Anchor (input) | Trigger point | Row |
|---|---|---|---|
| `suggest_complementary_lines` | current board FEN + mode (`low_memorization`/`sharp`) | a button at the current position | move · pv · eval · `profile_match`/`sharpness` |
| `suggest_replacement_line` | an `outlier_variation_path` | a "Fix this" affordance on each congruence flag | `pivot_move` · line · `eval_cp` · `profile_match` |

`suggest_replacement_line` is the natural follow-on to a congruence flag: flag a line → **Fix
this** → ranked replacements → preview on board/tree → Accept grafts (prune outlier + add via
`actions.appendLine`). `suggest_complementary_lines` hangs off the current position (extend from
here).

### Chip kinds (shared)

Tier A and B reuse the Feature 1/2 chip layer, dispatched on payload shape:

- **navigate chip** — payload carries a `path` ⇒ click = `actions.goto(path)` (Tier A).
- **preview chip** — payload carries `moves`/`pv` at a known `fromPath` ⇒ click = `stagePreview`
  (Tier B + `propose_line`).

SAN-list paths (the repertoire tools speak SAN) resolve to an index `Path` via a
`resolveSan`-style lookup before `goto`/`appendLine`.

### Panel structure

`GapsPanel` is replaced by a **`RepertoirePanel`** of collapsed-by-default sections (reusing the
Feature 3 collapse affordance) so unused reports cost no fixed height:

```
Repertoire
  ▸ Gaps                [Scan]      ← Tier A
  ▾ Congruence          [Scan]      ← Tier A
      ⚠ weakness_inconsistency · Caro-Kann · 1.e4 c6 2.Bc4 d5  [→] [Fix this]
  ▸ Extend from here    [low-mem ▾] ← Tier B (anchor = current position)
```

The same deterministic results are also what the chat's Repertoire mode surfaces as chips — one
backbone, two front doors (panel = direct/no-API, chat = interpreted). No duplicate logic: the
panel and the chat-tool both call the shared `chess-tools` functions.

### UX note

Fit scores (`profile_match`, `sharpness`, `eval_cp`) need a one-line legend/tooltip so the
number is meaningful without the LLM narrating it.

---

## Implementation Order

All features in one pass, but dependencies:

1. `store/layout.ts` + `Divider.tsx` + flex workspace (Feature 4 — foundation; new panels need the flex layout to have the horizontal space for previews + collapse toggles + injection messages).
2. `previews` store + `stagePreview` / `clearPreview` (Feature 1 foundation).
3. `ChatPanel` preview-chip rendering + Accept/Reject (Feature 1 render).
4. Gold arrow in `Board.tsx` (Feature 1 board).
5. `move-preview` class in `MoveTree` (Feature 1 tree).
6. `GameTree.sanPathAt` helper + `focusedTreePath` signal + display-marker effect, wire filter (Feature 2).
7. `msg.focus-injection` rendering + clickable line in marker (Feature 2 render).
8. `collapsedGroups` + toggle UI in `MoveTree` (Feature 3).
9. Skip empty assistant `content` rows in `ChatPanel` (Feature 5 — cheap, do anytime).
10. `RepertoirePanel` + `store/repertoire.ts`: Tier A scans (gaps + congruence) → navigate chips, then Tier B actions (extend/fix) → preview chips (Feature 6; depends on the chip layer from steps 2–5).

---

## Open Questions

1. Should preview persist if the user sends a new chat message? Recommendation: clear preview on new send — the user's attention has moved.
2. Should clicking a preview chip that is already previewing deactivate it (toggle)? Recommendation: yes, click again to deactivate.
3. Collapse state: should navigating to a collapsed line auto-expand it? Recommendation: yes — the current position's ancestors must always be visible.
4. Should the injection message include the full PGN or just the SAN line? Recommendation: SAN line + FEN. Full PGN is too noisy in the chat log; the model has access via `get_position`.
5. Panel widths: save on every drag-end or debounced? Recommendation: on `pointerup` only (one write per drag gesture), not during drag to avoid thrashing.
6. Should the collapse-toggle circle always render, or only on hover of the parent move? Recommendation: always render (`opacity: 0.4`, full opacity on hover) so the user can discover it.
