import type { ToolSchema } from "../llm/openrouter";
import { GUIDED_SURFACES } from "../store/guided-ui";
import { WORKFLOWS, FORMS, PUBLIC_SETTINGS, SETTINGS_SECTIONS } from "./ui-adapters/catalog";

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const text = { type: "string", minLength: 1, maxLength: 200 };
const kind = (value: string) => ({ const: value });

export const uiToolSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "ui_get_state",
      description:
        "Read the current UI: document, visible surfaces, form drafts, results, Strategic Fit, pending proposals and settings (no secrets). Supply resultId and optional offset for a bounded page of a current result's evidence. Read again after interruption, a blocked receipt or stale state.",
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
        "Operate the visible app with the user. Use the exact stateToken from the latest state or receipt and a fresh actionId per action (retry the same request with the same ID only). navigate reveals a surface; set_fields fills a visible form (replace:true only when the user's request names the new value); submit runs the same workflow as the visible control — do not also call its chess tools; select_result selects a current result item; select_path moves the board to an existing line; show_proposal reveals a pending proposal for decision; approve_proposal applies one only when the user's current message explicitly approves the single preview you showed in the previous turn; open_settings reveals settings (the user enters credentials); set_setting changes a public setting the user's current message asked for. One dependent action per round.",
      parameters: object({
        actionId: text,
        stateToken: { type: "string", minLength: 1, maxLength: 4000 },
        action: {
          oneOf: [
            object({ kind: kind("navigate"), surface: { enum: GUIDED_SURFACES } }),
            object(
              {
                kind: kind("set_fields"),
                form: { enum: FORMS },
                values: {
                  type: "object",
                  description:
                    "compare {candidates}; history {platform: lichess|chesscom, username, month: YYYY-MM}; structure {structure}; opponent {username}; extend {style: low_memorization|sharp}; decision {findingId, decision: keep-intentionally|defer|exclude-from-analysis|invalid-comparison, reason?, note?} prepares a decision for the user to accept; replacementLab {pivotDecisionId?, sources?: string[], depth?}",
                },
                replace: { type: "boolean" },
              },
              ["kind", "form", "values"],
            ),
            object(
              {
                kind: kind("submit"),
                workflow: { enum: Object.keys(WORKFLOWS) },
                target: {
                  ...text,
                  description:
                    "gap_fill: gap itemId; lab_open/open_drill: findingId; lab_stage: candidateId",
                },
                option: { enum: ["add-alternative", "replace"] },
              },
              ["kind", "workflow"],
            ),
            object(
              {
                kind: kind("select_result"),
                resultId: text,
                ply: { type: "integer", minimum: 1, maximum: 10000 },
                itemId: text,
                board: {
                  type: "boolean",
                  description: "Strategic Fit finding: show its line on the board",
                },
              },
              ["kind", "resultId"],
            ),
            object({
              kind: kind("select_path"),
              sanPath: { type: "array", items: { type: "string", maxLength: 10 }, maxItems: 300 },
            }),
            object({ kind: kind("show_proposal"), proposalId: text }),
            object({
              kind: kind("approve_proposal"),
              proposalId: text,
              previewVersion: { type: "string", minLength: 1, maxLength: 2000 },
              approvalMessageId: text,
            }),
            object({ kind: kind("open_settings"), section: { enum: SETTINGS_SECTIONS } }),
            object({
              kind: kind("set_setting"),
              setting: { enum: PUBLIC_SETTINGS },
              value: { type: ["integer", "boolean", "string"] },
              requestMessageId: text,
            }),
          ],
        },
      }),
    },
  },
];
