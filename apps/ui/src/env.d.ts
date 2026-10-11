/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PWA_LIFECYCLE_TEST?: string;
  readonly VITE_PWA_TEST_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Release version and commit, defined by the Vite config; absent outside a Vite build. */
declare const __APP_BUILD__: { version: string; commit: string } | undefined;
