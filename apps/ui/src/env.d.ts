/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PWA_LIFECYCLE_TEST?: string;
  readonly VITE_PWA_TEST_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
