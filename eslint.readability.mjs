export const ternaryRestrictions = [
  {
    selector:
      'ConditionalExpression :matches(AwaitExpression, :function[async=true], CallExpression[callee.object.name="Promise"], NewExpression[callee.name="Promise"])',
    message: 'Use an explicit branch for asynchronous work.',
  },
  {
    selector: ':not(VariableDeclarator):not(ReturnStatement) > ConditionalExpression',
    message: 'Assign the choice to a named variable or use an explicit branch.',
  },
  {
    selector: 'ConditionalExpression ConditionalExpression',
    message: 'Use explicit branches for nested choices.',
  },
];

export const readabilityRules = {
  curly: ['error', 'all'],
  'one-var': ['error', 'never'],
  'no-nested-ternary': 'error',
  'no-restricted-syntax': ['error', ...ternaryRestrictions],
  'lines-between-class-members': ['error', 'always'],
  'padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: 'import', next: '*' },
    { blankLine: 'any', prev: 'import', next: 'import' },
    { blankLine: 'always', prev: '*', next: 'return' },
  ],
};
