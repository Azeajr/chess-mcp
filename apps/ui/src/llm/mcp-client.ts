/**
 * Browser MCP client over the dev bridge (vite-plugin-mcp-bridge → /__mcp). Thin JSON-RPC
 * transport: initialize handshake, tools/list, tools/call. Dev-only — if the endpoint is absent
 * (the deployed PWA has no Node process), initBridge() returns false and the chat store degrades
 * to its browser-native tools. See docs/design/UI_MCP_BRIDGE_DESIGN.md.
 */
import type { ToolSchema } from "./openrouter";

const ENDPOINT = "/__mcp";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let nextId = 1;
let initPromise: Promise<boolean> | null = null;
const toolDefs = new Map<string, McpToolDef>();

async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) throw new Error(`MCP bridge ${res.status}`);
  const msg = (await res.json()) as RpcResponse;
  if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
  return msg.result ?? {};
}

async function notify(method: string, params?: unknown): Promise<void> {
  await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params }),
  });
}

/** Idempotent handshake. Resolves true if the bridge is reachable and initialized. */
export function initBridge(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "chess-ui", version: "0.0.0" },
      });
      await notify("notifications/initialized");
      return true;
    })().catch(() => {
      initPromise = null; // allow a later retry (e.g. bridge started after page load)
      return false;
    });
  }
  return initPromise;
}

export async function listTools(): Promise<Map<string, McpToolDef>> {
  const r = await rpc("tools/list");
  toolDefs.clear();
  for (const t of (r.tools as McpToolDef[]) ?? []) toolDefs.set(t.name, t);
  return toolDefs;
}

export function toolDef(name: string): McpToolDef | undefined {
  return toolDefs.get(name);
}

/** True if the tool accepts a `repertoire_id` argument (drives handle injection, D2). */
export function takesRepertoireId(name: string): boolean {
  const props = toolDefs.get(name)?.inputSchema?.properties as Record<string, unknown> | undefined;
  return !!props && "repertoire_id" in props;
}

/** Calls a tool; returns the concatenated text content. Throws on tool error (isError). */
export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const r = await rpc("tools/call", { name, arguments: args });
  const content = (r.content as { type: string; text?: string }[]) ?? [];
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  if (r.isError) throw new Error(text || "tool error");
  return text;
}

export function bridgedSchema(t: McpToolDef): ToolSchema {
  return {
    type: "function",
    function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
  };
}
