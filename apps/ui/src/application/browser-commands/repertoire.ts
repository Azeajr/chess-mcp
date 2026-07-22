import {
  STRUCTURE_NAMES,
  annotateRepertoire,
  auditRepertoireMoves,
  buildRepertoireGraph,
  checkShortcutCoverage,
  collectStrategicPersonalHistoryWeights,
  collectStrategicPopularityWeights,
  compareShortcutLines,
  findOnlyMoves,
  gapScanOperation,
  illustrativeLinesResult,
  onlyMoveDeckCsv,
  opponentPrepResult,
  repertoireCoverageResult,
  resolveDanglingStubs,
  searchStructures,
  structuralProfileResult,
  suggestComplementaryLines,
  suggestGapFills,
  suggestReplacementLine,
  theoryDepth,
  toolDefault,
  transpositionResult,
  type ExplorerDb,
  projectStrategicFitLegacyResult,
  projectStrategicFitReport,
  strategicFitOptionsFromToolArguments,
  strategicPersonalHistorySourceFromToolArguments,
  strategicPopularityOptionsFromToolArguments,
  serializeStrategicFitSidecar,
  exportStrategicFitIntentPgn,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  STRATEGIC_FIT_PROGRESS_PHASES,
  STRATEGIC_POPULARITY_MOVE_LIMIT,
  type StrategicFitToolArguments,
} from "@chess-mcp/chess-tools";
import { makeFen } from "chessops/fen";
import type { BrowserCommandHandler } from "./types";
import { commandAnalyse, requestedDepth, throwIfAborted } from "./types";

const staleProfileResult = () => ({
  error: "strategic_fit_stale_report",
  reason: "The document Strategic Fit profile changed while analysis was running; request a fresh report.",
});

const profileIdentity = (
  profile: ReturnType<Parameters<BrowserCommandHandler>[1]["currentStrategicFitProfile"]>,
) => JSON.stringify(profile);

const effectiveDocumentSettingsIdentity = (
  args: StrategicFitToolArguments,
  snapshot: ReturnType<Parameters<BrowserCommandHandler>[1]["currentStrategicFitAnalysisSettings"]>,
) => JSON.stringify({
  weighting: args.popularity !== undefined || args.personal_history !== undefined
    ? null
    : args.weighting === undefined ? snapshot.inputs.weighting ?? null : args.weighting,
  popularity: args.popularity ?? null,
  personal_history: args.personal_history ?? null,
  cohort_overrides: args.cohort_overrides === undefined
    ? snapshot.inputs.cohort_overrides ?? null
    : args.cohort_overrides,
  route_assessments: args.route_assessments === undefined
    ? snapshot.inputs.route_assessments ?? null
    : args.route_assessments,
});

const injectDocumentAnalysisSettings = (
  args: StrategicFitToolArguments,
  options: ReturnType<typeof strategicFitOptionsFromToolArguments>,
  snapshot: ReturnType<Parameters<BrowserCommandHandler>[1]["currentStrategicFitAnalysisSettings"]>,
) => ({
  ...options,
  ...(args.weighting === undefined && args.popularity === undefined &&
      args.personal_history === undefined && snapshot.inputs.weighting !== undefined
    ? { weighting: snapshot.inputs.weighting }
    : {}),
  ...(args.cohort_overrides === undefined && snapshot.inputs.cohort_overrides !== undefined
    ? { cohorts: { overrides: snapshot.inputs.cohort_overrides } }
    : {}),
  ...(args.route_assessments === undefined && snapshot.inputs.route_assessments !== undefined
    ? { routeAssessments: snapshot.inputs.route_assessments }
    : {}),
});

const explorerAuthRequired = () => ({
  error: "explorer_auth_required",
  reason: "the Lichess opening explorer requires authentication; ask the user to add a personal API token (no scopes needed, lichess.org/account/oauth/token) in Settings",
});

