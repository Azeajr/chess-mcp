/// <reference types="vite/client" />

/** WP-019's build-A/build-B instrumentation variables. Ordinary production builds leave both unset. */
interface ImportMetaEnv {
  readonly VITE_PWA_LIFECYCLE_TEST?: string;
  readonly VITE_PWA_TEST_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
