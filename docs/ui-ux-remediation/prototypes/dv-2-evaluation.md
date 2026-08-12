# DV-2 move-tree evaluation protocol

**Status:** evaluated with synthetic proxy runs; real repertoire-builder evidence was unavailable.
The resulting participant evidence is inconclusive. The documented default was applied in the
[DV-2 decision record](../decisions/dv-2-move-tree-arrow-semantics.md), not inferred from the
synthetic results.

## Prototype

Start the UI server from the repository root:

```sh
pnpm --filter @chess-mcp/ui dev --host 127.0.0.1 --port 4173
```

Run the two mappings in separate fresh browser sessions (or reload the exact URL before each run):

- `http://127.0.0.1:4173/prototypes/dv-2-move-tree.html?mapping=enter-variation`
- `http://127.0.0.1:4173/prototypes/dv-2-move-tree.html?mapping=advance-mainline`

The page starts on `2. Nf3` and gives the required task: “Find the second variation after 2.Nf3
and go to its last move.” It shows elapsed time, wrong navigation keys, wrong-key rate, and a
stated-model selector. Reloading resets all measurements and does not persist data.

## Synthetic proxy evaluations

The two evaluations below are deterministic browser-automation runs, not people and not proxies for
user preferences. They prove that each query-flag mapping works and completes the representative
task; their zero wrong-key readings mean only that the scripted expected path was followed.
Elapsed time and stated-model preference are intentionally not treated as participant data.

| Proxy evaluation | Mapping            | Scripted keys from `2. Nf3` | Result                                              | Evidence class            |
| ---------------- | ------------------ | --------------------------- | --------------------------------------------------- | ------------------------- |
| Synthetic 1      | `enter-variation`  | `→`, `↓`, `→`               | Reached `3. Nxe5`; 0 scripted wrong navigation keys | Synthetic mechanics check |
| Synthetic 2      | `advance-mainline` | `→`, `↓`, `↓`, `→`          | Reached `3. Nxe5`; 0 scripted wrong navigation keys | Synthetic mechanics check |

These two runs are executed by the named Playwright tests and are recorded in the DV-2 decision
record. They do not make either mapping more intuitive or preferred.

## Real-participant validation unavailable

DV-2 requires two repertoire builders. Use two real, consenting participants with experience
building or maintaining chess opening repertoires; do not count an automated agent, the facilitator,
or a synthetic run as a participant.

No such participants were available for this decision. Therefore no participant completion time,
wrong-key rate, stated model, or preference was recorded, and the result is explicitly
**inconclusive**.

## Future real-participant validation

For each participant:

1. Randomly assign the first mapping; counterbalance the order across the two people.
2. Read only the task above. Do not explain the mapping or coach key presses.
3. Start a fresh session for each mapping and record whether the participant completes the task,
   elapsed time, wrong navigation keys/rate, and their selected stated model.
4. Ask one neutral follow-up: “Which arrow-key model did you expect, and why?” Record the answer
   verbatim or as a clearly marked paraphrase.
5. Record any navigation dead end, confusion, or recovery behavior.

Use this collection sheet:

| Participant | Mapping order | Completed each task | Elapsed time | Wrong keys / rate | Stated model | Notes / exact preference |
| ----------- | ------------- | ------------------- | ------------ | ----------------- | ------------ | ------------------------ |
| Builder 1   |               |                     |              |                   |              |                          |
| Builder 2   |               |                     |              |                   |              |                          |

If both rows later contain genuine participant evidence, update the existing DV-2 decision record
with the new evidence and reconsider the mapping if it materially contradicts the documented
default.

## Reproducible proxy validation

The following validates the prototype mechanics, not the design decision and not the participant
requirement:

```sh
pnpm exec playwright test --config apps/ui/playwright.config.ts apps/ui/test/e2e/dv-2-move-tree-prototype.spec.ts --project chromium --reporter=dot
pnpm test:e2e:container apps/ui/test/e2e/dv-2-move-tree-prototype.spec.ts --reporter=dot
```

The checks prove that both query mappings remain distinct, each reaches `3. Nxe5` through its
expected key sequence, the fallback URL behavior is stable, and sibling/parent/boundary/activation
keys work. They cannot supply completion time, wrong-key rate, or stated-preference evidence for
real repertoire builders. DV-2 is resolved only because its §14 documented default applies when
those participant results are inconclusive.
