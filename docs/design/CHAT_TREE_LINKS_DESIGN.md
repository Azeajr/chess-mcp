# Chat Tree Links Design

Status: **proposed**.

Goal: make repertoire analysis actionable in the UI. When chat discusses a concrete repertoire
line, the user can click it and jump to that line or move in the repertoire tree. When chat
classifies lines as critical/warning/ok, the MoveTree can show those issue tiers directly.

This design covers two retro requirements:

- Click a line being discussed in chat and navigate to that line or move in the repertoire tree.
- Standardize LLM color-coded issue tiers and apply them to repertoire tree lines.

---

## Current State

- `GameTree` addresses nodes by `Path` (`number[]` child indices from the root).
- `actions.goto(path)` already navigates board/tree state.
- `MoveTree` renders each node recursively and already knows each rendered move's `Path`.
- Chat tool results include SAN paths in several repertoire tools and numeric paths in gap results.
- Chat prose is plain text. It is not safe to infer clickable chess references from raw markdown:
  the model may paraphrase, omit moves, or mention lines that are not in the tree.

---

## Recommendation

Add explicit UI artifacts for chat-linked repertoire references and line annotations.

Do **not** parse assistant prose for chess lines in v1. Instead, tools/model produce structured
link/annotation data. Chat renders those artifacts as chips/cards. MoveTree reads annotation state
and applies tier classes to matching paths.

Why this shape:

- Grounded: every clickable target comes from a known `Path`, not model-authored text.
- Minimal: no markdown parser, no NLP, no PGN mutation.
- Fits current app identity: `Path` is already how board/tree navigation works.
- Extensible: later can support PGN comments/NAG export if useful.

---

## Data Model

```ts
export type IssueTier = "critical" | "warning" | "ok";

export interface LineReference {
  id: string;
  path: Path;
  sanPath: string[];
  label: string;
  sourceMessageId: string;
  stale?: boolean;
}

export interface TreeAnnotation {
  id: string;
  path: Path;
  tier: IssueTier;
  title: string;
  description?: string;
  source: "chat" | "tool";
  sourceMessageId?: string;
  createdAt: number;
  stale?: boolean;
}
```

Path identity:

```ts
const pathKey = (path: Path) => path.join(".");
```

The annotation store uses `Map<string, TreeAnnotation>` keyed by `pathKey(path)`.

---

## UX

### Chat

Assistant responses may show a `Referenced lines` block below the message:

```text
Referenced lines
[critical] English blunder line: 1.c4 Nf6 2.Nc3 e5 ...
[warning] Caro-Kann sharp line: 1.e4 c6 2.Nf3 ...
```

Clicking a row:

- Calls `actions.goto(path)`.
- Scrolls the corresponding move into view in `MoveTree`.
- Temporarily highlights the target move.
- If the path is stale, the row is disabled with `line changed`.

### MoveTree

Each move span gains annotation classes:

```text
move issue-critical
move issue-warning
move issue-ok
```

Color semantics:

| Tier | Meaning | Style |
|---|---|---|
| `critical` | Tactical or structural issue requiring review | Red underline/background |
| `warning` | Playable but risky/inconsistent/gap-related | Yellow underline/background |
| `ok` | Line reviewed and acceptable | Subtle green marker |

If multiple annotations apply to ancestors/descendants:

- Exact path annotation wins.
- Descendant critical can mark ancestors with a subtle marker.
- Severity order: `critical` > `warning` > `ok`.

---

## Tool/Model Contract

### v1 Preferred Path

Add a PWA-only tool:

```ts
annotate_repertoire_lines({
  annotations: [
    {
      path: string[],
      tier: "critical" | "warning" | "ok",
      title: string,
      description?: string,
    },
  ],
})
```

Input `path` is a SAN path for model readability, not numeric `Path`.

Tool behavior:

1. Resolve each SAN path via `tree.pathAtSanPath(...)`.
2. Reject or mark entries that do not resolve.
3. Store annotations keyed by numeric `Path`.
4. Return resolved annotations with numeric `path`, canonical `sanPath`, and unresolved entries.

Return shape:

```ts
{
  ok: true,
  applied: [
    {
      id: "1",
      path: [0, 0, 1],
      sanPath: ["c4", "Nf6", "Nc3"],
      tier: "critical",
      title: "English blunder line",
    },
  ],
  unresolved: [
    {
      sanPath: ["e4", "c6", "bad"],
      reason: "variation_not_found",
    },
  ],
}
```

Why SAN input but Path storage:

- The model already receives SAN paths from existing repertoire tools.
- The UI needs numeric `Path` for navigation.
- The tool is the grounding boundary that converts human-readable paths into app identity.

### Existing Tool Integration

Where tools already return numeric paths, ChatPanel can render link chips directly:

