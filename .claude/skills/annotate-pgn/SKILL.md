---
name: annotate-pgn
description: >-
  Produce an engine-annotated game or repertoire PGN with grounded glyphs and comments. Use when
  the user wants a durable marked-up chess artifact rather than prose alone.
---

# Annotate PGN

Use the `chess-analysis` MCP to create the artifact; never hand-author its chess content.

<!-- BEGIN GENERATED WORKFLOW GUIDANCE -->
## Shared grounding contract

- Validate user-pasted FEN or PGN before analysis. Stop on invalid input; never repair it silently. An already parsed host document needs no redundant validation call.
- Ground every move, line, evaluation, FEN, structure label, popularity claim, and best-move claim in a tool result. Never substitute chess knowledge from memory.
- Validate any concrete continuation before stating it. Reuse normalized FENs and SAN paths returned by tools; never hand-build a FEN.
- Treat engine scores as White-POV centipawns: positive favors White, negative favors Black; about 50 is near equal, 200 clearly better, 500 winning, and the mate sentinel is decisive. Label the favored side.
- If an engine or required network source is unavailable, say which source is unavailable and stop that dependent method. Do not turn missing evidence into a chess claim.
- Summarize semantic results instead of dumping JSON. Preserve structured errors, navigation references, action identifiers, and artifact identifiers for follow-up work.

## Shared method

Create a saveable annotated game or repertoire artifact without model-authored PGN content.

1. Choose artifact: Use game annotation for one mainline and repertoire annotation for a branching preparation tree; never substitute one for the other. Tools: `export_annotated_pgn`, `export_annotated_repertoire`.
2. Validate pasted input: Validate only PGN pasted by the user. The browser's current parsed document does not need an argument-less validation call. Tools: `validate_pgn`.
3. Export: Call the chosen export operation and preserve the returned artifact reference. Do not hand-assemble or repeat the PGN payload. Tools: `export_annotated_pgn`, `export_annotated_repertoire`.

## Shared report contract

- Name the artifact and summarize what was annotated.
- Keep the artifact identifier/path available for saving; do not echo full PGN.
<!-- END GENERATED WORKFLOW GUIDANCE -->

## MCP adaptation

- A game export returns `annotated_pgn`; save or present exactly that returned content.
- A repertoire export requires a loaded `repertoire_id`. Prefer `export_path` so the server writes
  under the confined repertoire directory without putting a large PGN in model context.
- Preserve original headers and move order. Custom manual annotation is outside the normal path and
  still requires every move, glyph, score, and line to come from tool results.
