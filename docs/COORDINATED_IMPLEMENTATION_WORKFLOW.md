# Coordinated Implementation Workflow

## Purpose

This document is the durable handoff for implementation work that uses a coordinator and a separate
implementation agent. A new session should follow it instead of relying on a copied prompt or an old
task summary.

The workflow is deliberately task-agnostic. The repository, governing design documents,
implementation plan, and progress ledger determine the next task. A handoff summary is only a hint;
the actual Git state and current sources of truth always win.

For Congruence 2.0 work, the required governing documents are:

- `AGENTS.md`
- `docs/CONGRUENCE_V2_DESIGN.md`
- `docs/CONGRUENCE_V2_IMPLEMENTATION_PLAN.md`
- `docs/CONGRUENCE_V2_PROGRESS.md`

## Roles

### User

The user sets the overall scope and authorizes any material expansion of it. Unless explicitly
requested, completing a task does not authorize starting the next task, pushing commits, tagging a
version, or creating a release.

### Coordinator

The coordinator owns task selection, delegation, review, independent verification, and the final
progress record. The coordinator does not act as the implementation agent and does not write or
repair production code or tests for the delegated task.

The coordinator must:

1. Read every governing document completely. This responsibility cannot be delegated or replaced by
   an agent's summary.
2. Confirm the branch, `HEAD`, worktree status, recent commits, and active agents before trusting any
   session handoff.
3. Determine the next incomplete task from the current implementation plan, progress ledger, Git
   history, dependencies, and existing implementation.
4. Inspect the task's acceptance criteria, frozen architectural decisions, affected boundaries, and
   required verification before delegating it.
5. Preserve unrelated worktree changes and record their presence for the implementation agent.
6. Launch one implementation agent with a bounded assignment for the selected task.
7. Keep the shared worktree read-only while the implementation agent owns the task. The coordinator
   may inspect files and Git state, but must not edit, format, stage, or commit concurrently.
8. Keep the user informed with concise status updates at meaningful transitions.
9. After the agent commits, inspect the complete diff and test coverage rather than relying on the
   agent's summary.
10. Independently rerun the task-specific checks and the practical phase gate required by the plan.
11. Send defects back to the same implementation agent with concrete evidence. The coordinator does
    not repair implementation defects directly.
12. Repeat review and verification after every correction commit until the task passes or a genuine
    design blocker is documented.
13. After successful verification, replace the progress ledger's temporary `This commit` reference
    with the final implementation commit hash and record the coordinator's reproduced evidence.
14. Commit that ledger update separately as a documentation-only verification commit.
15. Confirm the final Git state, ensure no implementation agent remains active, and stop at the
    delegated task boundary.

The coordinator may update coordination documentation and the progress ledger when no implementation
agent is modifying the worktree. Those documentation duties do not authorize implementation changes.

### Implementation agent

The implementation agent owns the code, tests, generated artifacts required by the task, and the
initial progress-ledger entry. Its assignment must instruct the agent to:

1. Read every governing document completely before editing.
2. Reconfirm the relevant task definition, dependencies, acceptance criteria, and current Git state.
3. Implement only the delegated task and compatibility work strictly required to satisfy it.
4. Honor repository sources of truth and architectural boundaries, including canonical contracts,
   host-adapter responsibilities, and the exhaustive browser command registry where applicable.
5. Preserve unrelated changes and avoid opportunistic refactors or work belonging to a later task.
6. Add every behavioral, contract, integration, and end-to-end test required by the task and its
   acceptance criteria.
7. Run the task-specific checks and the practical phase gate specified by the implementation plan.
8. Update the progress ledger with implementation and test evidence, using `This commit` as the
   implementation reference while coordinator verification is pending.
9. Create focused commits without a `Co-Authored-By` trailer. The first implementation commit should
   contain the completed task; later commits, if requested, should contain only focused corrections.
10. Stop after the delegated task. It must not begin the next task, push, tag, or release.
11. Report a genuine design blocker before making a product or architecture decision not settled by
    the governing documents.
12. Return the commit hash, changed-file summary, test evidence, and any remaining risks to the
    coordinator.

## Workflow

### 1. Establish ground truth

The coordinator starts with read-only inspection:

- read the governing documents in full;
- inspect branch tracking, `HEAD`, worktree changes, and recent history;
- inspect the progress ledger for completed and pending work;
- compare the ledger with commits and the actual implementation;
- identify dependencies and any unfinished correction or verification work.

