# Single-User Implementation Workflow

> The filename is retained so existing links and handoff prompts remain valid. The former mandatory
> coordinator/implementation-agent split is retired.

## Purpose and operating assumption

This repository currently serves one operator and one user. The workflow therefore optimizes for
short feedback loops, clear task boundaries, recoverable changes, and protection of that user's
data. It does not require team-oriented ceremony merely to prove that two roles touched the same
change.

For Congruence 2.0, product behavior is governed by
`docs/CONGRUENCE_V2_DESIGN.md`, task scope and ordering by
`docs/CONGRUENCE_V2_IMPLEMENTATION_PLAN.md`, and current task state by
`docs/CONGRUENCE_V2_PROGRESS.md`. This document governs how that work is executed.

## Sources to read

Every implementation session must read:

- `AGENTS.md`;
- the `Current handoff` in the applicable progress ledger;
- the complete current task, its dependencies, acceptance criteria, required tests, and phase gate;
- the design sections and frozen decisions that constrain the task; and
- the relevant implementation and tests before editing.

Read an initiative's complete design and plan when starting it, entering a materially different
area, resolving an ambiguity, or changing product or architecture decisions. Routine task work does
not require rereading both long documents from beginning to end when the relevant requirements are
already unambiguous.

Git, current code, tests, and authoritative contracts override a stale handoff. Old session logs are
non-authoritative recovery evidence and should be consulted only when the repository leaves a
specific conflict unresolved.

## Default execution model

The active session selects, implements, reviews, verifies, and records the current task directly.
There is no required coordinator role, separate implementation agent, read-only waiting period,
duplicated test run, or verification-only documentation commit.

A second agent is used only when the user requests one. A separate review pass in the active session
is optional and is useful when an elevated-risk change warrants more scrutiny.

Unless the user explicitly expands the boundary, completing one task does not authorize starting the
next task, pushing commits, tagging a version, or creating a release.

## Task workflow

### 1. Establish ground truth

Before editing:

- inspect the branch, `HEAD`, upstream, worktree, and recent relevant history;
- preserve unrelated worktree changes;
- reconcile the progress ledger with Git and the implementation; and
- confirm that the current task's dependencies are complete.

If the handoff conflicts with repository evidence, resolve and report the discrepancy before relying
on either one.

### 2. Bound the change

Write down the task identifier, acceptance criteria, affected boundaries, required tests, and explicit
non-goals. Implement only that task and compatibility work necessary to keep existing behavior
operational. Do not make an unsettled product or architecture decision merely to keep moving.

### 3. Implement with tests

Change production code, tests, and required generated artifacts together. Preserve canonical
contracts and host boundaries. Add behavioral coverage for success, failure, stale-input, and
non-mutation cases that are relevant to the task; avoid unrelated refactors and later-task work.

### 4. Verify proportionately

For an intermediate task, run:

- the tests named by the task;
- focused regression tests for the affected behavior and boundary; and
- build, typecheck, documentation, contract, or synchronization checks when the files changed make
  them relevant.

Review the complete diff and test assertions before accepting the task. A successful test run does
not need to be repeated by a second role. Rerun a check when its result is uncertain, the committed
state differs from the tested state, or review reveals a relevant defect.

Do not routinely run the complete phase gate after every intermediate task. Run the exact phase gate
once when the phase's final task is complete. Run part or all of it earlier only when shared-boundary
changes, elevated risk, or failures justify the cost.

### 5. Record and commit once

Update the progress ledger in the same focused commit as the implementation and tests. Record the
task status, meaningful checks, limitations, and a concise scope summary.

Because a commit cannot contain its own final hash, use `This commit` in its ledger row. Do not create
a separate documentation-only commit solely to replace that marker or duplicate verification
evidence. A later ordinary ledger edit may replace it with the hash; Git history remains the
authoritative mapping.

Do not add `Co-Authored-By` trailers. If the user requested uncommitted edits, leave them uncommitted.
Push, tag, and release only when explicitly requested.

### 6. Stop at the authorized boundary

Report the task result, commit if any, checks run, worktree state, and remaining risk. Stop after the
current task unless the user's request explicitly covers additional tasks or the rest of the phase.

## Elevated-risk changes

Use additional safeguards when a change can be hard to reverse for the single user, especially:

- destructive repertoire or filesystem operations;
- migration or reinterpretation of existing persisted user data;
- archive, restore, undo, or atomic change-set behavior;
- credential handling, path confinement, or other security boundaries;
- public MCP/tool contract changes or host-parity claims;
- concurrency, cancellation, or cache races that can present stale data as current; and
- pushes, tags, releases, or other external publication.

Choose safeguards that match the risk: clone or back up data, prove rollback, add failure-path and
round-trip tests, run the relevant broader gate, inspect the committed diff, or ask for an independent
review. Obtain explicit user approval before a destructive action or external publication. These
safeguards do not automatically require a separate implementation agent or duplicate every routine
check.

## Blockers

A genuine blocker exists when current sources of truth leave a material product or architecture
choice unresolved, required user data or authority is unavailable, or overlapping unrelated changes
cannot be preserved safely. Stop and ask the user with the concrete evidence and alternatives.

Test failures, difficult implementation, and fixable contract mismatches are not blockers. Fix them
within the current task and rerun the affected checks.

## Starting a new session

A concise handoff prompt is sufficient:

> Read `AGENTS.md`, `docs/COORDINATED_IMPLEMENTATION_WORKFLOW.md`, the current progress-ledger
> handoff, the complete next task, and the relevant design sections. Confirm Git ground truth,
> implement that task directly, run targeted verification, update the ledger in the same focused
> commit, and stop at the requested boundary. Run the full phase gate only at the phase boundary or
> when the change's risk warrants it.
