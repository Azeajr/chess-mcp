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

const HUMAN_COMPLETION_LANGUAGE =
  /\b(?:manual(?:ly)?|reviewer|participant|user study|card sort|visual review|side-by-side review|listen(?:ing)?|approval|sign-off)\b/iu;

export const validateAutomatedCompletionContract = (item) => {
  const errors = [];
  if (Object.hasOwn(item, "requiredManualValidation"))
    errors.push("uses the forbidden requiredManualValidation field");
  if (
    typeof item.requiredAutomatedValidation !== "string" ||
    item.requiredAutomatedValidation.trim() === ""
  )
    errors.push("must define non-empty requiredAutomatedValidation");
  else if (HUMAN_COMPLETION_LANGUAGE.test(item.requiredAutomatedValidation))
    errors.push("requiredAutomatedValidation contains human completion language");
  return errors;
};

export const validateGateResolution = (id, gate) => {
  if (!/^AG-\d+$/u.test(id) || gate?.status !== "resolved") return [];
  const evidence = gate.evidence;
  const errors = [];
  if (evidence?.mode !== "automated") errors.push("resolved accessibility gate is not automated");
  if (evidence?.outcome !== "confirmed-pass")
    errors.push("resolved accessibility gate lacks confirmed-pass outcome");
  if (typeof evidence?.command !== "string" || evidence.command.trim() === "")
    errors.push("resolved accessibility gate lacks validation command");
  if (typeof evidence?.runId !== "string" || evidence.runId.trim() === "")
    errors.push("resolved accessibility gate lacks run id");
  return errors;
};

export const validateCompletionGateEvidence = (item, packageState) => {
  if (packageState?.status !== "complete") return [];
  return (item.completionGates ?? []).flatMap((gate) => {
    const evidence = packageState.evidence?.gates?.[gate];
    if (
      evidence?.mode === "automated" &&
      evidence?.outcome === "confirmed-pass" &&
      typeof evidence?.command === "string" &&
      evidence.command.trim() !== "" &&
      typeof evidence?.runId === "string" &&
      evidence.runId.trim() !== ""
    )
      return [];
    return [`completion gate ${gate} lacks package-bound automated confirmed-pass evidence`];
  });
};

// A completion record is only trustworthy if it names an e2e run that was not narrowed to the
// package's own spec file or grep. Scoped runs pass while the package silently regresses another
// package's acceptance criteria, which is exactly how WP-011 shipped a WP-002 AC-2 regression and
// WP-015 unmounted the Strategic Fit entry point on phone viewports.
const E2E_COMMAND = /\b(?:pnpm\s+test:e2e(?::container)?|playwright\s+test)\b/u;
const SCOPED_RUN = /(?:\.spec\.ts|--grep\b|\s-g\s)/u;

// Completions recorded before this gate existed. Both named only core-layout.spec.ts, so neither
// meets the rule; they are listed rather than silently exempted so removing one is a deliberate act.
const PRE_GATE_COMPLETIONS = new Set(["WP-001", "WP-002"]);

export const validateCompletionEvidence = (id, packageState) => {
  if (packageState?.status !== "complete") return [];
  if (PRE_GATE_COMPLETIONS.has(id)) return [];
  const validation = packageState.evidence?.validation;
  if (!Array.isArray(validation) || !validation.length)
    return ["completion records no validation evidence"];
  const commands = validation.filter((entry) => typeof entry === "string");
  const e2e = commands.filter((command) => E2E_COMMAND.test(command));
  if (!e2e.length) return ["completion records no end-to-end run"];
  if (!e2e.some((command) => !SCOPED_RUN.test(command)))
    return ["completion records only spec-scoped end-to-end runs; a full-suite run is required"];
  return [];
};