type RepertoireCommandName =
  | "find_repertoire_gaps"
  | "suggest_gap_fills"
  | "find_theory_depth"
  | "get_transpositions"
  | "find_pruning_transpositions"
  | "get_repertoire_coverage"
  | "get_structural_profile"
  | "analyze_repertoire_congruence"
  | "classify_illustrative_lines"
  | "modify_repertoire_line"
  | "suggest_complementary_lines"
  | "suggest_replacement_line"
  | "audit_repertoire_moves"
  | "find_only_moves"
  | "find_structures"
  | "inspect_shortcut"
  | "export_annotated_repertoire"
  | "export_strategic_fit_metadata"
  | "export_strategic_fit_intent_pgn"
  | "prep_vs_opponent";

export const repertoireCommands: Record<RepertoireCommandName, BrowserCommandHandler> = {
  find_repertoire_gaps: async (args, context) => {
    const popularity = args.popularity as boolean | undefined;
    if (popularity && !context.hasExplorerToken()) return explorerAuthRequired();
    const result = await gapScanOperation(
      context.currentTree(),
      context.currentColor(),
      {
        depth: requestedDepth(args, context),
        min_severity: args.min_severity as never,
        max_positions: args.max_positions as number | undefined,
        limit: args.limit as number | undefined,
      },
      commandAnalyse(context),
      popularity ? (fen) => context.explorerPosition(fen, { db: args.popularity_db as ExplorerDb | undefined, movesLimit: 30 }, context.signal) : undefined,
      {
        onProgress: (done, total) => context.onProgress?.(done, total, "scanning repertoire positions"),
        shouldCancel: () => context.signal?.aborted ?? false,
      },
    );
    throwIfAborted(context.signal);
    return result;
  },
  suggest_gap_fills: async (args, context) => {
    const tree = context.currentTree();
    const path = tree.indexPathOfSan((args.variation_path as string[]) ?? []);
    if (!path) return { error: "path_not_found", reason: "variation_path is not in the repertoire" };
    const result = await suggestGapFills(tree, context.currentColor(), path, args.uncovered_move as string, {
      depth: requestedDepth(args, context),
      limit: args.limit as number | undefined,
      target_plies: args.target_plies as number | undefined,
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return result;
  },
  find_theory_depth: async (args, context) => {
    if (!context.hasExplorerToken()) return explorerAuthRequired();
    const db = (args.db as ExplorerDb | undefined) ?? toolDefault("find_theory_depth", "db", "lichess");
    const result = await theoryDepth(
      context.currentTree(),
      {
        minGames: (args.min_games as number | undefined) ?? (db === "masters" ? 5 : 100),
        maxPositions: args.max_positions as number | undefined,
        shouldCancel: () => context.signal?.aborted ?? false,
        onProgress: (done, total) => context.onProgress?.(done, total, "querying opening explorer"),
      },
      (fen) => context.explorerPosition(fen, { db, movesLimit: 0 }, context.signal),
    );
    throwIfAborted(context.signal);
    return "error" in result ? result : { db, ...result };
  },
  get_transpositions: (args, context) => transpositionResult(context.currentTree(), (args.limit as number | undefined) ?? toolDefault("get_transpositions", "limit", 20)),
  find_pruning_transpositions: async (args, context) => {
    const deep = context.analysisDepth() === 30;
    context.onProgress?.(0, args.budget as number | undefined, "checking shortcut candidates");
    const result = await context.currentTree().pruneTranspositions(
      context.currentColor(),
      {
        multipv: (args.multipv as number | undefined) ?? toolDefault("find_pruning_transpositions", "multipv", 4),
        cpThreshold: (args.cp_threshold as number | undefined) ?? toolDefault("find_pruning_transpositions", "cp_threshold", 50),
        maxLossCp: args.max_loss_cp as number | undefined,
        budget: args.budget as number | undefined,
        leafStart: args.leaf_start as number | undefined,
        leafCount: args.leaf_count as number | undefined,
        confirmDepth: deep ? 30 : args.confirm_depth as number | undefined,
        shouldCancel: () => context.signal?.aborted ?? false,
      },
      (fen, multipv, depth) => context.analyse(
        fen,
        multipv,
        depth ?? requestedDepth(args, context),
        depth != null || deep ? undefined : args.movetime_ms as number | undefined,
        context.signal,
      ),
      (done, total) => context.onProgress?.(done, total, "checking shortcut candidates"),
    );
    throwIfAborted(context.signal);
    const suggestions = result.suggestions.slice(0, (args.limit as number | undefined) ?? toolDefault("find_pruning_transpositions", "limit", 20));
    context.onProgress?.(result.positionsAnalysed, result.totalPositionsEstimate, "shortcut scan");
    return {
      total: result.suggestions.length,
      returned: suggestions.length,
      suggestions,
      total_leaves: result.totalLeaves,
      leaf_start: result.leafStart,
      leaves_scanned: result.leavesScanned,
      next_leaf: result.nextLeaf,
      positions_analysed: result.positionsAnalysed,
      total_positions_estimate: result.totalPositionsEstimate,
      estimated_positions_remaining: result.estimatedPositionsRemaining,
      partial: result.partial,
    };
  },
  get_repertoire_coverage: async (args, context) => {
    const base = repertoireCoverageResult(context.currentTree(), context.currentColor(), (args.limit as number | undefined) ?? toolDefault("get_repertoire_coverage", "limit", 20));
    if (!args.connect_stubs) return base;
    const result = await resolveDanglingStubs(context.currentTree(), context.currentColor(), {
      limit: args.limit as number | undefined,
      depth: requestedDepth(args, context),
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "connecting dangling stubs"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return "error" in result ? { ...base, error: result.error } : { ...base, stubs_resolved: result.resolved, dangling_lines: result.dangling };
  },
  get_structural_profile: (args, context) => structuralProfileResult(context.currentTree(), context.currentColor(), args.variation_path as string[] | undefined),
  analyze_repertoire_congruence: async (args, context) => {
    const openings = await context.openings();
    const toolArgs = args as StrategicFitToolArguments;
    const pgn = context.currentPgn();
    const color = context.currentColor();
    const revision = context.currentRevision();
    const repertoireRevision = `browser:${revision}`;
    const documentProfile = context.currentStrategicFitProfile();
    const documentProfileIdentity = profileIdentity(documentProfile);
    const documentSettings = context.currentStrategicFitAnalysisSettings();
    const effectiveSettingsIdentity = effectiveDocumentSettingsIdentity(toolArgs, documentSettings);
    const toolOptions = strategicFitOptionsFromToolArguments(toolArgs, {
      repertoireColor: color,
      repertoireRevision,
      openingTable: openings,
    });
    const settingsOptions = injectDocumentAnalysisSettings(toolArgs, toolOptions, documentSettings);
    let options = toolArgs.profile === undefined
      ? { ...settingsOptions, profile: documentProfile }
      : settingsOptions;
    const popularityOptions = strategicPopularityOptionsFromToolArguments(toolArgs);
    const personalHistorySource = strategicPersonalHistorySourceFromToolArguments(toolArgs);
    let graph: ReturnType<typeof buildRepertoireGraph> | null = null;
    if (popularityOptions || personalHistorySource) {
      try {
        graph = buildRepertoireGraph(context.currentTree(), color);
      } catch {
        // The analyzer owns structured preflight for unsupported or malformed trees. Optional
        // external evidence must never replace that base report with an adapter exception.
      }
    }
    let popularityProgressTotal = 0;
    const personalHistoryProgressTotal = personalHistorySource && graph ? 1 : 0;
    if (popularityOptions && graph) {
      const collection = await collectStrategicPopularityWeights(
        graph,
        {
          ...popularityOptions,
          availability: context.hasExplorerToken() ? "available" : "authentication-required",
          shouldCancel: () => context.signal?.aborted ?? false,
          onProgress: (done, total) => {
            popularityProgressTotal = total;
            context.onProgress?.(
              done,
              total + personalHistoryProgressTotal + STRATEGIC_FIT_PROGRESS_PHASES.length,
              "Collecting opening popularity",
            );
          },
        },
        context.hasExplorerToken()
          ? (fen) => context.explorerPosition(
              fen,
              { ...popularityOptions.filters, movesLimit: STRATEGIC_POPULARITY_MOVE_LIMIT },
              context.signal,
            )
          : undefined,
      );
      throwIfAborted(context.signal);
      if (collection.state === "cancelled") {
        throw new DOMException("Strategic Fit popularity collection cancelled", "AbortError");
      }
      options = { ...options, weighting: collection.weighting };
    }
    if (personalHistorySource && graph) {
      const total = popularityProgressTotal + personalHistoryProgressTotal +
        STRATEGIC_FIT_PROGRESS_PHASES.length;
      context.onProgress?.(
        popularityProgressTotal,
        total,
        "Fetching personal game history",
      );
      const games = personalHistorySource.platform === "chesscom"
        ? await context.chesscomGames(
            personalHistorySource.username,
            personalHistorySource.year!,
            personalHistorySource.month!,
            undefined,
            true,
            context.signal,
          )
        : await context.lichessGames(
            personalHistorySource.username,
            personalHistorySource.max_games!,
            undefined,
            true,
            context.signal,
          );
      throwIfAborted(context.signal);
      const collection = collectStrategicPersonalHistoryWeights(graph, games, {
        source: personalHistorySource,
        population: options.weighting,
        shouldCancel: () => context.signal?.aborted ?? false,
      });
      if (collection.state === "cancelled") {
        throw new DOMException("Strategic Fit personal-history collection cancelled", "AbortError");
      }
      context.onProgress?.(
        popularityProgressTotal + 1,
        total,
        "Mapped personal game history",
      );
      options = { ...options, weighting: collection.weighting };
    }
    const completeReport = await context.strategicFitReport(
      pgn,
      options,
      {
        signal: context.signal,
        onProgress: (progress) => context.onProgress?.(
          popularityProgressTotal + personalHistoryProgressTotal + progress.phase_index +
            (progress.state === "completed" ? 1 : 0),
          popularityProgressTotal + personalHistoryProgressTotal + progress.phase_count,
          progress.message,
        ),
      },
    );
    throwIfAborted(context.signal);
    if (
      context.currentRevision() !== revision ||
      context.currentColor() !== color ||
      context.currentPgn() !== pgn ||
      toolArgs.profile === undefined &&
        profileIdentity(context.currentStrategicFitProfile()) !== documentProfileIdentity ||
      effectiveDocumentSettingsIdentity(toolArgs, context.currentStrategicFitAnalysisSettings()) !==
        effectiveSettingsIdentity
    ) {
      if (
        toolArgs.profile === undefined &&
        profileIdentity(context.currentStrategicFitProfile()) !== documentProfileIdentity
      ) return staleProfileResult();
      if (
        effectiveDocumentSettingsIdentity(toolArgs, context.currentStrategicFitAnalysisSettings()) !==
          effectiveSettingsIdentity
      ) {
        return {
          error: "strategic_fit_stale_report",
          reason: "Document Strategic Fit resolutions or analysis overrides changed while analysis was running; request a fresh report.",
        };
      }
      return {
        error: "strategic_fit_stale_report",
        reason: "The repertoire or analysis color changed while Strategic Fit was running; request a fresh report.",
      };
    }
    const projection = projectStrategicFitReport(completeReport, {
      kind: "page",
      expected_repertoire_revision: repertoireRevision,
      page: toolArgs.page,
      sort: toolArgs.sort,
    });
    if (projection.projection !== "page") throw new Error("strategic_fit_unexpected_projection");
    return projectStrategicFitLegacyResult(projection.report, { limit: toolArgs.limit });
  },
  classify_illustrative_lines: (args, context) => illustrativeLinesResult(context.currentTree(), context.currentColor(), (args.limit as number | undefined) ?? toolDefault("classify_illustrative_lines", "limit", 20)),
  modify_repertoire_line: (args, context) => context.stageEdit(args.action as "add" | "prune" | "reorder", (args.path as string[]) ?? [], {
    addMoves: args.add_moves as string[] | undefined,
    promoteMove: args.promote_move as string | undefined,
  }),
  suggest_complementary_lines: async (args, context) => {
    const result = await suggestComplementaryLines(
      context.currentTree(), context.currentColor(), (args.fen as string | undefined) || context.currentFen(),
      { mode: args.mode as never, depth: requestedDepth(args, context), limit: args.limit as number | undefined },
      commandAnalyse(context),
    );
    throwIfAborted(context.signal);
    return result;
  },
  suggest_replacement_line: async (args, context) => {
    const result = await suggestReplacementLine(
      context.currentTree(), context.currentColor(), (args.outlier_variation_path as string[]) ?? [],
      { mode: args.mode as never, depth: requestedDepth(args, context) }, commandAnalyse(context),
    );
    throwIfAborted(context.signal);
    return result;
  },
  audit_repertoire_moves: async (args, context) => {
    const result = await auditRepertoireMoves(context.currentTree(), context.currentColor(), {
      depth: requestedDepth(args, context),
      minCpLoss: (args.min_cp_loss as number | undefined) ?? toolDefault("audit_repertoire_moves", "min_cp_loss", 50),
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("audit_repertoire_moves", "max_positions", 20),
      limit: (args.limit as number | undefined) ?? toolDefault("audit_repertoire_moves", "limit", 10),
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "auditing prescribed moves"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    return result;
  },
  find_only_moves: async (args, context) => {
    const result = await findOnlyMoves(context.currentTree(), context.currentColor(), {
      depth: requestedDepth(args, context),
      minMargin: (args.min_margin as number | undefined) ?? toolDefault("find_only_moves", "min_margin", 100),
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("find_only_moves", "max_positions", 300),
      linesLimit: (args.lines_limit as number | undefined) ?? toolDefault("find_only_moves", "lines_limit", 10),
      shouldCancel: () => context.signal?.aborted ?? false,
      onProgress: (done, total) => context.onProgress?.(done, total, "finding critical positions"),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    if ("error" in result) return result;
    if ("cancelled" in result) return result;
    const findings = result.findings.slice(0, (args.limit as number | undefined) ?? toolDefault("find_only_moves", "limit", 25));
    return args.export_deck
      ? { ...result, findings, deck: context.createArtifact("csv", onlyMoveDeckCsv(result.color, result.findings), "only-move-drill.csv") }
      : { ...result, findings };
  },
  find_structures: (args, context) => {
    const structure = args.structure as string | undefined;
    const center = args.center as "tense" | "locked" | "open" | "semi-open" | undefined;
    const themes = args.themes as string[] | undefined;
    const colorComplex = args.color_complex as "light" | "dark" | undefined;
    if (!structure && !center && !themes?.length && !colorComplex) return { error: "missing_criteria", reason: "provide at least one of structure/center/themes/color_complex" };
    if (structure && !STRUCTURE_NAMES.some((candidate) => candidate.toLowerCase() === structure.toLowerCase()))
      return { error: "unknown_structure", reason: `structure must be one of: ${STRUCTURE_NAMES.join(", ")}` };
    const leaves = context.currentTree().leaves().map((leaf) => ({ path: leaf.path, board: leaf.pos.board, fen: makeFen(leaf.pos.toSetup()) }));
    const matches = searchStructures(leaves, context.currentColor(), {
      structure,
      minConfidence: (args.min_confidence as number | undefined) ?? toolDefault("find_structures", "min_confidence", 0.6),
      center,
      themes: themes as never,
      colorComplex,
    });
    return { color: context.currentColor(), leaves_total: leaves.length, total_matches: matches.length, matches: matches.slice(0, (args.limit as number | undefined) ?? toolDefault("find_structures", "limit", 30)) };
  },
  inspect_shortcut: async (args, context) => {
    const depth = requestedDepth(args, context);
    const linePath = args.line_path as string[];
    const atPly = args.at_ply as number;
    const joinsPath = args.joins_path as string[];
    context.onProgress?.(0, 2, "comparing shortcut lines");
    const quality = await compareShortcutLines(context.currentTree(), context.currentColor(), {
      linePath, atPly, joinsPath, depth,
      evalTiebreakCp: (args.eval_tiebreak_cp as number | undefined) ?? toolDefault("inspect_shortcut", "eval_tiebreak_cp", 30),
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    context.onProgress?.(1, 2, "checking coverage after pruning");
    const coverage = await checkShortcutCoverage(context.currentTree(), context.currentColor(), {
      linePath, atPly, depth,
      maxPositions: (args.max_positions as number | undefined) ?? toolDefault("inspect_shortcut", "max_positions", 12),
      minSeverity: args.min_severity as never,
      limit: args.limit as number | undefined,
      shouldCancel: () => context.signal?.aborted ?? false,
    }, commandAnalyse(context));
    throwIfAborted(context.signal);
    context.onProgress?.(2, 2, "shortcut inspection complete");
    return { quality, coverage };
  },
  export_annotated_repertoire: async (args, context) => {
    context.onProgress?.(0, args.max_positions as number | undefined, "running repertoire analyses");
    const tree = context.currentTree();
    const color = context.currentColor();
    const pgn = context.currentPgn();
    const revision = context.currentRevision();
    const repertoireRevision = `browser:${revision}`;
    const documentProfile = context.currentStrategicFitProfile();
    const documentProfileIdentity = profileIdentity(documentProfile);
    const documentSettings = context.currentStrategicFitAnalysisSettings();
    const documentSettingsIdentity = documentSettings.identity;
    const openings = await context.openings();
    const include = args.include as ("audit" | "only_moves" | "gaps" | "congruence")[] | undefined;
    let result: Awaited<ReturnType<typeof annotateRepertoire>>;
    try {
      result = await annotateRepertoire(tree, color, {
        include,
        repertoireRevision,
        depth: requestedDepth(args, context),
        maxPositions: args.max_positions as number | undefined,
        minCpLoss: args.min_cp_loss as number | undefined,
        minMargin: args.min_margin as number | undefined,
        minSeverity: args.min_severity as never,
        shouldCancel: () => context.signal?.aborted ?? false,
        onProgress: (done, total) => context.onProgress?.(done, total, "annotating repertoire"),
      }, commandAnalyse(context), openings, include?.includes("congruence") === false
        ? undefined
        : (control) => context.strategicFitReport(
            pgn,
            {
              ...strategicFitOptionsFromToolArguments({}, {
                repertoireColor: color,
                repertoireRevision,
                openingTable: openings,
              }),
              profile: documentProfile,
              ...(documentSettings.inputs.weighting === undefined
                ? {}
                : { weighting: documentSettings.inputs.weighting }),
              ...(documentSettings.inputs.cohort_overrides === undefined
                ? {}
                : { cohorts: { overrides: documentSettings.inputs.cohort_overrides } }),
              ...(documentSettings.inputs.route_assessments === undefined
                ? {}
                : { routeAssessments: documentSettings.inputs.route_assessments }),
            },
            {
              signal: context.signal,
              onProgress: (progress) => control.onProgress?.(
                progress.phase_index + (progress.state === "completed" ? 1 : 0),
                progress.phase_count,
              ),
            },
          ).then((report) => {
            if (profileIdentity(context.currentStrategicFitProfile()) !== documentProfileIdentity) {
              throw new Error("strategic_fit_stale_profile");
            }
            if (context.currentStrategicFitAnalysisSettings().identity !== documentSettingsIdentity) {
              throw new Error("strategic_fit_stale_settings");
            }
            return report;
          }));
    } catch (error) {
      if (error instanceof Error && error.message === "strategic_fit_stale_profile") {
        return staleProfileResult();
      }
      if (error instanceof Error && error.message === "strategic_fit_stale_settings") {
        return {
          error: "strategic_fit_stale_report",
          reason: "Document Strategic Fit resolutions or analysis overrides changed while annotation was running; request a fresh report.",
        };
      }
      throw error;
    }
    throwIfAborted(context.signal);
    if ("error" in result) return result;
    if ("cancelled" in result) return result;
    const base = (context.currentFileName() ?? "repertoire.pgn").replace(/\.pgn$/i, "");
    return { ...context.createArtifact("pgn", result.pgn, `${base}-annotated.pgn`) as object, color: result.color, annotated: result.annotated };
  },
  export_strategic_fit_metadata: (_args, context) => {
    const base = (context.currentFileName() ?? "repertoire.pgn").replace(/\.pgn$/i, "");
    const content = serializeStrategicFitSidecar(
      context.currentDocumentId(),
      context.currentStrategicFitMetadata(),
    );
    return {
      ...context.createArtifact("json", content, `${base}-strategic-fit.json`) as object,
      document_id: context.currentDocumentId(),
      metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    };
  },
  export_strategic_fit_intent_pgn: async (args, context) => {
    const tree = context.currentTree();
    const pgn = context.currentPgn();
    const color = context.currentColor();
    const revision = context.currentRevision();
    const repertoireRevision = `browser:${revision}`;
    const documentId = context.currentDocumentId();
    const documentSettings = context.currentStrategicFitAnalysisSettings();
    const documentSettingsIdentity = documentSettings.identity;
    // Reading effective settings may reconcile stale semantic records. Capture the metadata only
    // after that reconciliation so the export is bound to the actual analyzed snapshot.
    const metadata = context.currentStrategicFitMetadata();
    const metadataIdentity = JSON.stringify(metadata);
    const report = await context.strategicFitReport(pgn, {
      ...strategicFitOptionsFromToolArguments({}, {
        repertoireColor: color,
        repertoireRevision,
        openingTable: await context.openings(),
      }),
      profile: metadata.profile,
      ...(documentSettings.inputs.weighting === undefined
        ? {}
        : { weighting: documentSettings.inputs.weighting }),
      ...(documentSettings.inputs.cohort_overrides === undefined
        ? {}
        : { cohorts: { overrides: documentSettings.inputs.cohort_overrides } }),
      ...(documentSettings.inputs.route_assessments === undefined
        ? {}
        : { routeAssessments: documentSettings.inputs.route_assessments }),
    }, {
      signal: context.signal,
      onProgress: (progress) => context.onProgress?.(
        progress.phase_index + (progress.state === "completed" ? 1 : 0),
        progress.phase_count,
        progress.message,
      ),
    });
    throwIfAborted(context.signal);
    if (
      context.currentRevision() !== revision || context.currentPgn() !== pgn ||
      context.currentColor() !== color || context.currentDocumentId() !== documentId ||
      JSON.stringify(context.currentStrategicFitMetadata()) !== metadataIdentity ||
      context.currentStrategicFitAnalysisSettings().identity !== documentSettingsIdentity
    ) {
      return {
        error: "strategic_fit_stale_report",
        reason: "The document, repertoire, or Strategic Fit metadata changed while intent export was running; generate a fresh export.",
      };
    }
    const exported = exportStrategicFitIntentPgn(tree, metadata, {
      findings: report.findings,
      max_findings: args.max_findings as number | undefined,
      max_resolutions: args.max_resolutions as number | undefined,
    });
    const base = (context.currentFileName() ?? "repertoire.pgn").replace(/\.pgn$/i, "");
    return {
      ...context.createArtifact("pgn", exported.pgn, `${base}-strategic-fit-intent.pgn`) as object,
      profile_comments: exported.profile_comments,
      resolution_comments: exported.resolution_comments,
      finding_comments: exported.finding_comments,
      skipped_paths: exported.skipped_paths,
      report_id: report.report_id,
    };
  },
  prep_vs_opponent: async (args, context) => {
    const platform = (args.platform as "lichess" | "chesscom" | undefined) ?? toolDefault("prep_vs_opponent", "platform", "lichess");
    const username = args.username as string;
    if (platform === "chesscom" && (args.year == null || args.month == null)) return { error: "missing_arg", reason: "chesscom requires year and month" };
    const games = platform === "chesscom"
      ? await context.chesscomGames(username, args.year as number, args.month as number, undefined, true, context.signal)
      : await context.lichessGames(username, (args.max_games as number | undefined) ?? toolDefault("prep_vs_opponent", "max_games", 30), undefined, true, context.signal);
    throwIfAborted(context.signal);
    return games === null ? { error: "fetch_failed", reason: "offline or unknown user" } : opponentPrepResult(context.currentTree(), context.currentColor(), username, games, await context.openings());
  },
};
