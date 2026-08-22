# Next step

The next executable UI/UX remediation package is:

- **WP-009 — app live region and announcement policy**

```sh
pnpm ux:task WP-009
```

AG-5 is WP-009's completion gate, not a start blocker. It resolves only when its configured browser
and real-AT automation reports `confirmed-pass`; missing or inconclusive evidence fails. No
evidence inspection or approval step exists. `docs/accessibility/README.md` and
`AUTOMATED_COMPLETION.md` define the pipeline and policy. AG-3 and WP-011 are complete.

WP-005 and WP-018 still wait on WP-009. Product/design records are fixed decisions rather than
blocking gates.

Do not stage or commit unless explicitly requested.
