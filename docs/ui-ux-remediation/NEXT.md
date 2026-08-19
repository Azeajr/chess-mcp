# Next step

The next executable UI/UX remediation package is **WP-011 — `InteractiveRow` and `MoveButton`:
keyboard-operable rows and move tree**.

```sh
pnpm ux:task WP-011
```

`AG-3` is a completion gate on WP-011: it does not block starting, and it must be resolved — by its
owner, from real NVDA and VoiceOver evidence — before WP-011 can be recorded complete.
`docs/accessibility/README.md` describes the pipeline that produces that evidence.

WP-003 and WP-004 (the document-close guard and the autosave snapshot ring) are complete. That
unblocks nothing further on its own: WP-005 and WP-018 both wait on WP-009, which is held by gate
`AG-5`, and WP-005 additionally on gate `PD-3`. WP-011 is the only ready package.

Do not stage or commit unless explicitly requested.
