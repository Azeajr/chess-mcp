import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_CONTRACTS,
  TOOL_CONTRACT_BY_NAME,
  contractsForHost,
  toolContract,
  toolDefault,
  jsonSchemaForTool,
  validateToolArguments,
  type ToolHost,
} from "../../src/tool-contract.ts";
import { START_FEN } from "./fixtures.ts";

const HOSTS: ToolHost[] = ["mcp", "browser"];

/** Every contract must be reachable by name, or a host can advertise a tool it cannot dispatch. */
test("the name index covers every contract exactly once", () => {
  assert.equal(TOOL_CONTRACT_BY_NAME.size, TOOL_CONTRACTS.length, "a duplicate name shadows one");
  for (const contract of TOOL_CONTRACTS) {
    assert.equal(toolContract(contract.name), contract);
  }
});

test("every contract declares at least one host", () => {
  for (const contract of TOOL_CONTRACTS) {
    assert.ok(contract.hosts.length > 0, `${contract.name} is reachable from nowhere`);
  }
});

test("contractsForHost returns only tools that host actually serves", () => {
  for (const host of HOSTS) {
    const served = contractsForHost(host);
    assert.ok(served.length > 0, `${host} serves nothing`);
    for (const contract of served) {
      assert.ok(contract.hosts.includes(host), `${contract.name} is not a ${host} tool`);
    }
  }
});

test("toolContract names the tool it could not find rather than returning undefined", () => {
  assert.throws(() => toolContract("no_such_tool"), /unknown tool contract: no_such_tool/u);
});

test("toolDefault reads a declared default and falls back when there is none", () => {
  assert.equal(toolDefault("validate_fen", "definitely_absent", "fallback"), "fallback");
  // Any contract that declares defaults must return them rather than the fallback.
  const withDefaults = TOOL_CONTRACTS.find((c) => Object.keys(c.defaults ?? {}).length > 0);
  assert.ok(withDefaults, "at least one contract declares defaults");
  const [key, value] = Object.entries(withDefaults.defaults)[0] ?? [];
  assert.ok(key !== undefined);
  assert.deepEqual(toolDefault(withDefaults.name, key, "fallback"), value);
});

test("jsonSchemaForTool returns nothing for a host that does not serve the tool", () => {
  const mcpOnly = TOOL_CONTRACTS.find((c) => !c.hosts.includes("browser") && c.input);
  assert.ok(mcpOnly, "there is an MCP-only tool with input");
  assert.equal(jsonSchemaForTool(mcpOnly.name, "browser"), null);
  assert.notEqual(jsonSchemaForTool(mcpOnly.name, "mcp"), null);
});

test("jsonSchemaForTool closes every schema to unknown properties", () => {
  for (const host of HOSTS) {
    for (const contract of contractsForHost(host)) {
      const schema = jsonSchemaForTool(contract.name, host);
      if (!schema) continue;
      assert.equal(
        schema.additionalProperties,
        false,
        `${contract.name}/${host} would accept unknown arguments`,
      );
      assert.equal(schema.type, "object");
    }
  }
});

/** repertoire_id is injected from browser context, so it must never be asked of a browser caller. */
test("jsonSchemaForTool omits repertoire_id from browser schemas", () => {
  const browserSchema = jsonSchemaForTool("find_only_moves", "browser");
  const mcpSchema = jsonSchemaForTool("find_only_moves", "mcp");
  assert.ok(browserSchema && mcpSchema);

  assert.ok("repertoire_id" in (mcpSchema.properties as object), "MCP still asks for it");
  assert.equal("repertoire_id" in (browserSchema.properties as object), false);
  assert.equal(
    ((browserSchema.required as string[] | undefined) ?? []).includes("repertoire_id"),
    false,
    "it must not survive in required either",
  );
});

test("every required key in a schema is a property of that same schema", () => {
  for (const host of HOSTS) {
    for (const contract of contractsForHost(host)) {
      const schema = jsonSchemaForTool(contract.name, host);
      if (!schema) continue;
      const properties = schema.properties as Record<string, unknown>;
      for (const key of (schema.required as string[] | undefined) ?? []) {
        assert.ok(key in properties, `${contract.name}/${host} requires undeclared ${key}`);
      }
    }
  }
});

test("validateToolArguments rejects anything that is not an argument object", () => {
  for (const raw of [null, undefined, [], "fen", 42, true]) {
    const result = validateToolArguments("validate_fen", raw, "mcp");
    assert.equal(result.ok, false, `${JSON.stringify(raw)} was accepted`);
    if (!result.ok) assert.equal(result.reason, "arguments must be an object");
  }
});

