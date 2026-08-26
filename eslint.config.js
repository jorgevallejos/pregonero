import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";

export default [
  {
    // `src/vendor` is Muralista's code, vendored byte-for-byte and never edited here. Linting it
    // would produce findings whose only possible fix is an edit this repo is not allowed to make.
    ignores: ["dist", "node_modules", "src/vendor/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: reactPlugin,
    },
    rules: {
      // The codebase already uses a leading underscore to mean "deliberately unused" —
      // a parameter kept for signature symmetry, or a binding destructured only to
      // omit it from a rest spread. Without these patterns the rule flags that
      // convention as an error, which is how `npm run lint` ends up permanently red
      // and stops being read at all.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
];