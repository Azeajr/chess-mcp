import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";

// Type-aware linting only covers each package's `src`, matching that
// package's tsconfig `include`. Tests, scripts, and configs that sit
// outside those tsconfigs get non-type-checked linting instead —
// projectService has no program to resolve types against there.
const typedSourceFiles = ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"];
const solidFiles = ["apps/ui/src/**/*.{ts,tsx}"];
const untypedTsFiles = [
  "**/*.{ts,tsx}",
  "!apps/*/src/**/*.{ts,tsx}",
  "!packages/*/src/**/*.{ts,tsx}",
];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "plugin/**",
    "apps/ui/public/engine/**",
    "**/*.generated.*",
  ]),

  {
    name: "project/javascript",
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
    },
  },

  {
    name: "project/typescript-typed",
    files: typedSourceFiles,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-shadow": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  {
    name: "project/typescript-untyped",
    files: untypedTsFiles,
    extends: [tseslint.configs.recommended],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    name: "project/solid",
    files: solidFiles,
    extends: [solid.configs["flat/typescript"]],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },

  {
    name: "project/ui-skill-browser-scripts",
    files: ["apps/ui/.claude/skills/run-ui/*.mjs"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  {
    name: "project/node",
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    ignores: ["apps/ui/src/**"],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    name: "project/config-files-without-type-information",
    files: ["eslint.config.mjs", "apps/ui/playwright.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
