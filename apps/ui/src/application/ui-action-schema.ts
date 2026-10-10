import type { ToolSchema } from "../llm/openrouter";

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const text = { type: "string", minLength: 1, maxLength: 200 };
export const uiToolSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "ui_get_state",
      description:
        "Read current UI and references. Supply resultId and optional offset to retrieve a bounded page of current review/comparison evidence after compaction. No secrets. Read again after interruption or stale state.",
      parameters: object(
        { resultId: text, offset: { type: "integer", minimum: 0, maximum: 10000 } },
        [],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "ui_act",
      description:
        "Operate the visible review/comparison UI. Use the exact stateToken from ui_get_state or the latest receipt. Submit runs the complete shared workflow: do not also call its chess tools. Cannot accept edits. A fresh actionId is required for each action; retry the same request with the same ID only.",
      parameters: object({
        actionId: text,
        stateToken: { type: "string", minLength: 1, maxLength: 4000 },
        action: {
          oneOf: [
            object({
              kind: { const: "navigate" },
              surface: { enum: ["analysis.review", "analysis.compare", "document.open"] },
            }),
            object({
              kind: { const: "set_fields" },
              candidates: { type: "string", maxLength: 500 },
            }),
            object({ kind: { const: "submit" }, workflow: { enum: ["review", "compare"] } }),
            object({
              kind: { const: "select_result" },
              resultId: text,
              ply: { type: "integer", minimum: 1, maximum: 10000 },
            }),
          ],
        },
      }),
    },
  },
];
