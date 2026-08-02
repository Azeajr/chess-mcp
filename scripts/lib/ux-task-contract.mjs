import path from "node:path";

const rootFiles = new Set(["AGENTS.md", "package.json"]);
const executables = new Set([
  "bash",
  "bun",
  "deno",
  "docker",
  "env",
  "git",
  "make",
  "node",
  "npm",
  "npx",
  "pnpm",
  "sh",
  "yarn",
  "zsh",
]);

export const isCommandLike = (value) => {
  if (typeof value !== "string" || !value) return false;
  if (/\s|[|;&<>`$]/u.test(value) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)) return true;
  return executables.has(value);
};

export const normalizePrimaryFile = (value) => {
  if (typeof value !== "string" || !value) return { error: "must be a non-empty string" };
  if (isCommandLike(value)) return { error: "is a command, not a file" };
  if (value.includes("\\")) return { error: "uses backslashes" };
  if (path.posix.isAbsolute(value)) return { error: "is absolute" };
  if (value.split("/").includes("..")) return { error: "contains parent traversal" };
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../"))
    return { error: "escapes the repository", normalized };
  if (normalized !== value) return { error: `is non-canonical; use ${normalized}`, normalized };
  if (!value.includes("/") && !rootFiles.has(value)) return { error: "is an ambiguous basename" };
  return { value: normalized };
};

export const validatePrimaryFiles = (files) => {
  const errors = [];
  const normalizedFiles = new Set();
  for (const file of files) {
    const normalized = normalizePrimaryFile(file);
    if (normalized.error) errors.push(`${file} ${normalized.error}`);
    const canonical = normalized.value ?? normalized.normalized;
    if (canonical && normalizedFiles.has(canonical))
      errors.push(`duplicate normalized primary file: ${canonical}`);
    if (canonical) normalizedFiles.add(canonical);
  }
  return errors;
};

export const validateRelevantSymbol = (value) => {
  if (typeof value !== "string" || !value) return "must be a non-empty string";
  if (isCommandLike(value)) return "is a command or command argument";
  if (value.includes("/") || value.endsWith("/")) return "is a file or directory path";
  if (/\.(?:[cm]?[jt]sx?|css|json|md|ya?ml)(?::\d.*)?$/u.test(value)) return "is a file path";
  if (/^[\w.-]+:\d/u.test(value)) return "is a line-qualified file path";
  return undefined;
};

export const validateWp000RequiredCommands = (item) =>
  ["pnpm --filter @chess-mcp/ui test:chat", "pnpm test:e2e:container", "pnpm ux:plan-check"].filter(
    (command) => !item.requiredTests.commands.includes(command),
  );

export const deriveTaskLifecycle = (item, packageState, state) => {
  const status = packageState?.status ?? "missing";
  const unresolvedDependencies = item.dependencies.filter(
    (dependency) => state.packages[dependency]?.status !== "complete",
  );
  const unresolvedGates = item.blockingGates.filter(
    (gate) => state.gates[gate]?.status !== "resolved",
  );
  const unresolvedFoundations = (item.prerequisites ?? []).filter(
    (foundation) => state.foundations?.[foundation]?.status !== "complete",
  );
  const readiness =
    status === "not-started"
      ? unresolvedDependencies.length || unresolvedGates.length || unresolvedFoundations.length
        ? "blocked"
        : "ready"
      : "not-executable";
  return { status, readiness, unresolvedDependencies, unresolvedGates, unresolvedFoundations };
};

const section = (title, values, empty = "none") =>
  `${title}:\n${values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`}`;

export const buildTaskCapsule = (id, item, state) => {
  const lifecycle = deriveTaskLifecycle(item, state.packages[id], state);
  if (lifecycle.status === "complete") {
    return {
      executable: false,
      text: [
        `${id} — status: complete`,
        `${id} — readiness: not-executable`,
        "completed package; do not execute it again.",
      ].join("\n"),
    };
  }
  const dependencies = [
    ...item.dependencies.map(
      (dependency) => `${dependency}: ${state.packages[dependency]?.status ?? "missing"}`,
    ),
    ...(item.prerequisites ?? []).map(
      (foundation) =>
        `${foundation} (foundation): ${state.foundations?.[foundation]?.status ?? "missing"}`,
    ),
  ];
  const gates = item.blockingGates.map(
    (gate) => `${gate}: ${state.gates[gate]?.status ?? "missing"}`,
  );
  return {
    executable: lifecycle.readiness === "ready",
    text: [
      `${id} — status: ${lifecycle.status}`,
      `${id} — readiness: ${lifecycle.readiness}`,
      section("dependency status", dependencies),
      section("gate status", gates),
      section("allowed primary files", item.primaryFiles),
      section("relevant symbols", item.relevantSymbols, "none explicitly named"),
      section(
        "acceptance criteria",
        item.acceptanceCriteria.map(
          (criterion) => `${criterion.id}: ${criterion.text.replace(/^- /u, "")}`,
        ),
      ),
      section(
        "preserved behavior contracts",
        item.preservedBehaviorContracts ?? [
          "See the package capsule's Behaviors to preserve section.",
        ],
      ),
      section("required tests", [...item.requiredTests.files, ...item.requiredTests.commands]),
      `rollback rule:\n- ${item.rollbackRule ?? "See the package capsule's Failure and rollback contract."}`,
    ].join("\n\n"),
  };
};

const has = (text, expression) => expression.test(text);

export const validateCompositeWidgetContract = (sources) => {
  const errors = [];
  const text = sources.join("\n");
  if (!has(text, /board.{0,120}(?:one page-level Tab stop|exactly one tab stop)/isu))
    errors.push("missing board single-Tab-stop contract");
  if (!has(text, /move tree.{0,120}(?:one page-level Tab stop|exactly one tab stop)/isu))
    errors.push("missing move-tree single-Tab-stop contract");
  if (!has(text, /board.{0,180}(?:internal keyboard traversal|Arrow keys move the cursor)/isu))
    errors.push("missing board internal-navigation contract");
  if (!has(text, /move tree.{0,180}(?:internal arrow-key traversal|↑ ↓ ← → Home End)/isu))
    errors.push("missing move-tree internal-arrow-navigation contract");
  if (!has(text, /individual squares.{0,80}not.{0,60}page-level Tab stops/isu))
    errors.push("missing individual-square Tab exclusion");
  if (!has(text, /individual move(?:s| items).{0,80}not.{0,60}page-level Tab stops/isu))
    errors.push("missing individual-move Tab exclusion");
  if (!has(text, /keyboardReachable.{0,160}\.rep-row/isu))
    errors.push("missing individually reachable repertoire-row contract");
  const tabRequirementText = text.replace(
    /(?:individual squares|individual moves|individual move items)[^.\n]*\bnot[^.\n]*(?:page(?:-level)? )?Tab (?:stops|sequence)[^.\n]*/giu,
    "",
  );
  if (
    has(
      tabRequirementText,
      /(?:every|each|individual) (?:board )?squares?.{0,100}(?:Tab-reachable|page(?:-level)? Tab|Tab (?:order|sequence|stop))/isu,
    )
  )
    errors.push("requires individual board squares in page Tab traversal");
  if (
    has(
      tabRequirementText,
      /(?:every|each|individual) move(?: items?)?.{0,100}(?:Tab-reachable|page(?:-level)? Tab|Tab (?:order|sequence|stop))/isu,
    )
  )
    errors.push("requires individual moves in page Tab traversal");
  return errors;
};
