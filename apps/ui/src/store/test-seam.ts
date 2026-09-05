export interface TestSeamEnvironment {
  readonly DEV?: boolean;
}

export function isProductionEnvironment(environment: TestSeamEnvironment | undefined): boolean {
  return environment !== undefined && environment.DEV !== true;
}

export function assertTestOnly(): void {
  const environment = Reflect.get(import.meta, "env") as TestSeamEnvironment | undefined;
  if (isProductionEnvironment(environment)) throw new Error("Test-only function");
}
