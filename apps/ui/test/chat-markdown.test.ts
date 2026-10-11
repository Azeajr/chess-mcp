import test from "node:test";
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
});

const { chatPlainText, parseChatInline, parseChatMarkdown } =
  await import("../src/components/ChatMarkdown.tsx");
const { chatResultReceipt } = await import("../src/components/ChatPanel.tsx");

test("a reply's markdown becomes paragraphs, lists and emphasis, never markup", () => {
  const blocks = parseChatMarkdown(
    [
      "## Preflight: degraded",
      "**Strategic Fit ran.** Most findings are `uncertain`.",
      "Second line of the same paragraph.",
      "",
      "1. Open the English finding",
      "2. Train the Caro-Kann *instead*",
      "- a bullet after a numbered list",
      "",
      "<script>alert(1)</script>",
    ].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "list", "list", "paragraph"],
  );
  assert.deepEqual(blocks[1], {
    kind: "paragraph",
    lines: [
      [
        { kind: "strong", text: "Strategic Fit ran." },
        { kind: "text", text: " Most findings are " },
        { kind: "code", text: "uncertain" },
        { kind: "text", text: "." },
      ],
      [{ kind: "text", text: "Second line of the same paragraph." }],
    ],
  });
  assert.equal(blocks[2]?.kind === "list" && blocks[2].ordered, true);
  assert.equal(blocks[3]?.kind === "list" && blocks[3].ordered, false);
  // Markup stays text: the renderer only ever creates text nodes from it.
  assert.deepEqual(blocks[4], {
    kind: "paragraph",
    lines: [[{ kind: "text", text: "<script>alert(1)</script>" }]],
  });
});

test("snake_case and table rows survive as plain text", () => {
  assert.deepEqual(parseChatInline("intentional_exception_count is 0"), [
    { kind: "text", text: "intentional_exception_count is 0" },
  ]);
  const [table] = parseChatMarkdown("| Metric | Value |\n|---|---|\n| Entropy | 2.97 |");
  assert.deepEqual(table, {
    kind: "paragraph",
    lines: [[{ kind: "text", text: "Metric · Value" }], [{ kind: "text", text: "Entropy · 2.97" }]],
  });
  assert.equal(
    chatPlainText("**Done.** Two findings:\n- English\n- Caro-Kann"),
    "Done. Two findings: English; Caro-Kann",
  );
});

test("the model's reads fold to a receipt while results, steps and errors stay open", () => {
  const findings = JSON.stringify({
    retrieval: "strategic-fit-findings",
    page: { offset: 12, returned_count: 7, total_count: 19 },
    findings: [],
  });
  assert.equal(chatResultReceipt("get_strategic_fit_report", findings), "findings 13–19 of 19");
  assert.equal(
    chatResultReceipt(
      "get_strategic_fit_report",
      JSON.stringify({ retrieval: "strategic-fit-summary", finding_count: 19 }),
    ),
    "summary · 19 findings",
  );
  assert.equal(chatResultReceipt("ui_get_state", JSON.stringify({ ui: {} })), "read");
  assert.equal(
    chatResultReceipt("get_strategic_fit_report", JSON.stringify({ error: "stale_report" })),
    null,
  );
  assert.equal(chatResultReceipt("ui_act", JSON.stringify({ status: "blocked" })), null);
  assert.equal(
    chatResultReceipt("get_game_summary", JSON.stringify({ moves: 40, turning_points: [] })),
    null,
  );
});