test("validateToolArguments rejects an unknown tool and a tool absent from the host", () => {
  const unknown = validateToolArguments("no_such_tool", {}, "mcp");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.reason, /unknown tool: no_such_tool/u);

  const mcpOnly = TOOL_CONTRACTS.find((c) => !c.hosts.includes("browser"));
  assert.ok(mcpOnly);
  const wrongHost = validateToolArguments(mcpOnly.name, {}, "browser");
  assert.equal(wrongHost.ok, false);
  if (!wrongHost.ok) assert.match(wrongHost.reason, /is not available on the browser host/u);
});

test("validateToolArguments accepts a well-formed call and returns the value", () => {
  const result = validateToolArguments("validate_fen", { fen: START_FEN }, "mcp");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { fen: START_FEN });
});

test("validateToolArguments names the missing required argument", () => {
  const result = validateToolArguments("validate_fen", {}, "mcp");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing required argument: fen");
});

/** An unknown key is refused rather than ignored, so a typo cannot silently do nothing. */
test("validateToolArguments refuses an unknown argument", () => {
  const result = validateToolArguments("validate_fen", { fen: START_FEN, depht: 3 }, "mcp");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unknown argument: depht");
});

test("validateToolArguments reports the wrong type against the declared one", () => {
  const result = validateToolArguments("validate_fen", { fen: 42 }, "mcp");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "fen must be string");
});

test("validateToolArguments enforces integer bounds at both ends", () => {
  const call = (depth: unknown) =>
    validateToolArguments("evaluate_position", { fen: START_FEN, depth }, "mcp");

  assert.equal(call(1).ok, true, "the minimum is allowed");
  assert.equal(call(30).ok, true, "the maximum is allowed");

  for (const [value, expected] of [
    [0, /outside the allowed range/u],
    [31, /outside the allowed range/u],
    [3.5, /must be integer/u],
    ["3", /must be integer/u],
  ] as const) {
    const result = call(value);
    assert.equal(result.ok, false, `${JSON.stringify(value)} was accepted`);
    if (!result.ok) assert.match(result.reason, expected);
  }
});

/** A NaN or Infinity passes a naive typeof check, so the number branch must exclude them. */
test("validateToolArguments rejects a non-finite number", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    const result = validateToolArguments(
      "evaluate_position",
      { fen: START_FEN, depth: value },
      "mcp",
    );
    assert.equal(result.ok, false, `${String(value)} was accepted`);
  }
});

test("validateToolArguments validates array items and points at the offending index", () => {
  const ok = validateToolArguments("validate_line", { fen: START_FEN, moves: ["e4", "e5"] }, "mcp");
  assert.equal(ok.ok, true);

  const notArray = validateToolArguments("validate_line", { fen: START_FEN, moves: "e4" }, "mcp");
  assert.equal(notArray.ok, false);
  if (!notArray.ok) assert.equal(notArray.reason, "moves must be array");

  const badItem = validateToolArguments(
    "validate_line",
    { fen: START_FEN, moves: ["e4", 5] },
    "mcp",
  );
  assert.equal(badItem.ok, false);
  if (!badItem.ok) assert.equal(badItem.reason, "moves[1] must be string", "the index is reported");
});

test("validateToolArguments accepts an empty array where no minimum is declared", () => {
  const result = validateToolArguments("validate_line", { fen: START_FEN, moves: [] }, "mcp");
  assert.equal(result.ok, true);
});

/**
 * Every contract that declares required arguments must reject the empty call. This is a sweep
 * rather than a per-tool case: it catches a contract whose required list stops being enforced.
 */
test("every tool with required arguments rejects an empty call", () => {
  for (const host of HOSTS) {
    for (const contract of contractsForHost(host)) {
      const schema = jsonSchemaForTool(contract.name, host);
      const required = (schema?.required as string[] | undefined) ?? [];
      if (required.length === 0) continue;
      const result = validateToolArguments(contract.name, {}, host);
      assert.equal(result.ok, false, `${contract.name}/${host} accepted an empty call`);
      if (!result.ok) assert.match(result.reason, /^missing required argument: /u);
    }
  }
});

/**
 * `validateToolArguments` has a branch that passes arguments straight through for a contract with
 * no `input`, which would mean no validation at all for that tool. Today every contract declares
 * one, so the branch is unreachable — asserted here so that adding an input-less tool trips this
 * test and the author has to decide deliberately that it should bypass validation.
 */
test("every contract declares an input schema, so nothing bypasses validation", () => {
  const withoutInput = TOOL_CONTRACTS.filter((contract) => !contract.input).map((c) => c.name);
  assert.deepEqual(withoutInput, [], "these tools would accept any arguments unchecked");
});