export const deriveTaskLifecycle = (item, packageState, state) => {
  const status = packageState?.status ?? "missing";
  const unresolvedDependencies = item.dependencies.filter(
    (dependency) => state.packages[dependency]?.status !== "complete",
  );
  const unresolvedGates = item.blockingGates.filter(
    (gate) => state.gates[gate]?.status !== "resolved",
  );
  // Completion gates deliberately do not affect readiness. A gate whose own required evidence is
  // produced by the package it guards (AG-1 needs the Dialog contract suite, which WP-007 creates)
  // can never be resolved before that package starts, so blocking on it is a deadlock rather than
  // a safeguard. It is still enforced, just at the other end: ux-plan-check rejects a package
  // recorded complete while one of its completion gates is unresolved.
  const unresolvedCompletionGates = (item.completionGates ?? []).filter(
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
  return {
    status,
    readiness,
    unresolvedDependencies,
    unresolvedGates,
    unresolvedCompletionGates,
    unresolvedFoundations,
  };
};

const section = (title, values, empty = "none") =>
  `${title}:\n${values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`}`;

const stopMessage = (id, reason) =>
  `STOP: ${id} is ${reason} and must not be implemented or edited.`;

export const renderAgentExecutionProtocol = (id) =>
  [
    `agent execution protocol for ${id}:`,
    `- Inspect AGENTS.md and docs/ui-ux-remediation/work-packages/${id}.md before editing; the package-specific capsule above is authoritative.`,
    `- Implement ${id} only, preserve unrelated working-tree changes, and stay within its allowed primary files unless repository evidence requires a directly related supporting file.`,
    `- Satisfy every acceptance criterion and preserved behavior contract without weakening tests. Run pnpm ux:test ${id}, every required test/check above, and the repository's canonical test workflow.`,
    `- Run the full end-to-end suite unnarrowed by any spec path or --grep before recording completion. A package-scoped run cannot show whether ${id} regressed another package, and completion evidence that names only scoped runs is rejected.`,
    `- Run every completion gate's configured automation before recording completion. The command's deterministic exit status is the decision: pass records the gate as resolved; failure, missing evidence, and inconclusive evidence block completion. Never request human approval of the artifacts.`,
    `- Only after all required validation passes, record ${id} alone as complete with validation evidence in docs/ui-ux-remediation/state.json, then run pnpm ux:plan-check.`,
    `- Rerun pnpm ux:task ${id} and verify that it exits nonzero as complete/non-executable.`,
    "- Inspect the current manifest and state after completion. In the final response, name the next executable package, or state that none is ready and summarize the blockers.",
    "- Do not stage or commit unless the user explicitly requests it separately. Report actual command results and distinguish unrelated pre-existing failures.",
  ].join("\n");

const renderBlockers = (lifecycle) => [
  ...lifecycle.unresolvedDependencies.map((dependency) => `dependency ${dependency}`),
  ...lifecycle.unresolvedGates.map((gate) => `gate ${gate}`),
  ...lifecycle.unresolvedFoundations.map((foundation) => `foundation ${foundation}`),
];

export const buildTaskCapsule = (id, item, state) => {
  const lifecycle = deriveTaskLifecycle(item, state.packages[id], state);
  if (lifecycle.readiness === "not-executable") {
    return {
      executable: false,
      text: [
        `${id} — status: ${lifecycle.status}`,
        `${id} — readiness: not-executable`,
        stopMessage(id, `${lifecycle.status}/non-executable`),
      ].join("\n"),
    };
  }
  if (lifecycle.readiness === "blocked") {
    return {
      executable: false,
      text: [
        `${id} — status: ${lifecycle.status}`,
        `${id} — readiness: blocked`,
        section("blockers", renderBlockers(lifecycle)),
        stopMessage(id, "blocked"),
      ].join("\n\n"),
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
  const completionGates = (item.completionGates ?? []).map(
    (gate) => `${gate}: ${state.gates[gate]?.status ?? "missing"}`,
  );
  return {
    executable: lifecycle.readiness === "ready",
    text: [
      `${id} — status: ${lifecycle.status}`,
      `${id} — readiness: ${lifecycle.readiness}`,
      section("dependency status", dependencies),
      section("gate status", gates),
      section(
        "completion gate status (must be resolved before recording complete)",
        completionGates,
      ),
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
      `required automated validation:\n- ${item.requiredAutomatedValidation}`,
      `rollback rule:\n- ${item.rollbackRule ?? "See the package capsule's Failure and rollback contract."}`,
      renderAgentExecutionProtocol(id),
    ].join("\n\n"),
  };
};

export const validateRemediationAgentInstructions = (source) => {
  const errors = [];
  if (!/^## UI\/UX remediation work packages$/mu.test(source))
    errors.push("missing UI/UX remediation work-package instruction section");
  if (!/`Implement WP-<three digits>`/u.test(source))
    errors.push("missing Implement WP-<three digits> convention");
  if (!/`pnpm ux:task WP-NNN`/u.test(source))
    errors.push("missing authoritative ux:task preflight command");
  if (!/next executable package/u.test(source))
    errors.push("missing next executable package handoff");
  if (!/full end-to-end suite/iu.test(source))
    errors.push("missing full-suite end-to-end regression requirement");
  if (/WP-\d{3} AC-\d+/u.test(source))
    errors.push("duplicates package-specific acceptance criteria");
  return errors;
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
