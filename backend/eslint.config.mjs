import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { readabilityRules, ternaryRestrictions } from '../eslint.readability.mjs';
import { memberDecoratorNewline } from './eslint/member-decorator-newline.mjs';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'src/tools/db/migrations/**'] },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: readabilityRules,
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      prettier,
    ],
    plugins: {
      local: { rules: { 'member-decorator-newline': memberDecoratorNewline } },
    },
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...readabilityRules,
      'local/member-decorator-newline': 'error',
      'no-restricted-syntax': [
        'error',
        ...ternaryRestrictions,
        {
          selector: 'TSUnionType > TSTypeLiteral',
          message: 'Give this union variant a named interface or type alias.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
);
