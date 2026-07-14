# MCP design history

Historical status: superseded implementation guide; retained rationale only.

The original design established principles still used by the TypeScript server: tool output is
model context, so results should be bounded reasoning primitives; summaries should emit stable
drill-down references; expensive shared work may be transparently cached; large reusable inputs may
use bounded handles; actions must be explicit; and errors should be structured and closed.

Point-in-time token measurements, transport recommendations, filenames, tool inventories, and error
lists from the original document were removed because they were not mechanically current. See
`docs/ARCHITECTURE.md` and the generated catalog for the implementation.
