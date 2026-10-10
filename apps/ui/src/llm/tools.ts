import type { ToolSchema } from "./openrouter";
import { contractsForHost, jsonSchemaForTool } from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../application/browser-commands/client";
import { executeCommand, isDirectCommand } from "../store/commands";
import { executeUiTool, type UiToolOptions } from "../application/ui-actions";
import { uiToolSchemas } from "../application/ui-action-schema";
import { fen } from "../store/game";

export const toolSchemas: ToolSchema[] = contractsForHost("browser").map((contract) => {
  const parameters = jsonSchemaForTool(contract.name, "browser");
  if (!parameters) throw new Error(`Missing browser schema for ${contract.name}`);
  return {
    type: "function",
    function: { name: contract.name, description: contract.description, parameters },
  };
});

export const runTool = executeBrowserCommand;

// Keep the canonical chess inventory independently auditable. UI adapters are browser-only.
export const assistantToolSchemas = [...toolSchemas, ...uiToolSchemas];
if (
  new Set(assistantToolSchemas.map((tool) => tool.function.name)).size !==
  assistantToolSchemas.length
)
  throw new Error("Duplicate assistant tool name");

export function ownsCommandLifecycle(name: string, args: unknown): boolean {
  return (
    name === "ui_act" ||
    name === "ui_get_state" ||
    (isDirectCommand(name) &&
      !!args &&
      typeof args === "object" &&
      !Array.isArray(args) &&
      !("pgn" in args) &&
      (!("fen" in args) || args.fen === fen()))
  );
}

export const runAssistantTool = async (
  name: string,
  args: unknown,
  options: Parameters<typeof runTool>[2] & UiToolOptions = {},
  dependencies?: Parameters<typeof runTool>[3],
): Promise<unknown> => {
  if (name === "ui_act" || name === "ui_get_state")
    return executeUiTool(name, args, { ...options, dependencies });
  if (isDirectCommand(name) && ownsCommandLifecycle(name, args))
    return executeCommand(name, args as Record<string, unknown>, {
      ...options,
      dependencies,
      returnErrors: true,
    });
  return runTool(name, args, options, dependencies);
};
