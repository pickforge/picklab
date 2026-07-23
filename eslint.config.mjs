import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["coverage/**", "packages/*/dist/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": [
        "error",
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "test/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
];
