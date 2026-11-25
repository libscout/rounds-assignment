import babelParser from '@babel/eslint-parser';
import { readabilityRules } from '../eslint.readability.mjs';

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  { files: ['**/*.{js,mjs,cjs}'], rules: readabilityRules },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript'] },
        },
      },
    },
    rules: readabilityRules,
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: {
        babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } },
      },
    },
  },
];
