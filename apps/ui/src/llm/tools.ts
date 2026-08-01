/** OpenRouter schema projection plus a thin adapter to the application-owned command client. */
import type { ToolSchema } from "./openrouter";
import { contractsForHost, jsonSchemaForTool } from "@chess-mcp/chess-tools";
import {
  executeBrowserCommand,
  type BrowserCommandExecutionOptions,
} from "../application/browser-commands/client";

export const toolSchemas: ToolSchema[] = contractsForHost("browser").map((contract) => {
  const parameters = jsonSchemaForTool(contract.name, "browser");
  if (!parameters) throw new Error(`Missing browser schema for ${contract.name}`);
  return {
    type: "function",
    function: { name: contract.name, description: contract.description, parameters },
  };
});

export type ToolExecutionOptions = BrowserCommandExecutionOptions;
export const runTool = executeBrowserCommand;
