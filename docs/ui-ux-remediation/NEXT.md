# Next step

The next executable UI/UX remediation packages are:

- **WP-009 — app live region and announcement policy**
- **WP-011 — `InteractiveRow` and `MoveButton`: keyboard-operable rows and move tree**

```sh
pnpm ux:task WP-009
pnpm ux:task WP-011
```

AG-5 and AG-3 are completion gates, not start blockers. Each resolves only when its configured
browser and real-AT automation reports `confirmed-pass`; missing or inconclusive evidence fails.
No evidence inspection or approval step exists. `docs/accessibility/README.md` and
`AUTOMATED_COMPLETION.md` define the pipeline and policy.

WP-005 and WP-018 still wait on WP-009. Product/design records are fixed decisions rather than
blocking gates. No package implementation was started by the automated-completion audit.

Do not stage or commit unless explicitly requested.
