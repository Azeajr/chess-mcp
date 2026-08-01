import {
  DEFAULT_EXPLORER_SPEEDS,
  EXPLORER_RATING_BUCKETS,
  EXPLORER_SPEEDS,
  type ExplorerRatingBucket,
  type ExplorerSpeed,
} from "@chess-mcp/chess-tools";
import { createSignal } from "solid-js";
import { invalidateCachedStrategicFitReports } from "../application/strategic-fit-report-cache";

export type StrategicFitPopularityDatabase = "lichess" | "masters";
export type StrategicFitPersonalHistoryPlatform = "lichess" | "chesscom";

export interface StrategicFitDataSourceSettings {
  readonly popularity: {
    readonly enabled: boolean;
    readonly db: StrategicFitPopularityDatabase;
    readonly speeds: readonly ExplorerSpeed[];
    readonly ratings: readonly ExplorerRatingBucket[];
    readonly since: string;
    readonly until: string;
    readonly max_positions: number;
  };
  readonly personal_history: {
    readonly enabled: boolean;
    readonly platform: StrategicFitPersonalHistoryPlatform;
    readonly username: string;
    readonly max_games: number;
    readonly year: number;
    readonly month: number;
  };
}

export interface StrategicFitDataSourceSettingsInput {
  readonly popularity?: Partial<StrategicFitDataSourceSettings["popularity"]>;
  readonly personal_history?: Partial<StrategicFitDataSourceSettings["personal_history"]>;
}

export interface StrategicFitDataSourceStateBoundary {
  load(): unknown;
  save(settings: StrategicFitDataSourceSettings): void;
  invalidateReports(): void;
}

export interface StrategicFitDataSourceState {
  settings(): StrategicFitDataSourceSettings;
  update(input: StrategicFitDataSourceSettingsInput): StrategicFitDataSourceSettings;
  identity(): string;
  commandArguments(): Record<string, unknown>;
}

const now = new Date();
const DEFAULT_SETTINGS: StrategicFitDataSourceSettings = Object.freeze({
  popularity: Object.freeze({
    enabled: false,
    db: "lichess" as const,
    speeds: Object.freeze([...DEFAULT_EXPLORER_SPEEDS]),
    ratings: Object.freeze([1600, 1800, 2000, 2200] as ExplorerRatingBucket[]),
    since: "",
    until: "",
    max_positions: 60,
  }),
  personal_history: Object.freeze({
    enabled: false,
    platform: "lichess" as const,
    username: "",
    max_games: 30,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  }),
});

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(maximum, Math.max(minimum, value)))
    : fallback;
}

function selectedValues<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const allowedSet = new Set<T>(allowed);
  const result = [...new Set(value.filter((entry): entry is T => allowedSet.has(entry as T)))];
  return result.length > 0 ? result : [...fallback];
}

function recencyString(value: unknown, db: StrategicFitPopularityDatabase): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const pattern = db === "masters" ? /^\d{4}$/ : /^\d{4}-(?:0[1-9]|1[0-2])$/;
  return pattern.test(trimmed) ? trimmed : "";
}

