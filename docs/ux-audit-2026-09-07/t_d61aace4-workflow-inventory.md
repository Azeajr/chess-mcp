# Chess MCP UX Workflow Inventory for ct-black-repertoire.pgn

This document identifies all available UX workflows in the chess-mcp codebase that can be reviewed using the `ct-black-repertoire.pgn` file.

## Available Workflow Families

Based on the workflow contract definition in `packages/chess-tools/src/workflow-contract.ts`, there are four core workflow families:

### 1. Position Workflow

**Goal**: Evaluate one position and compare legal candidate moves without drifting into whole-game review.

**Steps**:

1. **Ground** - Validate a pasted FEN, then ground the normalized or current position and its legal moves.
   - Tools: `validate_fen`, `get_position`
2. **Evaluate** - Run one multi-line local evaluation and compare the ranked candidates directly.
   - Tools: `evaluate_position`
3. **Compare** - Use the full legal-move primitive only when needed; use candidate comparison for moves the user names.
   - Tools: `get_legal_moves`, `compare_moves`
4. **Drill** - Validate a proposed SAN line, take its returned final FEN, and evaluate that child position for the what-if.
   - Tools: `validate_line`, `evaluate_position`

**Report Contract**:

- Lead with the position verdict and favored side.
- Compare the top candidates with labeled scores.
- State only validated continuations.

**MCP Skill**: `analyze-position`

### 2. Review Workflow

**Goal**: Review one game's mainline, identify turning points, and explain only engine-grounded alternatives.

**Steps**:

1. **Validate** - Validate pasted PGN before review; use the already parsed current game directly on the browser host.
   - Tools: `validate_pgn`
2. **Summarize** - Get the compact game verdict first: accuracy, per-side classifications, and worst moves.
   - Tools: `get_game_summary`
3. **Inspect** - Retrieve the mainline move analysis and focus on the few largest losses rather than narrating every good move.
   - Tools: `analyze_game`
4. **Explain** - For each discussed alternative, ground the position, validate the line, and evaluate a child only when the summary is insufficient.
   - Tools: `get_position`, `validate_line`, `evaluate_position`

**Report Contract**:

- Lead with accuracy and one to three turning points.
- For each mistake: played move, labeled swing, grounded best move, validated line, and one plain-language reason.

**MCP Skill**: `chess-game-review`

### 3. Annotation Workflow

**Goal**: Create a saveable annotated game or repertoire artifact without model-authored PGN content.

**Steps**:

1. **Choose artifact** - Use game annotation for one mainline and repertoire annotation for a branching preparation tree; never substitute one for the other.
   - Tools: `export_annotated_pgn`, `export_annotated_repertoire`