If a handoff names a task that conflicts with repository evidence, the coordinator resolves the
conflict before delegation and reports the result to the user.

### 2. Define the bounded assignment

The coordinator gives the implementation agent a self-contained assignment containing:

- the exact task identifier and title derived from the plan;
- all governing documents it must read;
- acceptance criteria and frozen decisions that constrain the work;
- known dependencies and relevant existing implementation;
- required behavioral and end-to-end coverage;
- task-specific commands and the applicable practical phase gate;
- progress-ledger and commit requirements;
- explicit stop conditions and blocker-reporting expectations;
- any unrelated dirty-worktree files that must be preserved.

The assignment should not delegate task selection or leave product decisions implicit.

### 3. Give the agent exclusive implementation ownership

Only one implementation agent works on a task at a time. While it is active, the coordinator may
monitor messages and perform read-only review preparation, but it must not change the shared
worktree. If the user changes scope, the coordinator must stop or redirect the agent before making
conflicting changes.

### 4. Require an implementation checkpoint

The implementation agent finishes with a commit and reports:

- commit hash and subject;
- files changed and behavior implemented;
- tests added or changed;
- exact commands run and their results;
- progress-ledger update;
- known limitations, risks, or blockers.

Uncommitted implementation is not ready for coordinator acceptance.

### 5. Review independently

The coordinator reviews the committed state against the plan, not merely for code style. Review must
cover:

- every acceptance criterion;
- frozen product and architecture decisions;
- canonical contracts and adapter boundaries;
- error and compatibility behavior;
- behavioral assertions, including negative and failure paths;
- end-to-end coverage required by the task;
- generated documentation or synchronized artifacts when public contracts changed;
- accidental scope expansion and unrelated file changes;
- accuracy of the progress-ledger claims.

### 6. Reproduce verification

The coordinator independently runs the smallest sufficient task-specific checks plus the practical
phase gate. It must reproduce results from the committed state; the implementation agent's test
report is supporting context, not acceptance evidence.

When a full gate is impractical because of an external dependency, the coordinator runs every local
portion, records the exact limitation, and follows the governing plan's blocker rules. A skipped gate
must never be reported as passing.

### 7. Correct defects through the same agent

For each defect, the coordinator sends the implementation agent:

- the violated requirement;
- concrete file, behavior, test, or command evidence;
- the expected outcome;
- the required verification to rerun.

The same agent makes and commits the correction. The coordinator then reviews the cumulative diff and
reruns affected checks and gates. This loop continues until acceptance or a genuine blocker.

### 8. Record independent verification

After acceptance, and only after the implementation agent has stopped modifying the worktree, the
coordinator updates the progress ledger:

- replace `This commit` with the final implementation commit hash;
- distinguish implementation-agent evidence from coordinator-reproduced evidence;
- list the exact checks and gate results;
- record any non-blocking limitations accurately.

The coordinator makes a separate documentation-only commit for this verification record. The docs
commit is not part of the implementation hash recorded in the ledger.

### 9. Close the task boundary

Before yielding, the coordinator confirms:

- the implementation and verification commits exist on the expected branch;
- the worktree has no unexpected changes;
- the progress ledger matches Git history and verification evidence;
- no implementation agent remains active;
- no work from the next task was started;
- nothing was pushed, tagged, or released unless the user explicitly requested it.

The final report gives the implementation commit, verification commit, reproduced checks, worktree
state, and any remaining risk. It does not silently continue into another task.

## Blockers and exceptions

A design blocker exists when the task requires a product or architecture decision that is not
settled by current sources of truth and materially different choices would change user-visible
behavior or public contracts. The implementation agent stops before making that decision and reports
the conflict. The coordinator verifies the conflict, documents the alternatives and evidence, and
asks the user for direction.

Test failures, difficult implementation, missing coverage, or fixable contract mismatches are not
design blockers. They stay in the implementation-and-correction loop.

If unrelated worktree changes overlap the delegated task and cannot be safely preserved, the
coordinator pauses before delegation and asks the user how to proceed.

## Starting a new session

A task-specific handoff prompt is unnecessary. The user can direct a new session with:

> Read `docs/COORDINATED_IMPLEMENTATION_WORKFLOW.md` completely and follow it for the next incomplete
> task recorded by the repository.

That single instruction is sufficient. The workflow itself requires the coordinator to read
`AGENTS.md` and every initiative-specific governing document it names, confirm the actual Git state,
and derive the task from current repository evidence.
