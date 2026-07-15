/** OpenRouter schema projection plus a thin adapter to the application-owned command client. */
import type { ToolSchema } from "./openrouter";
import { contractsForHost, jsonSchemaForTool } from "@chess-mcp/chess-tools";
import { executeBrowserCommand, type BrowserCommandExecutionOptions } from "../application/browser-commands/client";

export const toolSchemas: ToolSchema[] = contractsForHost("browser").map((contract) => ({
  type: "function",
  function: {
    name: contract.name,
    description: contract.description,
    parameters: jsonSchemaForTool(contract.name, "browser")!,
  },
}));

export type ToolExecutionOptions = BrowserCommandExecutionOptions;
export const runTool = executeBrowserCommand;