2. **Validate pasted input** - Validate only PGN pasted by the user. The browser's current parsed document does not need an argument-less validation call.
   - Tools: `validate_pgn`
     3.agn`
3. **Export** - Call the chosen export operation and preserve the returned artifact reference. Do not hand-assemble or repeat the PGN payload.
   - Tools: `export_annotated_pgn`, `export_annotated_repertoire`

**Report Contract**:

- Name the artifact and summarize what was annotated.
- Keep the artifact identifier/path available for saving; do not echo full PGN.

**MCP Skill**: `annotate-pgn`

### 4. Repertoire Workflow

**Goal**: Pressure-test a branching repertoire for soundness, coverage, memorization cost, structures, and practical opponent preparation.

**Steps**:

1. **Profile** - Use the aggregate structural profile for identity; use structure search to locate lines matching explicit structure, center, theme, or color-complex criteria.
   - Tools: `get_structural_profile`, `find_structures`
2. **Analyze strategic fit** - Run the versioned Strategic Fit report with an explicit profile or the labeled inferred default.
   - Tools: `analyze_repertoire_congruence`, `get_structural_profile`
3. **Confirm profile intent** - When the user describes goals such as low theory, a preferred structure, or an acceptable evaluation loss, translate that into an explicit profile proposal.
   - Tools: `propose_strategic_fit_profile`, `analyze_repertoire_congruence`
4. **Discuss a report** - Retrieve the bounded summary, one page of findings, or one finding with its evidence and navigable paths.
   - Tools: `get_strategic_fit_report`
5. **Plan a retained exception** - When the user keeps a branch and trains it instead of replacing it, write the plan card that goes with it.
   - Tools: `get_strategic_fit_report`, `propose_strategic_fit_plan`, `find_only_moves`
6. **Audit user moves** - Audit prescribed user moves tree-wide and rank centipawn-loss findings.
   - Tools: `audit_repertoire_moves`
7. **Find gaps** - Scan opponent decision nodes for strong uncovered replies.
   - Tools: `find_repertoire_gaps`, `suggest_gap_fills`, `modify_repertoire_line`
8. **Find only moves** - Find sharp user-turn positions where the best move clearly separates from the second.
   - Tools: `find_only_moves`
9. **Shorten safely** - Find sound transposition shortcuts, compare memorization savings with evaluation.
   - Tools: `find_pruning_transpositions`, `inspect_shortcut`, `modify_repertoire_line`
10. **Extend and connect** - Use coverage for dangling lines and stub reconnection.
    - Tools: `get_repertoire_coverage`, `suggest_complementary_lines`, `suggest_replacement_line`
11. **Redesign under constraints** - When the user states a redesign goal in their own terms, turn it into explicit bounds.
    - Tools: `suggest_replacement_line`, `propose_strategic_fit_portfolio`
12. **Use practical evidence** - Use explorer popularity and theory depth only with authentication.
    - Tools: `position_popularity`, `find_theory_depth`
13. **Prepare an opponent** - Use opponent preparation for an opponent's games and targets.
    - Tools: `prep_vs_opponent`, `repertoire_vs_history`
14. **Export the right artifact** - Use annotated repertoire export for the branching tree and only-move deck export for training.
    - Tools: `export_annotated_repertoire`, `find_only_moves`, `export_strategic_fit_metadata`, `export_strategic_fit_intent_pgn`

**Report Contract**:

- Separate Strategic Fit, structural identity, weak user moves, uncovered opponent replies, only-move drills, and practical frequency.
- Keep confidence, strategic difference, objective quality, replacement priority, and training priority distinct.
- Give navigable SAN paths and preserve report, finding, action, and artifact references.
- Present alternatives and tradeoffs; never choose or apply a mutation silently.

**MCP Skill**: `repertoire-builder`

## Additional Workflows from UX Review System

Beyond the core workflow contracts, the UX review system supports additional workflows:

### Strategic Fit Workflow

Referenced in documentation and scripts as a specialized workflow for reviewing strategic fit analysis.

**Usage**:

```bash
pnpm ux:review -- start --workflow strategic-fit
```

This workflow is specifically designed for reviewing Strategic Fit reports and analysis.

### Review Workflow (Default)

The default workflow when no workflow is specified.

**Usage**:

```bash
pnpm ux:review -- start
```

or

```bash
pnpm ux:review -- start --workflow review
```

## How to Use These Workflows with ct-black-repertoire.pgn

All workflows can be exercised using the `ct-black-repertoire.pgn` file through the MCP server or direct tool usage:

1. **Via MCP Server**:
   - Start the MCP server: `pnpm mcp`
   - Use MCP clients to call the appropriate tools for each workflow

2. **Via Direct Tool Usage**:
   - Individual tools can be called directly through the MCP interface
   - Workflows combine multiple tools in specific sequences

3. **Via UX Review System**:
   - For browser-based review: `pnpm ux:review -- start --workflow <workflow-name>`
   - Supported workflows include: `review` (default), `strategic-fit`, and potentially others

## Workflow Mapping to ct-black-repertoire.pgn

The `ct-black-repertoire.pgn` file contains a comprehensive Black repertoire with multiple variations and annotations, making it suitable for testing all workflow families:

- **Position workflow**: Test individual positions from the repertoire
- **Review workflow**: Review complete games or lines from the repertoire
- **Annotation workflow**: Annotate the repertoire or specific games within it
- **Repertoire workflow**: Pressure-test the entire branching repertoire for soundness and coverage

Each workflow provides a different lens for examining the chess knowledge contained in the repertoire file.