export function normalizeStrategicFitDataSourceSettings(
  input: unknown,
  base: StrategicFitDataSourceSettings = DEFAULT_SETTINGS,
): StrategicFitDataSourceSettings {
  const root = record(input);
  const popularity = record(root.popularity);
  const history = record(root.personal_history);
  const db =
    popularity.db === "masters" || popularity.db === "lichess" ? popularity.db : base.popularity.db;
  const platform =
    history.platform === "chesscom" || history.platform === "lichess"
      ? history.platform
      : base.personal_history.platform;
  const since =
    popularity.since === undefined
      ? recencyString(base.popularity.since, db)
      : recencyString(popularity.since, db);
  const candidateUntil =
    popularity.until === undefined
      ? recencyString(base.popularity.until, db)
      : recencyString(popularity.until, db);
  const until = since && candidateUntil && since > candidateUntil ? "" : candidateUntil;
  return {
    popularity: {
      enabled:
        typeof popularity.enabled === "boolean" ? popularity.enabled : base.popularity.enabled,
      db,
      speeds: selectedValues(popularity.speeds, EXPLORER_SPEEDS, base.popularity.speeds),
      ratings: selectedValues(popularity.ratings, EXPLORER_RATING_BUCKETS, base.popularity.ratings),
      since,
      until,
      max_positions: boundedInteger(
        popularity.max_positions,
        base.popularity.max_positions,
        1,
        120,
      ),
    },
    personal_history: {
      enabled:
        typeof history.enabled === "boolean" ? history.enabled : base.personal_history.enabled,
      platform,
      username:
        typeof history.username === "string"
          ? history.username.trim().slice(0, 64)
          : base.personal_history.username,
      max_games: boundedInteger(history.max_games, base.personal_history.max_games, 1, 100),
      year: boundedInteger(history.year, base.personal_history.year, 2007, 2100),
      month: boundedInteger(history.month, base.personal_history.month, 1, 12),
    },
  };
}

function clone(settings: StrategicFitDataSourceSettings): StrategicFitDataSourceSettings {
  return {
    popularity: {
      ...settings.popularity,
      speeds: [...settings.popularity.speeds],
      ratings: [...settings.popularity.ratings],
    },
    personal_history: { ...settings.personal_history },
  };
}

export function strategicFitDataSourceArguments(
  settings: StrategicFitDataSourceSettings,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (settings.popularity.enabled) {
    args.popularity = {
      db: settings.popularity.db,
      ...(settings.popularity.db === "lichess"
        ? { speeds: [...settings.popularity.speeds], ratings: [...settings.popularity.ratings] }
        : {}),
      ...(settings.popularity.since ? { since: settings.popularity.since } : {}),
      ...(settings.popularity.until ? { until: settings.popularity.until } : {}),
      max_positions: settings.popularity.max_positions,
    };
  }
  if (settings.personal_history.enabled && settings.personal_history.username) {
    args.personal_history =
      settings.personal_history.platform === "chesscom"
        ? {
            platform: "chesscom",
            username: settings.personal_history.username,
            year: settings.personal_history.year,
            month: settings.personal_history.month,
          }
        : {
            platform: "lichess",
            username: settings.personal_history.username,
            max_games: settings.personal_history.max_games,
          };
  }
  return args;
}

export function createStrategicFitDataSourceState(
  boundary: StrategicFitDataSourceStateBoundary,
): StrategicFitDataSourceState {
  const [settings, setSettings] = createSignal(
    normalizeStrategicFitDataSourceSettings(boundary.load()),
  );
  return {
    settings: () => clone(settings()),
    update(input) {
      const next = normalizeStrategicFitDataSourceSettings({
        popularity: { ...settings().popularity, ...(input.popularity ?? {}) },
        personal_history: { ...settings().personal_history, ...(input.personal_history ?? {}) },
      });
      if (JSON.stringify(next) !== JSON.stringify(settings())) {
        setSettings(next);
        boundary.save(next);
        boundary.invalidateReports();
      }
      return clone(settings());
    },
    identity: () => JSON.stringify(settings()),
    commandArguments: () => strategicFitDataSourceArguments(settings()),
  };
}

const STORAGE_KEY = "chess.strategic-fit.data-sources.v1";
const browserState = createStrategicFitDataSourceState({
  load() {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    try {
      return JSON.parse(stored) as unknown;
    } catch {
      return null;
    }
  },
  save(settings) {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  },
  invalidateReports: invalidateCachedStrategicFitReports,
});

export const strategicFitDataSourceSettings = () => browserState.settings();
export const updateStrategicFitDataSourceSettings = (input: StrategicFitDataSourceSettingsInput) =>
  browserState.update(input);
export const strategicFitDataSourceIdentity = () => browserState.identity();
export const strategicFitDataSourceCommandArguments = () => browserState.commandArguments();