- `find_repertoire_gaps.gaps[].path`
- `get_repertoire_coverage.dangling_lines[].path`

Where tools return SAN paths, resolve before navigation/annotation:

- `get_transpositions.transpositions[].paths`
- `analyze_repertoire_congruence.incongruencies[].paths`

The v1 `annotate_repertoire_lines` tool can cover the SAN-path resolution use case. A separate
`resolve_repertoire_paths` tool is optional if chat needs navigation links without annotations.

---

## Store Design

Add `apps/ui/src/store/annotations.ts`.

Exports:

```ts
export const annotations: Accessor<TreeAnnotation[]>;
export function annotateLines(input): AnnotateResult;
export function clearAnnotations(sourceMessageId?: string): void;
export function annotationFor(path: Path): TreeAnnotation | undefined;
export function strongestDescendantTier(path: Path): IssueTier | null;
export function focusAnnotatedPath(path: Path): void;
export const focusedAnnotationPath: Accessor<Path | null>;
```

Persistence:

- Store annotations in the existing IndexedDB working-save payload.
- Clear annotations on `actions.loadPgn()` and `actions.newGame()` unless restored from the same
  working session.
- Do not write annotations into PGN in v1.

---

## GameTree Support

Add helpers in `packages/chess-tools/src/pgn.ts`:

```ts
pathAtSanPath(sans: readonly string[]): Path | null;
sanPathAt(path: Path): string[];
```

`positionAtSanPath` already confirms that a SAN path exists, but does not expose numeric path.
`pathAtSanPath` should walk children by canonical SAN and return the child-index path.
`sanPathAt` lets UI render canonical labels for links.

---

## Rendering

### ChatPanel

- Render assistant text unchanged.
- Render structured line refs/annotations below the message as separate rows.
- Do not mutate markdown text or attempt inline link replacement in v1.
- Add click handler to navigate/focus target path.

### MoveTree

- `moveSpan` asks annotation store for exact path annotation.
- Add title tooltip from annotation title/description.
- Add class for exact tier.
- Add class for descendant tier marker if no exact annotation.
- Add `data-path-key` or a ref map so chat clicks can scroll target into view.

---

## Staleness Handling

Paths can become stale after edits/prunes.

On render/click:

1. Check `tree.nodeAt(path)` inside try/catch or add a safe helper.
2. If missing, mark annotation stale and disable navigation.
3. If path exists but `sanPathAt(path)` no longer matches the original `sanPath`, mark
   `stale:true`.
4. Do not delete automatically; user may want context.

---

## Non-Goals

- No automatic NLP parsing of assistant markdown.
- No PGN comment/NAG export in v1.
- No global multi-file annotation library.
- No semantic matching after tree rewrites.
- No LLM authority over repertoire edits; annotations are visual only.

---

## Implementation Plan

1. Add `GameTree.pathAtSanPath()` and `GameTree.sanPathAt()` with smoke tests.
2. Add `store/annotations.ts` with in-memory annotation state and path resolution.
3. Add PWA-only `annotate_repertoire_lines` tool.
4. Update repertoire workflow prompt to call `annotate_repertoire_lines` when reporting tiered line
   issues.
5. Update `ChatPanel` to render applied annotations from tool results as clickable rows.
6. Update `MoveTree` to apply issue tier classes and scroll/focus target moves.
7. Persist annotation state in IndexedDB working-session save.
8. Add UI styling for `critical`/`warning`/`ok` tiers.

---

## Test Plan

Engine-free:

- `pathAtSanPath` resolves mainline and variations.
- `pathAtSanPath` returns `null` for missing SAN path.
- `sanPathAt(path)` round-trips with `pathAtSanPath`.
- `annotate_repertoire_lines` applies valid annotations and returns unresolved invalid ones.
- `MoveTree` renders tier classes for exact path and descendant markers.

Browser/UI smoke:

- Run dev server.
- Load sample branching PGN.
- Apply annotation via tool/store.
- Click chat annotation row.
- Assert board/current path changes and move is highlighted.
- Edit/prune line and assert stale annotation is disabled.

Verification commands:

```sh
node scripts/smoke-gametree.mjs
pnpm --filter @chess-mcp/ui typecheck
pnpm -r typecheck
```

---

## Open Questions

1. Should annotations persist only for current browser session, or across app reloads via IndexedDB?
   Recommendation: persist in IndexedDB working session only.
2. Should a new chat analysis replace prior chat annotations, or accumulate until the user clears
   them? Recommendation: accumulate initially, then add a clear action.
3. Should `ok`/green annotations render by default, or only red/yellow to avoid tree noise?
   Recommendation: render `ok` as a subtle marker, not a full background.
4. Should annotation export to PGN comments/NAGs be v2? Recommendation: yes, after UI behavior
   proves useful.
