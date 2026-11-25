export const memberDecoratorNewline = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: { newline: 'Put each decorator on its own line above the class member.' },
  },
  create(context) {
    return {
      'PropertyDefinition > Decorator, MethodDefinition > Decorator'(decorator) {
        const next = context.sourceCode.getTokenAfter(decorator);
        if (decorator.loc.end.line === next.loc.start.line) {
          context.report({
            node: decorator,
            messageId: 'newline',
            fix: (fixer) => fixer.insertTextAfter(decorator, '\n'),
          });
        }
      },
    };
  },
};
