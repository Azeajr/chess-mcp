const SEMANTIC_KEYS = [
  "type", "enum", "minimum", "maximum", "minItems", "maxItems", "maxLength",
  "additionalProperties",
];

const pointer = (base, key) => `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const stable = (value) => JSON.stringify(value);

/**
 * Recursively compare the executable subset of JSON Schema used by the canonical tool contract.
 * Transport-only prose (`description`, `title`, examples, and `$schema`) is deliberately ignored.
 */
export function schemaSemanticDifferences(actual, expected, path = "$") {
  const differences = [];
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return [`${path}: actual schema is not an object`];
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return [`${path}: expected schema is not an object`];

  for (const key of SEMANTIC_KEYS) {
    if (stable(actual[key]) !== stable(expected[key])) differences.push(`${pointer(path, key)}: ${stable(actual[key])} != ${stable(expected[key])}`);
  }

  const actualRequired = [...(actual.required ?? [])].sort();
  const expectedRequired = [...(expected.required ?? [])].sort();
  if (stable(actualRequired) !== stable(expectedRequired)) differences.push(`${pointer(path, "required")}: ${stable(actualRequired)} != ${stable(expectedRequired)}`);

  const actualProperties = actual.properties ?? {};
  const expectedProperties = expected.properties ?? {};
  const actualKeys = Object.keys(actualProperties).sort();
  const expectedKeys = Object.keys(expectedProperties).sort();
  if (stable(actualKeys) !== stable(expectedKeys)) differences.push(`${pointer(path, "properties")}: ${stable(actualKeys)} != ${stable(expectedKeys)}`);
  for (const key of expectedKeys.filter((key) => key in actualProperties))
    differences.push(...schemaSemanticDifferences(actualProperties[key], expectedProperties[key], pointer(pointer(path, "properties"), key)));

  if ("items" in expected || "items" in actual) {
    if (!("items" in actual) || !("items" in expected)) differences.push(`${pointer(path, "items")}: one schema omits array items`);
    else differences.push(...schemaSemanticDifferences(actual.items, expected.items, pointer(path, "items")));
  }
  return differences;
}

export const schemasSemanticallyEqual = (actual, expected) => schemaSemanticDifferences(actual, expected).length === 0;
