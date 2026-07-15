import { validateToolArguments } from "@chess-mcp/chess-tools";
import { defaultBrowserCommandDependencies } from "./default-context";
import { browserCommandImplementations } from "./registry";
import type { BrowserCommandDependencies, BrowserCommandExecutionOptions, BrowserCommandName } from "./types";
import { throwIfAborted } from "./types";

export async function executeBrowserCommand(
  name: string,
  rawArguments: unknown,
  options: BrowserCommandExecutionOptions = {},
  dependencies: BrowserCommandDependencies = defaultBrowserCommandDependencies,
): Promise<unknown> {
  throwIfAborted(options.signal);
  const checked = validateToolArguments(name, rawArguments, "browser");
  if (!checked.ok) return { error: checked.error, reason: checked.reason };
  const implementation = browserCommandImplementations[name as BrowserCommandName];
  if (!implementation) return { error: "command_not_implemented", reason: `${name} has no browser implementation` };
  const result = await implementation(checked.value, { ...dependencies, ...options });
  throwIfAborted(options.signal);
  return result;
}

export type { BrowserCommandDependencies, BrowserCommandExecutionOptions } from "./types";
