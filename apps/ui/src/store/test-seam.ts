/**
 * Guard for test-only module exports.
 *
 * The seams marked `*ForTesting` must not be callable from a production build. A direct
 * `import.meta.env.DEV` check cannot be used, because `import.meta.env` is injected by Vite and is
 * `undefined` under plain `tsx --test` — the naive form throws a TypeError in the unit suite that
 * legitimately calls these seams.
 *
 * So: read `env` defensively and throw only when it exists and explicitly reports a non-DEV build.
 *
 *   - Vite production (`{ DEV: false }`) → throws, which is the point.
 *   - Vite dev (`{ DEV: true }`)         → allowed.
 *   - node:test / tsx (`undefined`)      → allowed.
 */

/** The build environment shape this guard cares about. */
export interface TestSeamEnvironment {
  readonly DEV?: boolean;
}

/**
 * The decision, separated from the ambient `import.meta` read so it is directly testable.
 * Each module's `import.meta` is its own object, so a test cannot meaningfully patch this
 * module's — it can only call the pure function with each environment shape.
 */
export function isProductionEnvironment(environment: TestSeamEnvironment | undefined): boolean {
  return environment !== undefined && environment.DEV !== true;
}

export function assertTestOnly(): void {
  const environment = Reflect.get(import.meta, "env") as TestSeamEnvironment | undefined;
  if (isProductionEnvironment(environment)) throw new Error("Test-only function");
}
