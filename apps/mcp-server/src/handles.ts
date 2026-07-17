/**
 * Repertoire handle cache — the Node port of the Python server's in-memory LRU+TTL. load_*
 * returns a short id; the other repertoire tools take it. The MCP contract stays a pure
 * function of (id, args): the id is an input key, not call-order state.
 */
import { randomUUID } from "node:crypto";
import type { GameTree, Color } from "@chess-mcp/chess-tools";

const MAX = Number(process.env.MAX_REPERTOIRES ?? 16);
const TTL_MS = Number(process.env.REPERTOIRE_TTL_S ?? 3600) * 1000;

interface Entry {
  tree: GameTree;
  color: Color;
  /** Immutable clone-on-write handle generation used as the Strategic Fit report revision. */
  revision: string;
  ts: number;
}

const map = new Map<string, Entry>();

function evict() {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.ts > TTL_MS) map.delete(k);
  while (map.size > MAX) {
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    for (const [k, v] of map) if (v.ts < oldestTs) ((oldestTs = v.ts), (oldestKey = k));
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

export function store(tree: GameTree, color: Color): string {
  const id = randomUUID();
  map.set(id, { tree, color, revision: `mcp:${id}`, ts: Date.now() });
  evict(); // after insert: evict-before-insert capped at MAX+1 (size checked pre-add); the new
  // entry has the newest ts, so the LRU sweep never evicts what we just stored.
  return id;
}

export function get(id: string): Entry | null {
  const e = map.get(id);
  if (!e) return null;
  const now = Date.now();
  if (now - e.ts > TTL_MS) {
    map.delete(id);
    return null;
  }
  e.ts = now;
  return e;
}
